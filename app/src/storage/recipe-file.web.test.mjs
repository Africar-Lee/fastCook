import assert from 'node:assert/strict';
import test from 'node:test';
import { exportRecipeFile, importRecipeFile, shareRecipeFile } from './recipe-file.web.ts';
import { MAX_MEDIA_PACKAGE_BYTES } from '../model/recipe-media.ts';

function replaceGlobal(context, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  context.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
}

function browser(context, options = {}) {
  const events = new Map();
  const element = { style: {}, files: options.files ?? (options.file ? [options.file] : []), removed: false,
    addEventListener: (event, listener) => events.set(event, listener), remove: () => { element.removed = true; },
    click: () => { if (options.clickError) throw new Error('private browser error'); options.click?.(); },
  };
  let attached = false;
  replaceGlobal(context, 'document', { createElement: () => { if (options.createError) throw new Error('private DOM'); return element; },
    body: { appendChild: () => { attached = true; } } });
  return { element, events, isAttached: () => attached };
}

test('web recipe export preserves JSON and uses a safe filename while releasing download resources', async context => {
  const setup = browser(context);
  const content = '{"name":"../../私人菜谱"}';
  let blob; let cleanup; let released;
  context.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:recipes'; });
  context.mock.method(URL, 'revokeObjectURL', value => { released = value; });
  context.mock.method(globalThis, 'setTimeout', callback => { cleanup = callback; });
  assert.deepEqual(await exportRecipeFile(content), { status: 'download_started', error: null });
  assert.equal(await blob.text(), content); assert.equal(blob.type, 'application/json');
  assert.match(setup.element.download, /^fastcook-recipes-\d+\.json$/);
  assert.equal(setup.isAttached(), true); assert.equal(setup.element.removed, true);
  cleanup(); assert.equal(released, 'blob:recipes');
});

test('web recipe download failure releases the link and URL without leaking details', async context => {
  const setup = browser(context, { clickError: true });
  let cleanup; let released;
  context.mock.method(URL, 'createObjectURL', () => 'blob:recipes');
  context.mock.method(URL, 'revokeObjectURL', value => { released = value; });
  context.mock.method(globalThis, 'setTimeout', callback => { cleanup = callback; });
  const result = await exportRecipeFile('{}');
  assert.equal(result.status, 'failed'); assert.equal(result.error.includes('private'), false); assert.equal(setup.element.removed, true);
  cleanup(); assert.equal(released, 'blob:recipes');
});

test('web recipe blob failure does not start a download', async context => {
  const setup = browser(context);
  context.mock.method(URL, 'createObjectURL', () => { throw new Error('private browser error'); });
  const result = await exportRecipeFile('{}');
  assert.equal(result.status, 'failed'); assert.equal(result.error.includes('private'), false); assert.equal(setup.isAttached(), false);
});

test('web recipe import selects one JSON file and releases the picker', async context => {
  const content = '{"name":"蒸蛋"}';
  const setup = browser(context, { file: new Blob([content]) });
  const selecting = importRecipeFile();
  assert.equal(setup.isAttached(), true); assert.equal(setup.element.accept, '.json,application/json');
  setup.events.get('change')();
  assert.deepEqual(await selecting, { status: 'selected', content, error: null });
  assert.equal(setup.element.removed, true);
});

for (const event of ['cancel', 'change']) {
  test(`web recipe picker ${event} without a selected file returns cancellation`, async context => {
    const setup = browser(context);
    const selecting = importRecipeFile(); setup.events.get(event)();
    assert.deepEqual(await selecting, { status: 'cancelled', error: null }); assert.equal(setup.element.removed, true);
  });
}

test('web recipe picker rejects multiple files without reading their contents', async context => {
  const file = { text: () => { assert.fail('must not read'); } };
  const setup = browser(context, { files: [file, file] });
  const selecting = importRecipeFile(); setup.events.get('change')();
  assert.equal((await selecting).status, 'failed'); assert.equal(setup.element.removed, true);
});

test('web recipe import rejects files over the byte limit before reading', async context => {
  const setup = browser(context, { file: { size: MAX_MEDIA_PACKAGE_BYTES + 1, text: () => { assert.fail('must not read'); } } });
  const selecting = importRecipeFile(); setup.events.get('change')();
  const result = await selecting;
  assert.equal(result.status, 'failed'); assert.match(result.error, /48 MiB/);
});

test('web recipe import rechecks UTF-8 size after reading', async context => {
  const setup = browser(context, { file: { size: 1, text: async () => '中'.repeat(Math.floor(MAX_MEDIA_PACKAGE_BYTES / 3) + 1) } });
  const selecting = importRecipeFile(); setup.events.get('change')();
  const result = await selecting;
  assert.equal(result.status, 'failed'); assert.match(result.error, /48 MiB/);
});

test('web recipe read failures give retryable context without leaking filenames', async context => {
  const setup = browser(context, { file: { size: 1, text: async () => { throw new Error('private path'); } } });
  const selecting = importRecipeFile(); setup.events.get('change')();
  const result = await selecting;
  assert.equal(result.status, 'failed'); assert.match(result.error, /重试/); assert.equal(result.error.includes('private'), false);
});

for (const option of ['clickError', 'createError']) {
  test(`web recipe picker ${option} returns a safe failure`, async context => {
    const setup = browser(context, { [option]: true });
    const result = await importRecipeFile();
    assert.equal(result.status, 'failed'); assert.equal(result.error.includes('private'), false);
    if (option === 'clickError') assert.equal(setup.element.removed, true);
  });
}

test('web recipe picker cancellation cannot be replaced by a late file read', async context => {
  let finish;
  const setup = browser(context, { file: { size: 2, text: () => new Promise(resolve => { finish = resolve; }) } });
  const selecting = importRecipeFile(); setup.events.get('change')(); setup.events.get('cancel')();
  finish('{}'); assert.deepEqual(await selecting, { status: 'cancelled', error: null });
});

test('web recipe sharing uses files synchronously before yielding the user activation', async context => {
  const content = '{"name":"../蒸蛋"}';
  let shareCalled = false; let shared;
  replaceGlobal(context, 'navigator', {
    canShare: data => { assert.equal(data.files[0].type, 'application/json'); return true; },
    share: data => { shareCalled = true; shared = data; return Promise.resolve(); },
  });
  const result = shareRecipeFile(content);
  assert.equal(shareCalled, true);
  assert.equal(await shared.files[0].text(), content);
  assert.match(shared.files[0].name, /^fastcook-recipes-\d+\.json$/);
  assert.deepEqual(await result, { status: 'closed', error: null });
});

test('web unsupported file sharing does not call share or silently download', async context => {
  replaceGlobal(context, 'navigator', { canShare: () => false, share: () => { assert.fail('must not share'); } });
  assert.deepEqual(await shareRecipeFile('{}'), { status: 'unsupported', error: null });
});

test('web sharing feature detection supports browsers without Web Share', async context => {
  replaceGlobal(context, 'navigator', {});
  assert.deepEqual(await shareRecipeFile('{}'), { status: 'unsupported', error: null });
});

test('web file capability exceptions are treated as unsupported without exposing platform details', async context => {
  replaceGlobal(context, 'navigator', { canShare: () => { throw new Error('private capability'); }, share: () => { assert.fail('must not share'); } });
  assert.deepEqual(await shareRecipeFile('{}'), { status: 'unsupported', error: null });
});

test('web cancelled sharing returns no success or error notice', async context => {
  replaceGlobal(context, 'navigator', { canShare: () => true, share: async () => { throw new DOMException('private detail', 'AbortError'); } });
  assert.deepEqual(await shareRecipeFile('{}'), { status: 'cancelled', error: null });
});

test('web sharing failures have safe context and offer file export', async context => {
  replaceGlobal(context, 'navigator', { canShare: () => true, share: async () => { throw new DOMException('private detail', 'NotAllowedError'); } });
  const result = await shareRecipeFile('{}');
  assert.equal(result.status, 'failed'); assert.match(result.error, /导出文件/); assert.equal(result.error.includes('private'), false);
});

test('web export and share enforce the UTF-8 bound before any system action', async context => {
  const setup = browser(context);
  replaceGlobal(context, 'navigator', { canShare: () => { assert.fail('must not query sharing'); }, share() {} });
  context.mock.method(URL, 'createObjectURL', () => { assert.fail('must not create a download'); });
  for (const content of [null, ' '.repeat(MAX_MEDIA_PACKAGE_BYTES + 1), '中'.repeat(Math.floor(MAX_MEDIA_PACKAGE_BYTES / 3) + 1)]) {
    assert.equal((await exportRecipeFile(content)).status, 'failed'); assert.equal((await shareRecipeFile(content)).status, 'failed');
  }
  assert.equal(setup.isAttached(), false);
});

test('web sharing accepts content exactly at the UTF-8 byte limit', async context => {
  let file;
  replaceGlobal(context, 'navigator', { canShare: () => true, share: async data => { [file] = data.files; } });
  assert.equal((await shareRecipeFile('a'.repeat(MAX_MEDIA_PACKAGE_BYTES))).status, 'closed');
  assert.equal(file.size, MAX_MEDIA_PACKAGE_BYTES);
});
