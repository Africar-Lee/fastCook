import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const fileSystem = { Directory: { pickDirectoryAsync: async () => { throw new Error('Unexpected picker call'); } } };
const stubKey = Symbol.for('fastcook.test.reportFileSystem');
globalThis[stubKey] = fileSystem;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== 'expo-file-system') return nextResolve(specifier, context);
    return {
      url: `data:text/javascript,${encodeURIComponent("export const Directory = globalThis[Symbol.for('fastcook.test.reportFileSystem')].Directory;")}`,
      shortCircuit: true,
    };
  },
});
const { exportRecipeReport } = await import('./report-export.ts');
hooks.deregister();
delete globalThis[stubKey];

const report = {
  schema_version: 1, app_version: '0.1.0', dataset_version: 'test-1',
  recipe: { recipe_id: '../recipe', dish_id: 'dish', name: '番茄炒蛋', source_ids: ['source-1'] },
  issue: { category: 'ingredients', description: '食材用量有误。' },
};

test('native report export writes readable JSON to a user-selected directory with a safe filename', async () => {
  const created = [];
  const written = [];
  let selections = 0;
  fileSystem.Directory.pickDirectoryAsync = async () => {
    selections += 1;
    return { createFile: (name, mimeType) => { created.push({ name, mimeType }); return { write: content => written.push(content) }; } };
  };
  assert.equal(selections, 0);
  assert.deepEqual(await exportRecipeReport(report), { status: 'saved', error: null });
  assert.equal(selections, 1);
  assert.equal(created.length, 1);
  assert.match(created[0].name, /^fastcook-report-\d+\.json$/);
  assert.equal(created[0].mimeType, 'application/json');
  assert.equal(written.length, 1);
  assert.deepEqual(JSON.parse(written[0]), report);
  assert.match(written[0], /\n  "schema_version"/);
});

for (const cancellation of [
  Object.assign(new Error('private picker details'), { code: 'ERR_PICKER_CANCELLED' }),
  { code: 'ERR_PICKER_CANCELLED' },
]) {
  test(`native ${cancellation instanceof Error ? 'Error' : 'object'} picker cancellation returns normally without saving`, async () => {
    fileSystem.Directory.pickDirectoryAsync = async () => { throw cancellation; };
    assert.deepEqual(await exportRecipeReport(report), { status: 'cancelled', error: null });
  });
}

test('native directory access failure suggests retrying without exposing platform details', async () => {
  fileSystem.Directory.pickDirectoryAsync = async () => { throw new Error('private content://account'); };
  const result = await exportRecipeReport(report);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /重新选择/);
  assert.equal(result.error.includes('private'), false);
});

test('native file creation failure does not report a saved file', async () => {
  fileSystem.Directory.pickDirectoryAsync = async () => ({
    createFile: () => { throw new Error('private content://account'); },
  });
  const result = await exportRecipeReport(report);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /可写入/);
  assert.equal(result.error.includes('private'), false);
});

test('native write failure reports incomplete saving without exposing platform details', async () => {
  fileSystem.Directory.pickDirectoryAsync = async () => ({
    createFile: () => ({ write: () => { throw new Error('private disk details'); } }),
  });
  const result = await exportRecipeReport(report);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /未能完整保存/);
  assert.equal(result.error.includes('private'), false);
});
