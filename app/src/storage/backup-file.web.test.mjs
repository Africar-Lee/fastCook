import assert from 'node:assert/strict';
import test from 'node:test';
import { exportKitchenBackup, importKitchenBackup } from './backup-file.web.ts';
import { MAX_BACKUP_BYTES } from './backup.ts';

function browser(context, options = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const events = new Map();
  const element = { style: {}, files: options.file ? [options.file] : [], removed: false,
    addEventListener: (name, callback) => events.set(name, callback),
    remove: () => { element.removed = true; },
    click: () => { if (options.clickError) throw new Error('private browser error'); options.click?.(); },
  };
  let attached = false;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => element,
    body: { appendChild: () => { attached = true; } },
  } });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });
  return { element, events, isAttached: () => attached };
}

test('web backup selection reads one file and removes the picker', async context => {
  const content = '{"中文":"备份"}';
  const setup = browser(context, { file: new Blob([content]) });
  const selecting = importKitchenBackup();
  assert.equal(setup.isAttached(), true);
  assert.equal(setup.element.accept, '.json,application/json');
  setup.events.get('change')();
  assert.deepEqual(await selecting, { status: 'selected', content, error: null });
  assert.equal(setup.element.removed, true);
});

test('web backup cancellation releases its file input', async context => {
  const setup = browser(context);
  const selecting = importKitchenBackup();
  setup.events.get('cancel')();
  assert.deepEqual(await selecting, { status: 'cancelled', error: null });
  assert.equal(setup.element.removed, true);
});

test('web backup oversized input is rejected before file reading', async context => {
  let read = false;
  const setup = browser(context, { file: { size: MAX_BACKUP_BYTES + 1, text: async () => { read = true; } } });
  const selecting = importKitchenBackup();
  setup.events.get('change')();
  assert.equal((await selecting).status, 'failed');
  assert.equal(read, false);
});

test('web backup content remains byte bounded when file metadata understates its size', async context => {
  const setup = browser(context, { file: { size: 1, text: async () => '中'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1) } });
  const selecting = importKitchenBackup();
  setup.events.get('change')();
  const result = await selecting;
  assert.equal(result.status, 'failed');
  assert.match(result.error, /48 MiB/);
});

test('web backup read failures are retryable and do not expose private details', async context => {
  const setup = browser(context, { file: { size: 1, text: async () => { throw new Error('private browser error'); } } });
  const selecting = importKitchenBackup();
  setup.events.get('change')();
  const result = await selecting;
  assert.equal(result.status, 'failed');
  assert.equal(result.error.includes('private'), false);
  assert.equal(setup.element.removed, true);
});

test('web backup file picker failure removes its input and returns an error', async context => {
  const setup = browser(context, { clickError: true });
  assert.equal((await importKitchenBackup()).status, 'failed');
  assert.equal(setup.element.removed, true);
});

test('web backup download attaches a link, preserves JSON and releases resources', async context => {
  const setup = browser(context);
  const backup = { format: 'fastcook-kitchen', version: 1, kitchen: { currentIds: ['egg'] } };
  let blob;
  let released;
  let cleanup;
  context.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:backup'; });
  context.mock.method(URL, 'revokeObjectURL', value => { released = value; });
  context.mock.method(globalThis, 'setTimeout', callback => { cleanup = callback; });
  assert.equal((await exportKitchenBackup(backup)).status, 'download_started');
  assert.deepEqual(JSON.parse(await blob.text()), backup);
  assert.match(setup.element.download, /^fastcook-backup-\d+\.json$/);
  assert.equal(setup.isAttached(), true);
  assert.equal(setup.element.removed, true);
  cleanup();
  assert.equal(released, 'blob:backup');
});

test('web backup export rejects oversized UTF-8 content before creating a download', async context => {
  const setup = browser(context);
  let created = false;
  context.mock.method(URL, 'createObjectURL', () => { created = true; return 'blob:backup'; });
  const result = await exportKitchenBackup({ content: '中'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1) });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /48 MiB/);
  assert.equal(created, false);
  assert.equal(setup.isAttached(), false);
});
