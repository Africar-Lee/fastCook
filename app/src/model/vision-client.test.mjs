import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { buildVisionRequest, VISION_CLIENT_ERRORS, VISION_PROMPT } from '../byok/request.ts';
import { DEFAULT_VISION_SETTINGS } from '../byok/config.ts';

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== 'expo/fetch') return nextResolve(specifier, context);
  return { url: `data:text/javascript,${encodeURIComponent('export const fetch = () => { throw new Error("unexpected implicit network call"); };')}`, shortCircuit: true };
} });
const { sendVisionRequest, MAX_VISION_RESPONSE_BYTES } = await import('../byok/client.ts');
hooks.deregister();
const invalidBase64 = 'invalid-image-data';
const jpeg = '/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD4vooor+Uz/fw//9k=';
const photo = { uri: `data:image/jpeg;base64,${jpeg}`, base64: jpeg, width: 1, height: 1, bytes: 641, mimeType: 'image/jpeg' };
const settings = { ...DEFAULT_VISION_SETTINGS, model: 'test-vision-model' };
const request = () => {
  const result = buildVisionRequest(settings, photo);
  assert.equal(result.error, null);
  return result.data;
};
const responseBody = () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"items":[{"name":"番茄","confidence":0.9}]}' } }] });
const response = () => new Response(responseBody(), { status: 200 });

test('request preview includes only the model, fixed prompt, processed photo and output cap without networking', () => {
  const inputSettings = { ...settings };
  const inputPhoto = { ...photo };
  const built = buildVisionRequest(inputSettings, inputPhoto).data;
  const body = JSON.parse(built.body);
  assert.deepEqual(Object.keys(body).sort(), ['max_completion_tokens', 'messages', 'model']);
  assert.equal(body.max_completion_tokens, 1200);
  assert.deepEqual(body.messages, [{ role: 'user', content: [{ type: 'text', text: VISION_PROMPT }, { type: 'image_url', image_url: { url: photo.uri } }] }]);
  assert.ok(!built.body.includes('apiKey'));
  assert.ok(!built.body.includes('inventory'));
  assert.ok(!built.body.includes('history'));
  inputSettings.endpoint = 'https://other.example/completions';
  inputPhoto.base64 = invalidBase64;
  assert.equal(built.settings.endpoint, settings.endpoint);
  assert.equal(built.photo.base64, jpeg);
  assert.ok(Object.isFrozen(built) && Object.isFrozen(built.settings) && Object.isFrozen(built.photo));
});

test('compatible protocol uses its exact full URL and max_tokens instead of OpenAI output cap', () => {
  const config = { ...settings, protocol: 'openai-compatible', providerName: 'Example', endpoint: 'https://example.com/custom/chat' };
  const built = buildVisionRequest(config, photo);
  assert.equal(built.error, null);
  assert.equal(built.data.settings.endpoint, config.endpoint);
  assert.equal(JSON.parse(built.data.body).max_tokens, 1200);
  assert.equal(JSON.parse(built.data.body).max_completion_tokens, undefined);
});

test('request construction rejects invalid settings and malformed photos without network access', () => {
  assert.notEqual(buildVisionRequest({ ...settings, endpoint: 'http://example.com/v1' }, photo).error, null);
  assert.notEqual(buildVisionRequest(settings, { ...photo, base64: invalidBase64 }).error, null);
  assert.notEqual(buildVisionRequest(settings, { ...photo, width: 1281 }).error, null);
});

test('client sends the exact preview once, keeps the secret in the authorization header and disables redirects and cookies', async () => {
  const built = request();
  const calls = [];
  const result = await sendVisionRequest(built, 'test-secret', undefined, { fetch: async (url, options) => {
    calls.push({ url, options });
    return response();
  } });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { items: [{ name: '番茄', confidence: 0.9 }], usage: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, built.settings.endpoint);
  assert.equal(calls[0].options.body, built.body);
  assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('client refuses changed preview bodies, prompts and unsafe header keys before sending', async () => {
  const built = request();
  let calls = 0;
  const options = { fetch: async () => { calls++; return response(); } };
  for (const altered of [{ ...built, body: `${built.body} ` }, { ...built, body: JSON.stringify({ model: 'another-model' }) }, { ...built, prompt: 'another prompt' }]) {
    assert.equal((await sendVisionRequest(altered, 'test-secret', undefined, options)).error, VISION_CLIENT_ERRORS.changedRequest);
  }
  for (const key of ['', 'key\r\nX-Stolen: yes', ' key', '密钥', 'a'.repeat(1025)]) {
    assert.equal((await sendVisionRequest(built, key, undefined, options)).error, VISION_CLIENT_ERRORS.key);
  }
  assert.equal(calls, 0);
});

for (const [status, expected] of [[301, 'redirect'], [307, 'redirect'], [401, 'auth'], [403, 'forbidden'], [429, 'rate'], [400, 'model'], [404, 'model'], [415, 'model'], [500, 'network']]) {
  test(`HTTP ${status} gives a fixed actionable error and never retries or exposes the provider body`, async () => {
    let calls = 0;
    const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async () => {
      calls++;
      return new Response('private secret echoed by provider', { status });
    } });
    assert.equal(result.error, VISION_CLIENT_ERRORS[expected]);
    assert.equal(result.error.includes('secret'), false);
    assert.equal(calls, 1);
  });
}

test('client rejects unexpected redirected responses and never follows their Location', async () => {
  for (const extra of [{ redirected: true, url: settings.endpoint }, { redirected: false, url: 'https://other.example/completions' }, { redirected: false, url: 'invalid response URL' }]) {
    let calls = 0;
    const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async () => {
      calls++;
      return { status: 200, headers: new Headers(), body: response().body, ...extra };
    } });
    assert.equal(result.error, VISION_CLIENT_ERRORS.redirect);
    assert.equal(calls, 1);
  }
});

test('client accepts URL normalization without changing the exact configured send address', async () => {
  const config = { ...settings, protocol: 'openai-compatible', endpoint: 'https://VISION.EXAMPLE:443/识别' };
  const built = buildVisionRequest(config, photo).data;
  const result = await sendVisionRequest(built, 'test-secret', undefined, { fetch: async (url, options) => {
    assert.equal(url, config.endpoint);
    assert.equal(options.redirect, 'error');
    return { status: 200, headers: new Headers(), body: response().body, redirected: false, url: 'https://vision.example/%E8%AF%86%E5%88%AB' };
  } });
  assert.equal(result.error, null);
  assert.equal(result.data.items[0].name, '番茄');
});

test('client rejects oversized content length before reading a response stream', async () => {
  const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async () => ({
    status: 200, headers: new Headers({ 'content-length': String(MAX_VISION_RESPONSE_BYTES + 1) }), redirected: false, url: '',
    body: { getReader() { throw new Error('must not read the oversized body'); } },
  }) });
  assert.equal(result.error, VISION_CLIENT_ERRORS.oversize);
});

test('client bounds streamed bytes even when Content-Length is missing or false', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    let networkSignal;
    const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async (_url, options) => {
      networkSignal = options.signal;
      const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_VISION_RESPONSE_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
      return new Response(stream, { headers });
    } });
    assert.equal(result.error, VISION_CLIENT_ERRORS.oversize);
    assert.equal(networkSignal.aborted, true);
  }
});

test('client decodes Chinese text across chunk boundaries without corrupting names', async () => {
  const bytes = new TextEncoder().encode(responseBody());
  const stream = new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1));
    controller.close();
  } });
  const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async () => new Response(stream) });
  assert.equal(result.data.items[0].name, '番茄');
});

test('client returns fixed errors for malformed JSON, invalid UTF-8 and stream failures', async () => {
  for (const makeResponse of [
    () => new Response('private invalid JSON'),
    () => new Response(new Uint8Array([0xff, 0xfe])),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private stream secret')); } })),
  ]) {
    const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async () => makeResponse() });
    assert.ok([VISION_CLIENT_ERRORS.badResponse, VISION_CLIENT_ERRORS.network].includes(result.error));
    assert.equal(result.error.includes('private'), false);
  }
});

test('a request already cancelled never starts networking', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await sendVisionRequest(request(), 'test-secret', controller.signal, { fetch: async () => { calls++; return response(); } });
  assert.equal(result.error, VISION_CLIENT_ERRORS.cancelled);
  assert.equal(calls, 0);
});

test('user cancellation aborts an active call and does not retry even if a transport never resolves', async () => {
  const controller = new AbortController();
  let networkSignal;
  let calls = 0;
  const pending = sendVisionRequest(request(), 'test-secret', controller.signal, { fetch: async (_url, options) => {
    calls++;
    networkSignal = options.signal;
    return new Promise(() => {});
  } });
  controller.abort();
  assert.equal((await pending).error, VISION_CLIENT_ERRORS.cancelled);
  assert.equal(networkSignal.aborted, true);
  assert.equal(calls, 1);
});

test('the timeout stops both a pending fetch and a hanging response stream', async () => {
  for (const bodyReceived of [false, true]) {
    let networkSignal;
    const result = await sendVisionRequest(request(), 'test-secret', undefined, { timeoutMs: 5, fetch: async (_url, options) => {
      networkSignal = options.signal;
      if (!bodyReceived) return new Promise(() => {});
      return new Response(new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(new Error('aborted'))); } }));
    } });
    assert.equal(result.error, VISION_CLIENT_ERRORS.timeout);
    assert.equal(networkSignal.aborted, true);
  }
});

test('network failures do not expose raw error text or API keys and are never retried', async () => {
  let calls = 0;
  const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async () => {
    calls++;
    throw new TypeError('private test-secret provider response');
  } });
  assert.equal(result.error, VISION_CLIENT_ERRORS.network);
  assert.equal(calls, 1);
});

test('client handles synchronous transport failures without leaking their diagnostic text', async () => {
  const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: () => { throw new TypeError('private test-secret transport error'); } });
  assert.equal(result.error, VISION_CLIENT_ERRORS.network);
});

test('Expo redirect rejection is reported with a fixed message', async () => {
  const result = await sendVisionRequest(request(), 'test-secret', undefined, { fetch: async () => {
    throw new Error("fetch failed: Redirect is not allowed when redirect mode is 'error'");
  } });
  assert.equal(result.error, VISION_CLIENT_ERRORS.redirect);
});
