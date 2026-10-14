import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { DEFAULT_VISION_SETTINGS } from '../byok/config.ts';

let value = null;
let fail = null;
const writes = [];
const secureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: async () => { if (fail === 'read') throw new Error('private-key'); return value; },
  setItemAsync: async (key, content, options) => { if (fail === 'write') throw new Error('private-key'); writes.push({ key, content, options }); value = content; },
  deleteItemAsync: async () => { if (fail === 'remove') throw new Error('private-key'); value = null; },
};
const stubKey = Symbol.for('fastcook.test.byokSecureStore');
globalThis[stubKey] = secureStore;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== 'expo-secure-store') return nextResolve(specifier, context);
  return { url: `data:text/javascript,${encodeURIComponent("const store = globalThis[Symbol.for('fastcook.test.byokSecureStore')]; export const { WHEN_UNLOCKED_THIS_DEVICE_ONLY, getItemAsync, setItemAsync, deleteItemAsync } = store;")}`, shortCircuit: true };
} });
const { credentialStore } = await import('../byok/credentials.ts');
hooks.deregister();
delete globalThis[stubKey];
const settings = { ...DEFAULT_VISION_SETTINGS, model: 'vision-model' };

test('native credentials store settings and API key together using device-only unlocked access', async () => {
  assert.equal((await credentialStore.save(settings, 'private-key')).error, null);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].content), { schemaVersion: 1, settings, apiKey: 'private-key' });
  assert.deepEqual(writes[0].options, { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  assert.equal((await credentialStore.read()).data.apiKey, 'private-key');
});

for (const operation of ['read', 'write', 'remove']) {
  test(`native ${operation} failure is reported without exposing secure store details`, async () => {
    fail = operation;
    const result = operation === 'write' ? await credentialStore.save(settings, 'another-key') : await credentialStore[operation]();
    assert.equal(result.data, null);
    assert.equal(result.error.includes('private-key'), false);
    fail = null;
    assert.equal((await credentialStore.read()).data.apiKey, 'private-key');
  });
}

test('native credential deletion reports success only after the secure record is removed', async () => {
  assert.equal((await credentialStore.remove()).error, null);
  assert.equal(value, null);
  assert.equal((await credentialStore.read()).data, null);
});
