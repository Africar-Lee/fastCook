import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VISION_SETTINGS } from '../byok/config.ts';
import { credentialStore } from '../byok/credentials.web.ts';

test('web credentials exist only in module memory and never use browser storage', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Browser storage must not receive API keys'); } });
  const settings = { ...DEFAULT_VISION_SETTINGS, model: 'vision-model' };
  assert.equal((await credentialStore.save(settings, 'private-key')).error, null);
  assert.equal((await credentialStore.read()).data.apiKey, 'private-key');
  assert.equal((await credentialStore.remove()).error, null);
  assert.equal((await credentialStore.read()).data, null);
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
});
