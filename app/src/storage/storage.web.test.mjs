import assert from 'node:assert/strict';
import test from 'node:test';
import { kitchenStorage } from './storage.web.ts';

function replaceStorage(context, storage) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
}

test('web persistence writes and restores a single bounded record', async (context) => {
  const entries = new Map();
  replaceStorage(context, {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  });
  assert.deepEqual(await kitchenStorage.read(), { data: null, error: null });
  assert.equal((await kitchenStorage.write('{"version":1}')).error, null);
  assert.equal((await kitchenStorage.read()).data, '{"version":1}');
  assert.equal(entries.size, 1);
  assert.notEqual((await kitchenStorage.write(' '.repeat(65_537))).error, null);
  assert.equal((await kitchenStorage.read()).data, '{"version":1}');
});

test('web storage failures return actionable errors without exception details', async (context) => {
  replaceStorage(context, {
    getItem: () => { throw new DOMException('private account details', 'SecurityError'); },
    setItem: () => { throw new DOMException('private account details', 'QuotaExceededError'); },
  });
  const read = await kitchenStorage.read();
  const write = await kitchenStorage.write('new state');
  assert.match(read.error, /读取/);
  assert.match(write.error, /未保存/);
  assert.equal(read.error.includes('private account'), false);
  assert.equal(write.error.includes('private account'), false);
});

test('explicit web reset replaces the previous malformed record', async (context) => {
  let value = 'invalid';
  replaceStorage(context, { getItem: () => value, setItem: (_key, next) => { value = next; } });
  assert.equal((await kitchenStorage.reset('{"schemaVersion":1}')).error, null);
  assert.equal(value, '{"schemaVersion":1}');
});
