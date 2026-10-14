import assert from 'node:assert/strict';
import test from 'node:test';
import { createKitchenBackup, decodeKitchenBackup, MAX_BACKUP_BYTES } from './backup.ts';
import { initialKitchen } from './state.ts';

const catalog = { dataset_version: 'test-2', ingredients: [{ ingredient_id: 'egg', selectable: true }], recipes: [{ recipe_id: 'egg-soup' }] };
const timestamp = '2026-10-14T10:00:00.000Z';
const kitchen = { ...initialKitchen(catalog), currentIds: ['egg'], mealRecipeIds: ['egg-soup'], defaultPeople: 3, sharedIngredientIds: ['egg'] };
const backup = () => createKitchenBackup(kitchen, catalog, timestamp).data;

test('backup round trip preserves all kitchen and meal settings without sharing mutable arrays', () => {
  const result = decodeKitchenBackup(JSON.stringify(backup()), catalog);
  assert.equal(result.error, null);
  assert.deepEqual(result.data.kitchen, kitchen);
  assert.notEqual(result.data.kitchen.currentIds, kitchen.currentIds);
  assert.equal(result.data.exportedAt, timestamp);
  assert.equal(result.data.datasetVersion, 'test-2');
});

test('known ids from older data remain restorable while preserving the source version in preview', () => {
  const older = { ...backup(), datasetVersion: 'test-1', kitchen: { ...kitchen, datasetVersion: 'test-1' } };
  const result = decodeKitchenBackup(JSON.stringify(older), catalog);
  assert.equal(result.error, null);
  assert.equal(result.data.datasetVersion, 'test-1');
  assert.equal(result.data.kitchen.datasetVersion, 'test-2');
});

for (const [name, value] of [
  ['unknown format', { ...backup(), format: 'other-app' }],
  ['unknown version', { ...backup(), version: 3 }],
  ['extra top level field', { ...backup(), token: 'must-not-import' }],
  ['missing field', { ...backup(), kitchen: undefined }],
  ['invalid timestamp', { ...backup(), exportedAt: '2026-02-30T10:00:00.000Z' }],
  ['null timestamp', { ...backup(), exportedAt: null }],
  ['version mismatch', { ...backup(), datasetVersion: 'test-1' }],
  ['unknown ingredient', { ...backup(), kitchen: { ...kitchen, currentIds: ['missing'] } }],
  ['unknown recipe', { ...backup(), kitchen: { ...kitchen, mealRecipeIds: ['missing'] } }],
  ['future kitchen schema', { ...backup(), kitchen: { ...kitchen, schemaVersion: 99 } }],
  ['secret extra field', { ...backup(), kitchen: { ...kitchen, apiKey: 'must-not-import' } }],
]) {
  test(`rejects ${name} without returning a partial kitchen`, () => {
    const result = decodeKitchenBackup(JSON.stringify(value), catalog);
    assert.equal(result.data, null);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.error.includes('重置'), false);
  });
}

test('rejects malformed and oversized files before parsing them', () => {
  for (const raw of ['{', 'null', '[]', ' '.repeat(MAX_BACKUP_BYTES + 1), '中'.repeat(MAX_BACKUP_BYTES / 2)]) {
    assert.notEqual(decodeKitchenBackup(raw, catalog).error, null);
  }
});

test('invalid state or export time cannot produce a backup', () => {
  assert.notEqual(createKitchenBackup({ ...kitchen, defaultPeople: 0 }, catalog, timestamp).error, null);
  assert.notEqual(createKitchenBackup(kitchen, catalog, 'invalid').error, null);
});
