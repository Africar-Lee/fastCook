import { t } from '../i18n/core.ts';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import { hasOnlyKeys, isPlainRecord, utf8Bytes, validateVisionSettings } from './config.ts';
import { historyStorage } from './history-storage';
import { buildVisionRequest, VISION_CLIENT_ERRORS } from './request.ts';
import { MAX_VISION_PHOTO_BYTES, MAX_VISION_PHOTO_EDGE } from './photo-validation.ts';
import type { VisionCall, VisionCallStatus, VisionHistory, VisionRequest, VisionUsage } from './types';

const MAX_HISTORY_BYTES = 131_072;
const MAX_CALLS = 30;
const SAFE_ERRORS = new Set<string>([...Object.values(VISION_CLIENT_ERRORS), '识别失败，请重试。']);
const CALL_KEYS = ['id', 'timestamp', 'settings', 'prompt', 'image', 'status', 'itemCount', 'usage', 'error'];
const HISTORY_ERROR = '识别记录格式无效，无法确认今日调用次数，请检查本地存储。';
type HistoryBackend = Readonly<{
  read: () => Promise<StorageResult<string | null>>;
  write: (value: string) => Promise<StorageResult<void>>;
}>;
export type VisionCallOutcome = Readonly<{
  status: Exclude<VisionCallStatus, 'pending'>;
  itemCount?: number;
  usage?: VisionUsage;
  error?: string;
}>;
let historyQueue: Promise<unknown> = Promise.resolve();
let sequence = 0;

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const pending = historyQueue.then(operation, operation);
  historyQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

function integerWithin(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
}

function validUsage(value: unknown): value is VisionUsage {
  return isPlainRecord(value) && hasOnlyKeys(value, ['inputTokens', 'outputTokens', 'totalTokens'])
    && Object.values(value).every(count => integerWithin(count, 0, Number.MAX_SAFE_INTEGER));
}

function validImage(value: unknown): value is VisionCall['image'] {
  return isPlainRecord(value) && hasOnlyKeys(value, ['width', 'height', 'bytes', 'mimeType'])
    && value.mimeType === 'image/jpeg' && integerWithin(value.width, 1, MAX_VISION_PHOTO_EDGE)
    && integerWithin(value.height, 1, MAX_VISION_PHOTO_EDGE) && integerWithin(value.bytes, 1, MAX_VISION_PHOTO_BYTES);
}

function validCall(value: unknown): value is VisionCall {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, CALL_KEYS)) return false;
  if (typeof value.id !== 'string' || !/^[\dT:.Z-]{1,80}$/u.test(value.id)) return false;
  if (typeof value.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.timestamp)
    || !Number.isFinite(Date.parse(value.timestamp)) || new Date(value.timestamp).toISOString() !== value.timestamp) return false;
  if (validateVisionSettings(value.settings).error !== null || !validImage(value.image)) return false;
  if (typeof value.prompt !== 'string' || !value.prompt || utf8Bytes(value.prompt) > 4096) return false;
  if (!['pending', 'succeeded', 'failed', 'cancelled'].includes(value.status as string)) return false;
  if (Object.hasOwn(value, 'itemCount') && !integerWithin(value.itemCount, 0, 30)) return false;
  if (Object.hasOwn(value, 'usage') && !validUsage(value.usage)) return false;
  if (Object.hasOwn(value, 'error') && (typeof value.error !== 'string' || !SAFE_ERRORS.has(value.error))) return false;
  return value.status !== 'pending' || !['itemCount', 'usage', 'error'].some(key => Object.hasOwn(value, key));
}

function parseHistory(raw: string, today: string): StorageResult<VisionHistory> {
  if (utf8Bytes(raw) > MAX_HISTORY_BYTES) return failure(t(HISTORY_ERROR));
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure(t(HISTORY_ERROR));
  }
  if (!isPlainRecord(parsed) || !hasOnlyKeys(parsed, ['schemaVersion', 'quotaDate', 'usedCalls', 'calls'])
    || parsed.schemaVersion !== 1 || !validDate(parsed.quotaDate) || !integerWithin(parsed.usedCalls, 0, 100)
    || !Array.isArray(parsed.calls) || parsed.calls.length > MAX_CALLS || !parsed.calls.every(validCall)) return failure(t(HISTORY_ERROR));
  if (new Set(parsed.calls.map(call => call.id)).size !== parsed.calls.length) return failure(t(HISTORY_ERROR));
  return success({ schemaVersion: 1, quotaDate: today, usedCalls: parsed.quotaDate === today ? parsed.usedCalls : 0, calls: parsed.calls });
}

async function readHistory(backend: HistoryBackend, now: Date): Promise<StorageResult<VisionHistory>> {
  const loaded = await backend.read();
  if (loaded.error !== null) return loaded;
  const today = localDate(now);
  return loaded.data === null ? success({ schemaVersion: 1, quotaDate: today, usedCalls: 0, calls: [] }) : parseHistory(loaded.data, today);
}

function validateRequest(request: VisionRequest): StorageResult<VisionRequest> {
  if (!isPlainRecord(request) || !hasOnlyKeys(request, ['settings', 'photo', 'prompt', 'body'])
    || !isPlainRecord(request.photo) || !hasOnlyKeys(request.photo, ['uri', 'base64', 'width', 'height', 'mimeType', 'bytes'])
    || typeof request.body !== 'string' || request.body.length > 4 * 1024 * 1024) return failure(t('识别请求格式无效，请重新选择图片。'));
  const rebuilt = buildVisionRequest(request.settings, request.photo);
  if (rebuilt.error !== null) return rebuilt;
  if (request.prompt !== rebuilt.data.prompt || request.body !== rebuilt.data.body || utf8Bytes(request.prompt) > 4096) return failure(t(VISION_CLIENT_ERRORS.changedRequest));
  return rebuilt;
}

async function writeHistory(backend: HistoryBackend, history: VisionHistory): Promise<StorageResult<void>> {
  let calls = history.calls.slice(0, MAX_CALLS);
  let payload = JSON.stringify({ ...history, calls });
  while (utf8Bytes(payload) > MAX_HISTORY_BYTES && calls.length > 0) {
    calls = calls.slice(0, -1);
    payload = JSON.stringify({ ...history, calls });
  }
  return backend.write(payload);
}

async function reserve(backend: HistoryBackend, request: VisionRequest, now: Date): Promise<StorageResult<VisionCall>> {
  const checked = validateRequest(request);
  if (checked.error !== null) return checked;
  const loaded = await readHistory(backend, now);
  if (loaded.error !== null) return loaded;
  if (loaded.data.usedCalls >= checked.data.settings.dailyLimit) return failure(t('已达到今日调用上限，请明天再试，或在模型设置中调整上限。'));
  const { width, height, bytes, mimeType } = checked.data.photo;
  const timestamp = now.toISOString();
  let id: string;
  do { id = `${timestamp}-${++sequence}`; } while (loaded.data.calls.some(call => call.id === id));
  const call: VisionCall = { id, timestamp, settings: checked.data.settings, prompt: checked.data.prompt, image: { width, height, bytes, mimeType }, status: 'pending' };
  const updated: VisionHistory = { ...loaded.data, usedCalls: loaded.data.usedCalls + 1, calls: [call, ...loaded.data.calls] };
  const written = await writeHistory(backend, updated);
  return written.error !== null ? written : success(call);
}

function safeErrorKey(value: unknown): string {
  return typeof value === 'string'
    ? [...SAFE_ERRORS].find(key => value === key || value === t(key, undefined, 'en')) ?? '识别失败，请重试。'
    : '识别失败，请重试。';
}

function validateOutcome(value: VisionCallOutcome): StorageResult<VisionCallOutcome> {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['status', 'itemCount', 'usage', 'error'])
    || !['succeeded', 'failed', 'cancelled'].includes(value.status)) return failure(t('识别结果状态无效，调用记录未更新。'));
  if (Object.hasOwn(value, 'itemCount') && !integerWithin(value.itemCount, 0, 30)) return failure(t('识别结果数量无效，调用记录未更新。'));
  if (Object.hasOwn(value, 'usage') && !validUsage(value.usage)) return failure(t('识别用量格式无效，调用记录未更新。'));
  return success({ status: value.status, ...(value.itemCount !== undefined ? { itemCount: value.itemCount } : {}),
    ...(value.usage !== undefined ? { usage: { ...value.usage } } : {}),
    ...(value.status === 'failed' || value.status === 'cancelled' ? { error: safeErrorKey(value.error) } : {}),
  });
}

async function finish(backend: HistoryBackend, id: string, outcome: VisionCallOutcome, now: Date): Promise<StorageResult<void>> {
  const checked = validateOutcome(outcome);
  if (checked.error !== null) return checked;
  const loaded = await readHistory(backend, now);
  if (loaded.error !== null) return loaded;
  const existing = loaded.data.calls.find(call => call.id === id);
  if (!existing) return failure(t('未找到这次识别记录，记录可能已被清除。'));
  if (existing.status !== 'pending') return failure(t('这次识别已经结束，调用记录未重复更新。'));
  const calls = loaded.data.calls.map(call => call.id === id ? { ...call, ...checked.data } : call);
  return writeHistory(backend, { ...loaded.data, calls });
}

export function createHistoryStore(backend: HistoryBackend, now: () => Date = () => new Date()) {
  return {
    read: () => serialize(() => readHistory(backend, now())),
    reserve: (request: VisionRequest) => serialize(() => reserve(backend, request, now())),
    finish: (id: string, outcome: VisionCallOutcome) => serialize(() => finish(backend, id, outcome, now())),
    clear: () => serialize(async (): Promise<StorageResult<void>> => {
      const loaded = await readHistory(backend, now());
      return loaded.error !== null ? loaded : backend.write(JSON.stringify({ ...loaded.data, calls: [] }));
    }),
    repair: () => serialize(async (): Promise<StorageResult<void>> => {
      const loaded = await backend.read();
      if (loaded.error !== null) return loaded;
      const today = localDate(now());
      const empty: VisionHistory = { schemaVersion: 1, quotaDate: today, usedCalls: 0, calls: [] };
      const parsed = loaded.data === null ? success(empty) : parseHistory(loaded.data, today);
      const repaired: VisionHistory = parsed.error !== null ? { ...empty, usedCalls: 100 } : { ...parsed.data, calls: [] };
      return backend.write(JSON.stringify(repaired));
    }),
  };
}

export const historyStore = createHistoryStore(historyStorage);
