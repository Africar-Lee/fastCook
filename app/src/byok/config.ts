import { t } from '../i18n/core.ts';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import type { CredentialStore, VisionCredentials, VisionSettings } from './types';

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const MAX_CREDENTIAL_BYTES = 2048;
export const DEFAULT_VISION_SETTINGS: VisionSettings = {
  protocol: 'openai', providerName: 'OpenAI', endpoint: OPENAI_ENDPOINT, model: '', dailyLimit: 10,
};
const SETTINGS_KEYS = ['protocol', 'providerName', 'endpoint', 'model', 'dailyLimit'];
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim() && !CONTROL_CHARACTERS.test(value);
}

function validEndpoint(value: unknown): value is string {
  if (!validText(value, 512) || /\s/u.test(value) || !value.startsWith('https://')
    || value.slice('https://'.length).split('/')[0]!.includes('@')) return false;
  let endpoint: URL;
  try { endpoint = new URL(value); } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    return false;
  }
  return endpoint.protocol === 'https:' && endpoint.hostname.length > 0 && endpoint.pathname !== '/'
    && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
    && !value.includes('?') && !value.includes('#') && !value.includes('\\');
}

export function validateVisionSettings(value: unknown): StorageResult<VisionSettings> {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, SETTINGS_KEYS)) return failure(t('模型配置格式无效，请重新填写。'));
  if (value.protocol !== 'openai' && value.protocol !== 'openai-compatible') return failure(t('请选择支持的模型协议。'));
  if (!validText(value.providerName, 48)) return failure(t('服务商名称需为 1–48 个字符。'));
  if (!validText(value.model, 128)) return failure(t('模型名称需为 1–128 个字符。'));
  if (!validEndpoint(value.endpoint)) return failure(t('请填写完整的 HTTPS 请求地址，不含账号、查询参数或片段。'));
  if (value.protocol === 'openai' && value.endpoint !== OPENAI_ENDPOINT) return failure(t('OpenAI 协议需要使用官方请求地址。'));
  if (!Number.isInteger(value.dailyLimit) || (value.dailyLimit as number) < 1 || (value.dailyLimit as number) > 100) return failure(t('每日调用上限需为 1–100 次。'));
  return success({ protocol: value.protocol, providerName: value.providerName, endpoint: value.endpoint, model: value.model, dailyLimit: value.dailyLimit as number });
}

export function validateVisionCredentials(value: unknown): StorageResult<VisionCredentials> {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'settings', 'apiKey']) || value.schemaVersion !== 1) return failure(t('密钥记录格式无效，请删除后重新配置。'));
  const settings = validateVisionSettings(value.settings);
  if (settings.error !== null) return settings;
  if (typeof value.apiKey !== 'string' || !/^[\x21-\x7e]{1,1024}$/u.test(value.apiKey)) return failure(t('API Key 需为 1–1024 个可见字符，且不能含空格或换行。'));
  const credentials: VisionCredentials = { schemaVersion: 1, settings: settings.data, apiKey: value.apiKey };
  if (utf8Bytes(JSON.stringify(credentials)) > MAX_CREDENTIAL_BYTES) return failure(t('模型配置与密钥过长，请缩短配置后重试。'));
  return success(credentials);
}

export type CredentialBackend = Readonly<{
  read: () => Promise<StorageResult<string | null>>;
  write: (value: string) => Promise<StorageResult<void>>;
  remove: () => Promise<StorageResult<void>>;
}>;
let credentialQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const pending = credentialQueue.then(operation, operation);
  credentialQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function readCredentials(backend: CredentialBackend): Promise<StorageResult<VisionCredentials | null>> {
  const result = await backend.read();
  if (result.error !== null) return result;
  if (result.data === null) return success(null);
  if (utf8Bytes(result.data) > MAX_CREDENTIAL_BYTES) return failure(t('密钥记录过大，请删除后重新配置。'));
  let parsed: unknown;
  try { parsed = JSON.parse(result.data); } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure(t('密钥记录损坏，请删除后重新配置。'));
  }
  return validateVisionCredentials(parsed);
}

async function saveCredentials(backend: CredentialBackend, value: unknown, apiKey: string): Promise<StorageResult<VisionSettings>> {
  const settings = validateVisionSettings(value);
  if (settings.error !== null) return settings;
  let nextKey = apiKey;
  if (apiKey === '') {
    const previous = await readCredentials(backend);
    if (previous.error !== null) return previous;
    if (!previous.data || previous.data.settings.endpoint !== settings.data.endpoint || previous.data.settings.protocol !== settings.data.protocol) return failure(t('更换服务商地址或协议后，请重新输入 API Key。'));
    nextKey = previous.data.apiKey;
  }
  const credentials = validateVisionCredentials({ schemaVersion: 1, settings: settings.data, apiKey: nextKey });
  if (credentials.error !== null) return credentials;
  const result = await backend.write(JSON.stringify(credentials.data));
  return result.error !== null ? result : success(settings.data);
}

export function createCredentialStore(backend: CredentialBackend): CredentialStore {
  return {
    read: () => serialize(() => readCredentials(backend)),
    save: (settings, apiKey) => serialize(() => saveCredentials(backend, settings, apiKey)),
    remove: () => serialize(() => backend.remove()),
  };
}
