import assert from 'node:assert/strict';
import test from 'node:test';
import { exportRecipeReport } from './report-export.web.ts';

const report = {
  schema_version: 1, app_version: '0.1.0', dataset_version: 'test-1',
  recipe: { recipe_id: '../recipe', dish_id: 'dish', name: '番茄炒蛋', source_ids: ['source-1'] },
  issue: { category: 'steps', description: '这一步缺少说明。' },
};

function setupBrowser(context, options = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const downloaded = [];
  const released = [];
  const deferred = [];
  const blobs = [];
  const link = { href: '', download: '', click: () => {
    if (options.clickError) throw options.clickError;
    downloaded.push({ href: link.href, name: link.download });
  } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => {
    assert.equal(tag, 'a');
    if (options.elementError) throw options.elementError;
    return link;
  } } });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  });
  context.mock.method(URL, 'createObjectURL', blob => {
    if (options.urlError) throw options.urlError;
    blobs.push(blob);
    return 'blob:report-test';
  });
  context.mock.method(URL, 'revokeObjectURL', url => released.push(url));
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => { deferred.push({ callback, delay }); return 1; });
  return { downloaded, released, deferred, blobs };
}

test('web report export starts a JSON download and releases its URL after the click', async context => {
  const browser = setupBrowser(context);
  const result = await exportRecipeReport(report);
  assert.deepEqual(result, { status: 'download_started', error: null });
  assert.equal(browser.downloaded.length, 1);
  assert.match(browser.downloaded[0].name, /^fastcook-report-\d+\.json$/);
  assert.equal(browser.downloaded[0].href, 'blob:report-test');
  assert.equal(browser.blobs[0].type, 'application/json');
  assert.deepEqual(JSON.parse(await browser.blobs[0].text()), report);
  assert.deepEqual(browser.released, []);
  assert.equal(browser.deferred.length, 1);
  assert.ok(browser.deferred[0].delay > 0);
  browser.deferred[0].callback();
  assert.deepEqual(browser.released, ['blob:report-test']);
});

test('web report export reports an unsupported browser before creating a download', async context => {
  const browser = setupBrowser(context);
  const descriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  Object.defineProperty(URL, 'createObjectURL', { ...descriptor, value: undefined });
  context.after(() => Object.defineProperty(URL, 'createObjectURL', descriptor));
  const result = await exportRecipeReport(report);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /不支持/);
  assert.deepEqual(browser.downloaded, []);
});

for (const [name, options, expected] of [
  ['link creation', { elementError: new DOMException('private browser details', 'SecurityError') }, /未能准备/],
  ['file URL creation', { urlError: new DOMException('private browser details', 'SecurityError') }, /未能生成/],
]) {
  test(`web ${name} failure returns an actionable error without exposing details`, async context => {
    const browser = setupBrowser(context, options);
    const result = await exportRecipeReport(report);
    assert.equal(result.status, 'failed');
    assert.match(result.error, expected);
    assert.equal(result.error.includes('private'), false);
    assert.deepEqual(browser.downloaded, []);
    assert.deepEqual(browser.released, []);
  });
}

test('web download failure releases its file URL and does not claim the report was saved', async context => {
  const browser = setupBrowser(context, { clickError: new DOMException('private browser details', 'SecurityError') });
  const result = await exportRecipeReport(report);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /允许本站下载/);
  assert.equal(result.error.includes('private'), false);
  assert.deepEqual(browser.downloaded, []);
  browser.deferred[0].callback();
  assert.deepEqual(browser.released, ['blob:report-test']);
});
