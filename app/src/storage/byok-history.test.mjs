import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { DEFAULT_VISION_SETTINGS } from '../byok/config.ts';
import { buildVisionRequest, VISION_CLIENT_ERRORS } from '../byok/request.ts';

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== './history-storage') return nextResolve(specifier, context);
  return { url: `data:text/javascript,${encodeURIComponent("export const historyStorage = { read: async () => ({data: null,error: null}), write: async () => ({data: undefined,error: null}) };")}`, shortCircuit: true };
} });
const { createHistoryStore } = await import('../byok/history.ts');
hooks.deregister();
const success = data => ({ data, error: null });
const jpeg = Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,127,255,217]);
const base64 = jpeg.toString('base64');
const photo = { base64, uri: `data:image/jpeg;base64,${base64}`, mimeType: 'image/jpeg', width: 1, height: 1, bytes: jpeg.length };
const settings = { ...DEFAULT_VISION_SETTINGS, model: 'vision-model', dailyLimit: 2 };
const request = buildVisionRequest(settings, photo).data;
assert.ok(request);
const now = () => new Date(2026, 9, 14, 12, 0, 0);
function memoryBackend() {
  let value = null;
  return { read: async () => success(value), write: async next => { value = next; return success(undefined); }, value: () => value, seed: next => { value = next; } };
}

test('reserve persists only approved metadata and a pending attempt before a request can run', async () => {
  const backend = memoryBackend();
  const store = createHistoryStore(backend, now);
  const result = await store.reserve(request);
  assert.equal(result.error, null);
  assert.equal(result.data.status, 'pending');
  const history = JSON.parse(backend.value());
  assert.equal(history.usedCalls, 1);
  assert.equal(history.quotaDate, '2026-10-14');
  assert.deepEqual(history.calls[0], result.data);
  assert.equal(backend.value().includes(base64), false);
  assert.equal(backend.value().includes('"uri"'), false);
  assert.equal(backend.value().includes('"body"'), false);
  assert.equal(backend.value().includes('apiKey'), false);
  assert.deepEqual(history.calls[0].image, { width: 1, height: 1, bytes: jpeg.length, mimeType: 'image/jpeg' });
});

test('simultaneous requests across store instances cannot bypass the daily limit', async () => {
  const backend = memoryBackend();
  const first = createHistoryStore(backend, now);
  const second = createHistoryStore(backend, now);
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? first : second).reserve(request)));
  assert.equal(results.filter(result => result.error === null).length, 2);
  assert.equal((await first.read()).data.usedCalls, 2);
  assert.equal(new Set((await first.read()).data.calls.map(call => call.id)).size, 2);
});

test('a failed reservation write does not return permission to send or consume a saved quota', async () => {
  const backend = memoryBackend();
  backend.write = async () => ({ data: null, error: '存储已满。' });
  const store = createHistoryStore(backend, now);
  assert.equal((await store.reserve(request)).error, '存储已满。');
  assert.equal((await store.read()).data.usedCalls, 0);
});

test('clearing history preserves daily attempts and does not permit another call', async () => {
  const store = createHistoryStore(memoryBackend(), now);
  await store.reserve(request);
  await store.reserve(request);
  assert.equal((await store.clear()).error, null);
  assert.equal((await store.read()).data.usedCalls, 2);
  assert.deepEqual((await store.read()).data.calls, []);
  assert.match((await store.reserve(request)).error, /今日调用上限/u);
});

test('quota resets at the next local calendar day while interrupted attempts remain visible', async () => {
  const backend = memoryBackend();
  const first = createHistoryStore(backend, now);
  await first.reserve(request);
  await first.reserve(request);
  const nextDay = createHistoryStore(backend, () => new Date(2026, 9, 15, 0, 1));
  assert.equal((await nextDay.read()).data.usedCalls, 0);
  assert.equal((await nextDay.read()).data.calls[0].status, 'pending');
  assert.equal((await nextDay.reserve(request)).error, null);
  assert.equal((await nextDay.read()).data.usedCalls, 1);
});

test('completion records validated usage and item count without changing quota', async () => {
  const store = createHistoryStore(memoryBackend(), now);
  const reserved = await store.reserve(request);
  assert.equal((await store.finish(reserved.data.id, { status: 'succeeded', itemCount: 2, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } })).error, null);
  const history = (await store.read()).data;
  assert.equal(history.usedCalls, 1);
  assert.equal(history.calls[0].status, 'succeeded');
  assert.equal(history.calls[0].itemCount, 2);
  assert.deepEqual(history.calls[0].usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  assert.notEqual((await store.finish(reserved.data.id, { status: 'failed' })).error, null);
});

test('failed and cancelled attempts remain charged and discard arbitrary remote error content', async () => {
  const backend = memoryBackend();
  const store = createHistoryStore(backend, now);
  const first = (await store.reserve(request)).data;
  await store.finish(first.id, { status: 'failed', error: 'remote private-key and photo contents' });
  const second = (await store.reserve(request)).data;
  await store.finish(second.id, { status: 'cancelled', error: VISION_CLIENT_ERRORS.cancelled });
  const history = (await store.read()).data;
  assert.equal(history.usedCalls, 2);
  assert.equal(history.calls[1].error, '识别失败，请重试。');
  assert.equal(history.calls[0].error, VISION_CLIENT_ERRORS.cancelled);
  assert.equal(backend.value().includes('private-key'), false);
});

test('invalid outcomes leave the pending attempt intact', async () => {
  const store = createHistoryStore(memoryBackend(), now);
  const call = (await store.reserve(request)).data;
  for (const outcome of [{ status: 'pending' }, { status: 'succeeded', itemCount: 31 }, { status: 'succeeded', usage: { inputTokens: -1 } }, { status: 'succeeded', usage: { secret: 'key' } }, { status: 'succeeded', photo: 'private' }]) assert.notEqual((await store.finish(call.id, outcome)).error, null);
  assert.equal((await store.read()).data.calls[0].status, 'pending');
});

test('tampered or malformed requests never create a log or consume quota', async () => {
  const backend = memoryBackend();
  const store = createHistoryStore(backend, now);
  for (const changed of [{ ...request, prompt: 'private-key' }, { ...request, body: '{}' }, { ...request, body: 'x'.repeat(4 * 1024 * 1024 + 1) }, { ...request, apiKey: 'private-key' }, { ...request, photo: { ...photo, extra: 'private' } }, { ...request, settings: { ...settings, dailyLimit: 200 } }]) assert.notEqual((await store.reserve(changed)).error, null);
  assert.equal((await store.read()).data.usedCalls, 0);
  assert.equal(backend.value(), null);
});

test('history retains at most 30 recent calls but all daily attempts count', async () => {
  const backend = memoryBackend();
  const store = createHistoryStore(backend, now);
  const manyCalls = buildVisionRequest({ ...settings, dailyLimit: 100 }, photo).data;
  for (let index = 0; index < 35; index++) assert.equal((await store.reserve(manyCalls)).error, null);
  const history = (await store.read()).data;
  assert.equal(history.usedCalls, 35);
  assert.equal(history.calls.length, 30);
  assert.ok(Buffer.byteLength(backend.value()) <= 131_072);
});

test('corrupt and secret-bearing stored history fails closed without resetting quota', async () => {
  const backend = memoryBackend();
  const store = createHistoryStore(backend, now);
  await store.reserve(request);
  const original = JSON.parse(backend.value());
  const cases = ['not JSON private-key', JSON.stringify({ ...original, secret: 'private-key' }), JSON.stringify({ ...original, usedCalls: -1 }), JSON.stringify({ ...original, quotaDate: '2026-02-30' }), JSON.stringify({ ...original, calls: [{ ...original.calls[0], apiKey: 'private-key' }] }), JSON.stringify({ ...original, calls: [{ ...original.calls[0], image: { ...original.calls[0].image, base64 } }] }), JSON.stringify({ ...original, calls: [original.calls[0], original.calls[0]] }), '字'.repeat(44_000)];
  for (const invalid of cases) {
    backend.seed(invalid);
    assert.equal((await store.read()).data, null);
    assert.equal((await store.reserve(request)).data, null);
    assert.notEqual((await store.clear()).error, null);
    assert.equal(backend.value(), invalid);
  }
});

test('repairing malformed history blocks further attempts today and restores service next day', async () => {
  const backend = memoryBackend();
  backend.seed('corrupt private content');
  const store = createHistoryStore(backend, now);
  assert.equal((await store.repair()).error, null);
  assert.deepEqual((await store.read()).data, { schemaVersion: 1, quotaDate: '2026-10-14', usedCalls: 100, calls: [] });
  assert.notEqual((await store.reserve(request)).error, null);
  assert.equal(backend.value().includes('private'), false);
  const nextDay = createHistoryStore(backend, () => new Date(2026, 9, 15, 0, 1));
  assert.equal((await nextDay.reserve(request)).error, null);
  assert.equal((await nextDay.read()).data.usedCalls, 1);
});

test('repairing valid history clears logs while preserving daily quota', async () => {
  const store = createHistoryStore(memoryBackend(), now);
  await store.reserve(request);
  assert.equal((await store.repair()).error, null);
  assert.deepEqual((await store.read()).data, { schemaVersion: 1, quotaDate: '2026-10-14', usedCalls: 1, calls: [] });
});

test('repair refuses to overwrite history when its storage cannot be read', async () => {
  let writes = 0;
  const store = createHistoryStore({ read: async () => ({ data: null, error: '暂时无法读取。' }), write: async () => { writes++; return success(undefined); } }, now);
  assert.equal((await store.repair()).error, '暂时无法读取。');
  assert.equal(writes, 0);
});

test('a failed repair write preserves corrupted history and does not report recovery', async () => {
  const backend = memoryBackend();
  backend.seed('corrupt original');
  backend.write = async () => ({ data: null, error: '存储不可写。' });
  const store = createHistoryStore(backend, now);
  assert.equal((await store.repair()).error, '存储不可写。');
  assert.equal(backend.value(), 'corrupt original');
  assert.notEqual((await store.read()).error, null);
});
