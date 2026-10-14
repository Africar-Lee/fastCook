import assert from 'node:assert/strict';
import test from 'node:test';
import { createCredentialStore, DEFAULT_VISION_SETTINGS, MAX_CREDENTIAL_BYTES, utf8Bytes, validateVisionCredentials, validateVisionSettings } from '../byok/config.ts';

const settings = { ...DEFAULT_VISION_SETTINGS, model: 'vision-model' };
const compatible = { ...settings, protocol: 'openai-compatible', providerName: '自建服务', endpoint: 'https://vision.example/v1/chat/completions' };
const success = data => ({ data, error: null });
function memoryBackend() {
  let value = null;
  return { read: async () => success(value), write: async next => { value = next; return success(undefined); }, remove: async () => { value = null; return success(undefined); }, value: () => value };
}

test('settings accepts an explicit HTTPS endpoint and never adds an API path', () => {
  assert.deepEqual(validateVisionSettings(compatible), success(compatible));
  assert.equal(validateVisionSettings({ ...compatible, endpoint: 'https://vision.example/' }).data, null);
  assert.equal(validateVisionSettings({ ...settings, endpoint: compatible.endpoint }).data, null);
});

for (const endpoint of ['http://vision.example/chat', 'https://user:pass@vision.example/chat', 'https://@vision.example/chat', 'https://:@vision.example/chat', 'https://vision.example/chat?key=secret', 'https://vision.example/chat?', 'https://vision.example/chat#secret', 'https://vision.example/chat#', 'https://vision.example\\@attacker.example/chat', 'https://vision.example/with space', 'https://vision.example/chat\n']) {
  test(`settings rejects unsafe endpoint ${JSON.stringify(endpoint)}`, () => {
    const result = validateVisionSettings({ ...compatible, endpoint });
    assert.equal(result.data, null);
    assert.equal(result.error.includes(endpoint), false);
  });
}

for (const changes of [{ extra: 'x' }, { providerName: '' }, { providerName: 'a'.repeat(49) }, { model: '' }, { model: 'a'.repeat(129) }, { model: 'secret\nheader' }, { dailyLimit: 0 }, { dailyLimit: 101 }, { dailyLimit: 1.5 }]) {
  test(`settings rejects invalid fields ${JSON.stringify(changes)}`, () => assert.equal(validateVisionSettings({ ...settings, ...changes }).data, null));
}

test('credential validation rejects unknown data, control characters and oversized records', () => {
  const valid = { schemaVersion: 1, settings, apiKey: 'secret-key' };
  assert.deepEqual(validateVisionCredentials(valid), success(valid));
  for (const change of [{ schemaVersion: 2 }, { apiKey: 'secret\r\nHeader: x' }, { apiKey: ' secret' }, { apiKey: 'secret key' }, { apiKey: 'x'.repeat(1025) }, { photo: 'private photo' }]) assert.equal(validateVisionCredentials({ ...valid, ...change }).data, null);
  const huge = { ...valid, settings: { ...compatible, endpoint: `https://vision.example/${'x'.repeat(470)}`, providerName: '食'.repeat(48), model: '食'.repeat(128) }, apiKey: 'x'.repeat(1024) };
  assert.ok(utf8Bytes(JSON.stringify(huge)) > MAX_CREDENTIAL_BYTES);
  assert.equal(validateVisionCredentials(huge).data, null);
});

test('saving an empty key retains it only for the same protocol and exact endpoint', async () => {
  const backend = memoryBackend();
  const store = createCredentialStore(backend);
  assert.equal((await store.save(settings, '')).data, null);
  assert.deepEqual(await store.save(settings, 'private-key'), success(settings));
  const updated = { ...settings, model: 'new-model', dailyLimit: 3 };
  assert.deepEqual(await store.save(updated, ''), success(updated));
  assert.equal((await store.read()).data.apiKey, 'private-key');
  assert.equal((await store.save({ ...updated, protocol: 'openai-compatible' }, '')).data, null);
  assert.equal((await store.save(compatible, '')).data, null);
  assert.equal((await store.read()).data.settings.endpoint, settings.endpoint);
  assert.deepEqual(await store.save(compatible, 'new-private-key'), success(compatible));
});

test('failed save and deletion retain the original credential and report errors', async () => {
  const backend = memoryBackend();
  const store = createCredentialStore(backend);
  await store.save(settings, 'private-key');
  backend.write = async () => ({ data: null, error: '安全存储不可写。' });
  backend.remove = async () => ({ data: null, error: '安全存储不可写。' });
  assert.equal((await store.save(settings, 'new-key')).error, '安全存储不可写。');
  assert.equal((await store.remove()).error, '安全存储不可写。');
  assert.equal((await store.read()).data.apiKey, 'private-key');
});

test('credentials reject corrupt persisted values without exposing their content', async () => {
  for (const value of ['private corrupt data', 'x'.repeat(2049), JSON.stringify({ schemaVersion: 1, settings, apiKey: 'private-key', injected: true })]) {
    const result = await createCredentialStore({ read: async () => success(value), write: async () => success(undefined), remove: async () => success(undefined) }).read();
    assert.equal(result.data, null);
    assert.equal(result.error.includes('private'), false);
  }
});

test('credential operations serialize across store instances to preserve save and delete order', async () => {
  const backend = memoryBackend();
  const first = createCredentialStore(backend);
  const second = createCredentialStore(backend);
  const saved = first.save(settings, 'private-key');
  const removed = second.remove();
  const read = first.read();
  assert.equal((await saved).error, null);
  assert.equal((await removed).error, null);
  assert.deepEqual(await read, success(null));
});
