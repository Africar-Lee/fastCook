import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const credentialStore = {};
const historyStore = {};
const client = {};
const symbol = Symbol.for('fastcook.test.visionRecognition');
globalThis[symbol] = { credentialStore, historyStore, client };
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (!context.parentURL?.endsWith('/byok/recognition.ts')) return nextResolve(specifier, context);
  const exports = {
    './credentials': 'export const credentialStore = dependencies.credentialStore;',
    './history': 'export const historyStore = dependencies.historyStore;',
    './client': 'export const sendVisionRequest = (...args) => dependencies.client.sendVisionRequest(...args);',
  };
  if (exports[specifier]) return { url: `data:text/javascript,${encodeURIComponent(`const dependencies = globalThis[Symbol.for('fastcook.test.visionRecognition')]; ${exports[specifier]}`)}`, shortCircuit: true };
  return nextResolve(specifier === '../storage/types' ? `${specifier}.ts` : specifier, context);
} });
const { recognizePhoto } = await import('../byok/recognition.ts');
hooks.deregister();
delete globalThis[symbol];

const settings = { protocol: 'openai', providerName: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'test-model', dailyLimit: 10 };
const request = { settings, photo: { uri: 'processed photo', base64: 'processed bytes', width: 1, height: 1, bytes: 1, mimeType: 'image/jpeg' }, prompt: 'fixed prompt', body: 'preview request body' };
const visionResponse = { items: [{ name: '番茄', confidence: 0.9 }], usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } };
const ok = data => ({ data, error: null });
const fail = error => ({ data: null, error });

function setup(overrides = {}) {
  const events = [];
  credentialStore.read = async () => {
    events.push({ action: 'read' });
    return overrides.read ? overrides.read() : ok({ schemaVersion: 1, settings, apiKey: 'test-private-key' });
  };
  historyStore.reserve = async value => {
    events.push({ action: 'reserve', request: value });
    return overrides.reserve ? overrides.reserve(value) : ok({ id: 'call-1' });
  };
  client.sendVisionRequest = async (...args) => {
    events.push({ action: 'send', args });
    return overrides.send ? overrides.send(...args) : ok(visionResponse);
  };
  historyStore.finish = async (id, outcome) => {
    events.push({ action: 'finish', id, outcome });
    return overrides.finish ? overrides.finish(id, outcome) : ok(undefined);
  };
  return { events, signal: new AbortController().signal };
}

test('recognition requires configured credentials and does not reserve quota or send without them', async () => {
  const { events, signal } = setup({ read: () => ok(null) });
  assert.deepEqual(await recognizePhoto(request, signal), fail('请先设置识别模型和 API Key。'));
  assert.deepEqual(events.map(event => event.action), ['read']);
});

test('credential read failures stop recognition before request reservation or network access', async () => {
  const { events, signal } = setup({ read: () => fail('无法读取安全存储，请解锁手机后重试。') });
  assert.deepEqual(await recognizePhoto(request, signal), fail('无法读取安全存储，请解锁手机后重试。'));
  assert.deepEqual(events.map(event => event.action), ['read']);
});

test('changing configuration after preview requires a new preview and never sends to the changed provider', async () => {
  for (const changed of [{ model: 'new-model' }, { protocol: 'openai-compatible', endpoint: 'https://different.example/chat' }, { dailyLimit: 1 }]) {
    const { events, signal } = setup({ read: () => ok({ schemaVersion: 1, settings: { ...settings, ...changed }, apiKey: 'test-private-key' }) });
    assert.deepEqual(await recognizePhoto(request, signal), fail('模型配置已更改，请重新预览请求。'));
    assert.deepEqual(events.map(event => event.action), ['read']);
  }
});

test('already cancelled recognition does not read secrets, reserve quota or send', async () => {
  const { events } = setup();
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await recognizePhoto(request, controller.signal), fail('识别已取消。'));
  assert.deepEqual(events, []);
});

test('cancellation while credentials are read prevents quota reservation and sending', async () => {
  const controller = new AbortController();
  const { events } = setup({ read: () => {
    controller.abort();
    return ok({ schemaVersion: 1, settings, apiKey: 'test-private-key' });
  } });
  assert.deepEqual(await recognizePhoto(request, controller.signal), fail('识别已取消。'));
  assert.deepEqual(events.map(event => event.action), ['read']);
});

for (const error of ['今天的识别次数已用完，请明天再试。', '无法保存调用记录，请检查存储空间后重试。']) {
  test(`reservation failure stops networking and does not finish a nonexistent call: ${error}`, async () => {
    const { events, signal } = setup({ reserve: () => fail(error) });
    assert.deepEqual(await recognizePhoto(request, signal), fail(error));
    assert.deepEqual(events.map(event => event.action), ['read', 'reserve']);
  });
}

test('recognition reserves its exact preview before sending and records only result metadata on success', async () => {
  const { events, signal } = setup();
  assert.deepEqual(await recognizePhoto(request, signal), ok({ response: visionResponse, historyError: null }));
  assert.deepEqual(events.map(event => event.action), ['read', 'reserve', 'send', 'finish']);
  assert.equal(events[1].request, request);
  assert.deepEqual(events[2].args, [request, 'test-private-key', signal]);
  assert.deepEqual(events[3], { action: 'finish', id: 'call-1', outcome: { status: 'succeeded', itemCount: 1, usage: visionResponse.usage } });
  assert.equal(JSON.stringify(events[3]).includes('test-private-key'), false);
  assert.equal(JSON.stringify(events[3]).includes('番茄'), false);
});

test('provider failure marks the reserved call failed and does not retry', async () => {
  const error = '识别服务未接受 API Key，请检查密钥后重试。';
  const { events, signal } = setup({ send: () => fail(error) });
  assert.deepEqual(await recognizePhoto(request, signal), fail(error));
  assert.deepEqual(events.map(event => event.action), ['read', 'reserve', 'send', 'finish']);
  assert.deepEqual(events[3].outcome, { status: 'failed', error });
});

test('cancelling an active call propagates its signal and records cancellation', async () => {
  const controller = new AbortController();
  let started;
  const sending = new Promise(resolve => { started = resolve; });
  const { events } = setup({ send: async (_request, _key, signal) => {
    assert.equal(signal, controller.signal);
    started();
    return new Promise(resolve => signal.addEventListener('abort', () => resolve(fail('识别已取消。')), { once: true }));
  } });
  const result = recognizePhoto(request, controller.signal);
  await sending;
  controller.abort();
  assert.deepEqual(await result, fail('识别已取消。'));
  assert.deepEqual(events[3].outcome, { status: 'cancelled', error: '识别已取消。' });
});

test('cancellation during reservation reaches the client already aborted and is recorded without a network attempt', async () => {
  const controller = new AbortController();
  let networkAttempts = 0;
  const { events } = setup({ reserve: () => { controller.abort(); return ok({ id: 'call-1' }); }, send: (_request, _key, signal) => {
    if (signal.aborted) return fail('识别已取消。');
    networkAttempts++;
    return ok(visionResponse);
  } });
  assert.deepEqual(await recognizePhoto(request, controller.signal), fail('识别已取消。'));
  assert.equal(networkAttempts, 0);
  assert.deepEqual(events[3].outcome, { status: 'cancelled', error: '识别已取消。' });
});

test('failed history finalization preserves a successful recognition result with a separate warning', async () => {
  const historyError = '调用记录未能保存，请检查存储空间。';
  const { events, signal } = setup({ finish: () => fail(historyError) });
  assert.deepEqual(await recognizePhoto(request, signal), ok({ response: visionResponse, historyError }));
  assert.equal(events.filter(event => event.action === 'send').length, 1);
  assert.deepEqual(events[3].outcome, { status: 'succeeded', itemCount: 1, usage: visionResponse.usage });
});

test('failed history finalization preserves the provider error and adds a fixed storage warning', async () => {
  const { events, signal } = setup({ send: () => fail('识别请求超过45秒，已停止等待，请稍后重试。'), finish: () => fail('private storage diagnostic') });
  const result = await recognizePhoto(request, signal);
  assert.equal(result.data, null);
  assert.equal(result.error, '识别请求超过45秒，已停止等待，请稍后重试。 调用记录未能更新，请检查存储空间。');
  assert.equal(result.error.includes('private'), false);
  assert.equal(events.filter(event => event.action === 'send').length, 1);
});
