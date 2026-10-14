import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { MAX_MEDIA_PACKAGE_BYTES } from '../model/recipe-media.ts';

const state = {};
class FakeFile {
  constructor(directory, name) {
    this.name = name; this.uri = `${typeof directory === 'string' ? directory : directory.uri}/${name}`;
    this.exists = false; this.lastModified = Date.now();
  }
  create() {
    if (state.failure === 'create') throw new Error('private cache path');
    this.exists = true; state.files.push(this);
  }
  write(content) {
    if (state.failure === 'write') throw new Error('private cache path');
    this.content = content;
  }
  delete() {
    if (this.failDelete || state.failure === 'delete') throw new Error('private cache path');
    this.exists = false; state.deleted.push(this);
  }
}
class FakeDirectory {
  constructor(directory, name) { this.uri = `${typeof directory === 'string' ? directory : directory.uri}/${name}`; }
  create(options) {
    assert.deepEqual(options, { intermediates: true, idempotent: true });
    if (state.failure === 'directory') throw new Error('private cache path');
  }
  list() {
    if (state.failure === 'list') throw new Error('private cache path');
    return [...state.files, ...state.otherEntries];
  }
  createFile(name, mimeType) {
    state.exportedNames.push(name); assert.equal(mimeType, 'application/json');
    const file = new FakeFile(this, name); file.create(); return file;
  }
}
const sharing = {};
const stubKey = Symbol.for('fastcook.test.recipeFileSystem');
globalThis[stubKey] = { Directory: FakeDirectory, File: FakeFile, FileMode: { ReadOnly: 'r' }, Paths: { cache: 'file:///cache' }, sharing };
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (!['expo-file-system', 'expo-sharing'].includes(specifier)) return nextResolve(specifier, context);
  const source = specifier === 'expo-file-system'
    ? "export const { Directory, File, FileMode, Paths } = globalThis[Symbol.for('fastcook.test.recipeFileSystem')];"
    : "const { sharing } = globalThis[Symbol.for('fastcook.test.recipeFileSystem')]; export const isAvailableAsync = (...args) => sharing.isAvailableAsync(...args); export const shareAsync = (...args) => sharing.shareAsync(...args);";
  return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
} });
const { exportRecipeFile, importRecipeFile, shareRecipeFile } = await import('./recipe-file.ts');
hooks.deregister(); delete globalThis[stubKey];

test.beforeEach(() => {
  Object.assign(state, { failure: null, files: [], otherEntries: [], deleted: [], exportedNames: [], shared: [] });
  FakeDirectory.pickDirectoryAsync = async () => new FakeDirectory('content://user', 'chosen');
  FakeFile.pickFileAsync = async () => ({ open: () => ({ readBytes: () => new TextEncoder().encode('{}'), close() {} }) });
  sharing.isAvailableAsync = async () => true;
  sharing.shareAsync = async (uri, options) => { state.shared.push({ uri, options }); };
});

function cacheFile(name, modified) {
  const file = new FakeFile('file:///cache/fastcook-recipe-shares', name);
  file.exists = true; file.lastModified = modified; state.files.push(file);
  return file;
}

test('native recipe export writes the supplied JSON to the selected directory with a fixed safe filename', async () => {
  const content = JSON.stringify({ name: '../../用户/菜谱', recipes: [] });
  assert.deepEqual(await exportRecipeFile(content), { status: 'saved', error: null });
  assert.match(state.exportedNames[0], /^fastcook-recipes-\d+\.json$/);
  assert.equal(state.files[0].content, content);
  assert.match(state.files[0].uri, /^content:\/\/user\/chosen\//);
});

test('native recipe export cancellation does not create a file or claim success', async () => {
  FakeDirectory.pickDirectoryAsync = async () => { throw { code: 'ERR_PICKER_CANCELLED' }; };
  assert.deepEqual(await exportRecipeFile('{}'), { status: 'cancelled', error: null });
  assert.equal(state.files.length, 0);
});

for (const stage of ['picker', 'create', 'write']) {
  test(`native recipe export ${stage} failure reports a safe retryable error`, async () => {
    state.failure = stage;
    if (stage === 'picker') FakeDirectory.pickDirectoryAsync = async () => { throw new Error('private path'); };
    const result = await exportRecipeFile('{}');
    assert.equal(result.status, 'failed');
    assert.match(result.error, /重试|重新选择/);
    assert.equal(result.error.includes('private'), false);
  });
}

test('native export and share reject invalid or oversized UTF-8 content before any system action', async () => {
  FakeDirectory.pickDirectoryAsync = async () => { assert.fail('must not open a directory'); };
  sharing.isAvailableAsync = async () => { assert.fail('must not query sharing'); };
  for (const content of [null, ' '.repeat(MAX_MEDIA_PACKAGE_BYTES + 1), '中'.repeat(Math.ceil(MAX_MEDIA_PACKAGE_BYTES / 3))]) {
    assert.equal((await exportRecipeFile(content)).status, 'failed');
    assert.equal((await shareRecipeFile(content)).status, 'failed');
  }
});

test('native recipe import reads a bounded read-only handle and releases it', async () => {
  const content = '{"菜谱":"蒸蛋"}';
  let closed = false;
  FakeFile.pickFileAsync = async (initialUri, mime) => {
    assert.equal(initialUri, undefined); assert.equal(mime, 'application/json');
    return { open: mode => {
      assert.equal(mode, 'r');
      return { readBytes: limit => { assert.equal(limit, MAX_MEDIA_PACKAGE_BYTES + 1); return new TextEncoder().encode(content); }, close: () => { closed = true; } };
    } };
  };
  assert.deepEqual(await importRecipeFile(), { status: 'selected', content, error: null });
  assert.equal(closed, true);
});

test('native recipe import rejects excessive bytes and closes the handle', async () => {
  let closed = false;
  FakeFile.pickFileAsync = async () => ({ open: () => ({ readBytes: limit => new Uint8Array(limit), close: () => { closed = true; } }) });
  const result = await importRecipeFile();
  assert.equal(result.status, 'failed'); assert.match(result.error, /48 MiB/); assert.equal(closed, true);
});

test('native recipe import cancellation and multiple selections cannot become success', async () => {
  FakeFile.pickFileAsync = async () => { throw { code: 'ERR_PICKER_CANCELLED' }; };
  assert.deepEqual(await importRecipeFile(), { status: 'cancelled', error: null });
  FakeFile.pickFileAsync = async () => [];
  assert.equal((await importRecipeFile()).status, 'failed');
});

for (const stage of ['picker', 'open', 'read', 'close']) {
  test(`native recipe import ${stage} failure has safe context and releases open handles`, async () => {
    let closed = false;
    FakeFile.pickFileAsync = async () => {
      if (stage === 'picker') throw new Error('private path');
      return { open: () => {
        if (stage === 'open') throw new Error('private path');
        return { readBytes: () => { if (stage === 'read') throw new Error('private path'); return new Uint8Array(); },
          close: () => { closed = true; if (stage === 'close') throw new Error('private path'); } };
      } };
    };
    const result = await importRecipeFile();
    assert.equal(result.status, 'failed'); assert.match(result.error, /重试|重新选择/); assert.equal(result.error.includes('private'), false);
    assert.equal(closed, ['read', 'close'].includes(stage));
  });
}

test('native import preserves the primary read error when closing also fails', async () => {
  FakeFile.pickFileAsync = async () => ({ open: () => ({ readBytes: () => { throw new Error('private read'); }, close: () => { throw new Error('private close'); } }) });
  assert.match((await importRecipeFile()).error, /读取失败/);
});

test('native sharing provides JSON options and retains the attachment after the chooser closes', async () => {
  const content = '{"recipes":[]}';
  assert.deepEqual(await shareRecipeFile(content), { status: 'closed', error: null });
  assert.deepEqual(state.shared[0].options, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: '分享菜谱' });
  assert.match(state.shared[0].uri, /^file:\/\/\/cache\/fastcook-recipe-shares\/fastcook-recipes-\d+\.json$/);
  assert.equal(state.files[0].content, content); assert.equal(state.files[0].exists, true); assert.equal(state.deleted.length, 0);
});

test('native unavailable sharing is reported without creating a cache file', async () => {
  sharing.isAvailableAsync = async () => false;
  assert.deepEqual(await shareRecipeFile('{}'), { status: 'unsupported', error: null });
  assert.equal(state.files.length, 0);
});

test('native sharing availability failure does not expose platform details', async () => {
  sharing.isAvailableAsync = async () => { throw new Error('private app path'); };
  const result = await shareRecipeFile('{}');
  assert.equal(result.status, 'failed'); assert.equal(result.error.includes('private'), false); assert.equal(state.files.length, 0);
});

for (const stage of ['directory', 'create', 'write']) {
  test(`native sharing ${stage} failure never opens a share sheet`, async () => {
    state.failure = stage;
    const result = await shareRecipeFile('{}');
    assert.equal(result.status, 'failed'); assert.equal(result.error.includes('private'), false); assert.equal(state.shared.length, 0);
    if (stage === 'write') assert.equal(state.files[0].exists, false);
  });
}

for (const cancelled of [true, false]) {
  test(`native share ${cancelled ? 'cancellation' : 'failure'} clears only this operation's cache file`, async () => {
    const recent = cacheFile('fastcook-recipes-100.json', Date.now());
    sharing.shareAsync = async () => { throw cancelled ? new DOMException('private cancel', 'AbortError') : new Error('private path'); };
    const result = await shareRecipeFile('{}');
    assert.equal(result.status, cancelled ? 'cancelled' : 'failed');
    assert.equal(result.error?.includes('private') ?? false, false);
    assert.equal(recent.exists, true); assert.equal(state.files[1].exists, false);
  });
}

test('share cache cleanup failure preserves the cancellation status', async () => {
  state.failure = 'delete';
  sharing.shareAsync = async () => { throw new DOMException('private cancel', 'AbortError'); };
  const result = await shareRecipeFile('{}');
  assert.equal(result.status, 'cancelled'); assert.equal(result.error, null); assert.match(result.cleanupError, /缓存/);
});

test('native sharing cleans only matching cache files older than twenty-four hours', async context => {
  context.mock.method(Date, 'now', () => 200_000_000);
  const old = cacheFile('fastcook-recipes-1.json', 200_000_000 - 86_400_001);
  const boundary = cacheFile('fastcook-recipes-2.json', 200_000_000 - 86_400_000);
  const recent = cacheFile('fastcook-recipes-3.json', 199_999_999);
  const unknown = cacheFile('fastcook-recipes-4.json', null);
  const future = cacheFile('fastcook-recipes-5.json', 200_000_001);
  const other = cacheFile('unrelated.json', 0);
  const directory = new FakeDirectory('file:///cache/fastcook-recipe-shares', 'fastcook-recipes-6.json');
  directory.delete = () => { assert.fail('must not delete nested directories'); }; state.otherEntries.push(directory);
  assert.equal((await shareRecipeFile('{}')).status, 'closed');
  assert.equal(old.exists, false);
  for (const file of [boundary, recent, unknown, future, other]) assert.equal(file.exists, true);
  assert.deepEqual(state.deleted, [old]);
});

test('expired-cache cleanup failure does not report a share operation as failed', async () => {
  const old = cacheFile('fastcook-recipes-1.json', 0); old.failDelete = true;
  const result = await shareRecipeFile('{}');
  assert.equal(result.status, 'closed'); assert.equal(result.error, null); assert.match(result.cleanupError, /缓存/);
  assert.equal(state.shared.length, 1);
});

test('native concurrent shares cannot replace the pending attachment', async () => {
  let finish;
  sharing.shareAsync = () => new Promise(resolve => { finish = resolve; });
  const first = shareRecipeFile('{"first":true}');
  await Promise.resolve();
  assert.equal((await shareRecipeFile('{"second":true}')).status, 'failed');
  assert.equal(state.files.length, 1); assert.equal(state.files[0].content, '{"first":true}');
  finish(); assert.equal((await first).status, 'closed');
});
