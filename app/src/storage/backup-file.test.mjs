import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { MAX_BACKUP_BYTES } from './backup.ts';

const fileSystem = { Directory: {}, File: {}, FileMode: { ReadOnly: 'r' } };
const stubKey = Symbol.for('fastcook.test.backupFileSystem');
globalThis[stubKey] = fileSystem;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== 'expo-file-system') return nextResolve(specifier, context);
  return { url: `data:text/javascript,${encodeURIComponent("export const { Directory, File, FileMode } = globalThis[Symbol.for('fastcook.test.backupFileSystem')];")}`, shortCircuit: true };
} });
const { exportKitchenBackup, importKitchenBackup } = await import('./backup-file.ts');
hooks.deregister();
delete globalThis[stubKey];

test('native backup import opens a read-only handle and bounds reads before decoding', async () => {
  const content = '{"中文":"备份"}';
  let closed = false;
  fileSystem.File.pickFileAsync = async (initialUri, mimeType) => {
    assert.equal(initialUri, undefined);
    assert.equal(mimeType, 'application/json');
    return { open: mode => {
      assert.equal(mode, 'r');
      return { readBytes: limit => { assert.equal(limit, MAX_BACKUP_BYTES + 1); return new TextEncoder().encode(content); }, close: () => { closed = true; } };
    } };
  };
  assert.deepEqual(await importKitchenBackup(), { status: 'selected', content, error: null });
  assert.equal(closed, true);
});

test('native backup import rejects oversized files and releases the handle', async () => {
  let closed = false;
  fileSystem.File.pickFileAsync = async () => ({ open: () => ({ readBytes: limit => new Uint8Array(limit), close: () => { closed = true; } }) });
  const result = await importKitchenBackup();
  assert.equal(result.status, 'failed');
  assert.match(result.error, /128 KB/);
  assert.equal(closed, true);
});

test('native backup import reports read failures without leaking paths and still closes the file', async () => {
  let closed = false;
  fileSystem.File.pickFileAsync = async () => ({ open: () => ({ readBytes: () => { throw new Error('private path'); }, close: () => { closed = true; } }) });
  const result = await importKitchenBackup();
  assert.equal(result.status, 'failed');
  assert.equal(result.error.includes('private'), false);
  assert.equal(closed, true);
});

for (const stage of ['picker', 'open', 'close']) {
  test(`native backup ${stage} failure returns an actionable error`, async () => {
    fileSystem.File.pickFileAsync = async () => {
      if (stage === 'picker') throw new Error('private path');
      return { open: () => {
        if (stage === 'open') throw new Error('private path');
        return { readBytes: () => new Uint8Array(), close: () => { throw new Error('private path'); } };
      } };
    };
    const result = await importKitchenBackup();
    assert.equal(result.status, 'failed');
    assert.equal(result.error.includes('private'), false);
    assert.match(result.error, /重试|重新选择/);
  });
}

test('native backup cancellation leaves storage untouched', async () => {
  fileSystem.File.pickFileAsync = async () => { throw { code: 'ERR_PICKER_CANCELLED' }; };
  assert.deepEqual(await importKitchenBackup(), { status: 'cancelled', error: null });
});

test('native backup export writes only into a user-selected directory with a safe filename', async () => {
  const backup = { format: 'fastcook-kitchen', version: 1, kitchen: { currentIds: ['egg'] } };
  let written;
  fileSystem.Directory.pickDirectoryAsync = async () => ({ createFile: (name, mimeType) => {
    assert.match(name, /^fastcook-backup-\d+\.json$/);
    assert.equal(mimeType, 'application/json');
    return { write: content => { written = content; } };
  } });
  assert.equal((await exportKitchenBackup(backup)).status, 'saved');
  assert.deepEqual(JSON.parse(written), backup);
});

test('native backup export cancellation does not claim success', async () => {
  fileSystem.Directory.pickDirectoryAsync = async () => { throw { code: 'ERR_PICKER_CANCELLED' }; };
  assert.equal((await exportKitchenBackup({})).status, 'cancelled');
});

for (const stage of ['picker', 'create', 'write']) {
  test(`native backup export ${stage} failure can be retried without exposing details`, async () => {
    fileSystem.Directory.pickDirectoryAsync = async () => {
      if (stage === 'picker') throw new Error('private path');
      return { createFile: () => {
        if (stage === 'create') throw new Error('private path');
        return { write: () => { throw new Error('private path'); } };
      } };
    };
    const result = await exportKitchenBackup({});
    assert.equal(result.status, 'failed');
    assert.equal(result.error.includes('private'), false);
  });
}
