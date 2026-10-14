import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeKitchen, initialKitchen, validateKitchen } from './state.ts';
import { createKitchenSession } from './session.ts';
import { addIngredient } from '../model/inventory-actions.ts';
import { MAX_STORAGE_BYTES } from './types.ts';

const catalog = {
  dataset_version: 'test-2',
  ingredients: [
    { ingredient_id: 'tomato', selectable: true },
    { ingredient_id: 'egg', selectable: true },
    { ingredient_id: 'meat', selectable: false },
  ],
  recipes: [{ recipe_id: 'tomato-egg', dish_id: 'tomato-egg' }, { recipe_id: 'tomato-egg-variant', dish_id: 'tomato-egg' }],
};
const timestamp = '2026-10-14T10:00:00.000Z';
const valid = () => ({ ...initialKitchen(catalog), updatedAt: timestamp });
const ok = (data) => ({ data, error: null });
const fail = (error) => ({ data: null, error });

function memoryStorage(raw = null) {
  let stored = raw;
  const writes = [];
  return {
    writes,
    read: async () => ok(stored),
    write: async (value) => { writes.push(value); stored = value; return ok(undefined); },
    reset: async (value) => { writes.push(value); stored = value; return ok(undefined); },
  };
}

test('new kitchens require explicit pantry and equipment setup', () => {
  const result = decodeKitchen(null, catalog);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, initialKitchen(catalog));
  assert.equal(result.data.equipmentConfigured, false);
  assert.equal(result.data.pantryConfigured, false);
});

test('restores known ingredient selections and updates catalog marker without mutating source', () => {
  const source = { ...valid(), datasetVersion: 'test-1', currentIds: ['tomato'], pantryIds: ['egg'] };
  const result = validateKitchen(source, catalog);
  assert.equal(result.error, null);
  assert.equal(result.data.datasetVersion, 'test-2');
  assert.deepEqual(result.data.currentIds, ['tomato']);
  assert.equal(source.datasetVersion, 'test-1');
  assert.notEqual(result.data.currentIds, source.currentIds);
});

for (const [name, source] of [
  ['malformed JSON', '{'],
  ['oversized JSON', ' '.repeat(MAX_STORAGE_BYTES + 1)],
  ['oversized UTF-8 JSON', '中'.repeat(Math.ceil(MAX_STORAGE_BYTES / 3))],
  ['null record', 'null'],
  ['unsupported version', JSON.stringify({ ...valid(), schemaVersion: 5 })],
  ['missing field', JSON.stringify({ ...valid(), updatedAt: undefined })],
  ['unexpected field', JSON.stringify({ ...valid(), apiKey: 'not-stored' })],
  ['unknown ingredient', JSON.stringify({ ...valid(), currentIds: ['unknown'] })],
  ['unselectable ingredient', JSON.stringify({ ...valid(), currentIds: ['meat'] })],
  ['duplicate ingredient', JSON.stringify({ ...valid(), currentIds: ['egg', 'egg'] })],
  ['ingredient duplicated across current and pantry', JSON.stringify({ ...valid(), currentIds: ['egg'], pantryIds: ['egg'] })],
  ['unknown equipment', JSON.stringify({ ...valid(), equipment: ['unknown'], equipmentConfigured: true })],
  ['duplicate equipment', JSON.stringify({ ...valid(), equipment: ['wok', 'wok'], equipmentConfigured: true })],
  ['unconfirmed equipment with selections', JSON.stringify({ ...valid(), equipment: ['wok'] })],
  ['conflicting absence', JSON.stringify({ ...valid(), currentIds: ['egg'], unavailableIds: ['egg'] })],
  ['invalid boolean', JSON.stringify({ ...valid(), pantryConfigured: 1 })],
  ['invalid timestamp', JSON.stringify({ ...valid(), updatedAt: '2026-02-30T10:00:00.000Z' })],
  ['zero people', JSON.stringify({ ...valid(), defaultPeople: 0 })],
  ['too many people', JSON.stringify({ ...valid(), mealPeople: 13 })],
  ['fractional burner count', JSON.stringify({ ...valid(), burnerCount: 1.5 })],
  ['unknown recipe', JSON.stringify({ ...valid(), mealRecipeIds: ['unknown'] })],
  ['duplicate recipe', JSON.stringify({ ...valid(), mealRecipeIds: ['tomato-egg', 'tomato-egg'] })],
  ['duplicate dish variants', JSON.stringify({ ...valid(), mealRecipeIds: ['tomato-egg', 'tomato-egg-variant'] })],
  ['unknown shared ingredient', JSON.stringify({ ...valid(), sharedIngredientIds: ['unknown'] })],
  ['sharing with an empty basket', JSON.stringify({ ...valid(), sharedIngredientIds: ['egg'] })],
]) {
  test(`rejects ${name} without returning default inventory`, () => {
    const result = decodeKitchen(source, catalog);
    assert.equal(result.data, null);
    assert.equal(typeof result.error, 'string');
  });
}

test('selecting a pantry ingredient for today moves its ownership to today', () => {
  const source = { ...valid(), currentIds: ['tomato'], pantryIds: ['egg'] };
  const moved = addIngredient(source, catalog, 'egg', 'current');
  assert.deepEqual(moved.currentIds, ['tomato', 'egg']);
  assert.deepEqual(moved.pantryIds, []);
  assert.deepEqual(source.currentIds, ['tomato']);
  assert.deepEqual(source.pantryIds, ['egg']);
  assert.equal(validateKitchen(moved, catalog).error, null);
});

test('adding a current ingredient to the pantry moves it and retains other current ingredients', () => {
  const source = { ...valid(), currentIds: ['tomato', 'egg'], pantryIds: [] };
  const moved = addIngredient(source, catalog, 'egg', 'pantry');
  assert.deepEqual(moved.currentIds, ['tomato']);
  assert.deepEqual(moved.pantryIds, ['egg']);
  assert.equal(validateKitchen(moved, catalog).error, null);
});

test('repeating an add keeps one ownership entry and clears the explicit absence', () => {
  const source = { ...valid(), unavailableIds: ['egg'] };
  const added = addIngredient(source, catalog, 'egg', 'pantry');
  const repeated = addIngredient(added, catalog, 'egg', 'pantry');
  assert.deepEqual(repeated.pantryIds, ['egg']);
  assert.deepEqual(repeated.currentIds, []);
  assert.deepEqual(repeated.unavailableIds, []);
  assert.deepEqual(source.unavailableIds, ['egg']);
});

test('stored cross-location duplicates are reported without silently rewriting ownership', async () => {
  const storage = memoryStorage(JSON.stringify({ ...valid(), currentIds: ['egg'], pantryIds: ['egg'] }));
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  assert.equal(session.getSnapshot().state, null);
  assert.match(session.getSnapshot().error, /同时放入/);
  assert.equal(storage.writes.length, 0);
});

test('rapid moves persist only the final selected location after reopening', async () => {
  const storage = memoryStorage(JSON.stringify({ ...valid(), pantryIds: ['egg'] }));
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update(state => addIngredient(state, catalog, 'egg', 'current'));
  session.update(state => addIngredient(state, catalog, 'egg', 'pantry'));
  await session.settled();
  const reopened = createKitchenSession(catalog, storage);
  reopened.load();
  await reopened.settled();
  assert.deepEqual(reopened.getSnapshot().state.currentIds, []);
  assert.deepEqual(reopened.getSnapshot().state.pantryIds, ['egg']);
  for (const raw of storage.writes) assert.equal(validateKitchen(JSON.parse(raw), catalog).error, null);
});

test('opening a new kitchen does not write or apply the pantry template', async () => {
  const storage = memoryStorage();
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(session.getSnapshot().state.pantryIds, []);
});

test('rapid functional updates save in order and restore the latest snapshot', async () => {
  const storage = memoryStorage();
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update((state) => ({ ...state, currentIds: [...state.currentIds, 'tomato'] }));
  session.update((state) => ({ ...state, currentIds: [...state.currentIds, 'egg'] }));
  assert.deepEqual(session.getSnapshot().state.currentIds, ['tomato', 'egg']);
  assert.equal(session.getSnapshot().saving, true);
  await session.settled();
  assert.deepEqual(storage.writes.map((raw) => JSON.parse(raw).currentIds), [['tomato'], ['tomato', 'egg']]);
  assert.equal(session.getSnapshot().saving, false);
  const reopened = createKitchenSession(catalog, storage);
  reopened.load();
  await reopened.settled();
  assert.deepEqual(reopened.getSnapshot().state.currentIds, ['tomato', 'egg']);
  assert.equal(reopened.getSnapshot().state.updatedAt, timestamp);
});

test('the second write waits for the first while both selections appear immediately', async () => {
  const storage = memoryStorage();
  const pending = [];
  storage.write = (value) => new Promise((resolve) => { pending.push({ value, resolve }); });
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update((state) => ({ ...state, currentIds: ['tomato'] }));
  session.update((state) => ({ ...state, currentIds: ['tomato', 'egg'] }));
  await Promise.resolve();
  assert.equal(pending.length, 1);
  assert.deepEqual(session.getSnapshot().state.currentIds, ['tomato', 'egg']);
  pending[0].resolve(ok(undefined));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  assert.equal(session.getSnapshot().saving, true);
  pending[1].resolve(fail('最新修改未保存'));
  await session.settled();
  assert.equal(session.getSnapshot().error, '最新修改未保存');
  assert.equal(session.getSnapshot().saving, false);
});

test('a save failure preserves the visible selection and retry saves that snapshot', async () => {
  const storage = memoryStorage();
  let attempts = 0;
  const originalWrite = storage.write;
  storage.write = async (value) => ++attempts === 1 ? fail('记录未保存') : originalWrite(value);
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update((state) => ({ ...state, currentIds: ['egg'] }));
  await session.settled();
  assert.equal(session.getSnapshot().error, '记录未保存');
  assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
  session.retry();
  await session.settled();
  assert.equal(session.getSnapshot().error, null);
  assert.deepEqual(JSON.parse(storage.writes[0]).currentIds, ['egg']);
});

test('an older successful save cannot clear a newer validation error', async () => {
  const storage = memoryStorage();
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update((state) => ({ ...state, currentIds: ['egg'] }));
  session.update((state) => ({ ...state, currentIds: ['unknown'] }));
  const error = session.getSnapshot().error;
  await session.settled();
  assert.notEqual(error, null);
  assert.equal(session.getSnapshot().error, error);
  assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
});

test('an older save result cannot replace the latest save failure', async () => {
  const storage = memoryStorage();
  let attempts = 0;
  storage.write = async () => ++attempts === 1 ? ok(undefined) : fail('最新记录未保存');
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update((state) => ({ ...state, currentIds: ['tomato'] }));
  session.update((state) => ({ ...state, currentIds: ['egg'] }));
  await session.settled();
  assert.equal(session.getSnapshot().error, '最新记录未保存');
  assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
});

test('corrupt stored state remains untouched until explicit reset', async () => {
  const storage = memoryStorage('bad json');
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  assert.equal(session.getSnapshot().state, null);
  assert.notEqual(session.getSnapshot().error, null);
  assert.equal(storage.writes.length, 0);
  session.reset();
  await session.settled();
  assert.equal(session.getSnapshot().error, null);
  assert.deepEqual(session.getSnapshot().state.currentIds, []);
  assert.equal(storage.writes.length, 1);
});

test('retry repeats a failed explicit reset instead of performing an ordinary write', async () => {
  const storage = memoryStorage('bad json');
  let resets = 0;
  storage.reset = async () => ++resets === 1 ? fail('重置失败') : ok(undefined);
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.reset();
  await session.settled();
  assert.equal(session.getSnapshot().error, '重置失败');
  session.retry();
  await session.settled();
  assert.equal(resets, 2);
  assert.equal(session.getSnapshot().error, null);
  assert.equal(storage.writes.length, 0);
});

test('an in-flight read cannot replace a user-confirmed reset', async () => {
  const storage = memoryStorage(JSON.stringify({ ...valid(), currentIds: ['egg'] }));
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  session.reset();
  await session.settled();
  assert.deepEqual(session.getSnapshot().state.currentIds, []);
});

test('subscribers receive updates and unsubscribe stops notifications', async () => {
  const storage = memoryStorage();
  const session = createKitchenSession(catalog, storage, () => timestamp);
  let notifications = 0;
  const unsubscribe = session.subscribe(() => { notifications += 1; });
  session.load();
  await session.settled();
  assert.equal(notifications, 2);
  unsubscribe();
  session.update((state) => ({ ...state, currentIds: ['egg'] }));
  await session.settled();
  assert.equal(notifications, 2);
});

test('migrates version one records while preserving all confirmed kitchen selections', () => {
  const { defaultPeople, burnerCount, mealRecipeIds, mealPeople, sharedIngredientIds, privateRecipes, recipeMedia, ...original } = valid();
  const legacy = { ...original, schemaVersion: 1, currentIds: ['tomato'], pantryIds: ['egg'], equipment: ['wok'], equipmentConfigured: true, pantryConfigured: true };
  const result = decodeKitchen(JSON.stringify(legacy), catalog);
  assert.equal(result.error, null);
  assert.equal(result.data.schemaVersion, 4);
  assert.deepEqual(result.data.currentIds, legacy.currentIds);
  assert.deepEqual(result.data.pantryIds, legacy.pantryIds);
  assert.deepEqual(result.data.equipment, legacy.equipment);
  assert.equal(result.data.pantryConfigured, true);
  assert.equal(result.data.equipmentConfigured, true);
  assert.equal(result.data.defaultPeople, 2);
  assert.equal(result.data.mealPeople, 2);
  assert.equal(result.data.burnerCount, 2);
  assert.deepEqual(result.data.mealRecipeIds, []);
  assert.deepEqual(result.data.sharedIngredientIds, []);
  assert.deepEqual(result.data.privateRecipes, []);
});

test('migrates version two records while preserving the meal basket and all kitchen settings', () => {
  const { privateRecipes, recipeMedia, ...original } = valid();
  const legacy = { ...original, schemaVersion: 2, currentIds: ['tomato'], pantryIds: ['egg'], mealRecipeIds: ['tomato-egg'], defaultPeople: 4, mealPeople: 3, burnerCount: 1, sharedIngredientIds: ['egg'] };
  const result = decodeKitchen(JSON.stringify(legacy), catalog);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { ...legacy, schemaVersion: 4, privateRecipes: [], recipeMedia: {} });
});

test('restores a kitchen only after its write succeeds and persists it across reopening', async () => {
  const storage = memoryStorage(JSON.stringify({ ...valid(), currentIds: ['egg'] }));
  const originalWrite = storage.write;
  let finish;
  storage.write = value => new Promise(resolve => { finish = async () => resolve(await originalWrite(value)); });
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  const restoring = session.restore({ ...valid(), currentIds: ['tomato'], mealRecipeIds: ['tomato-egg'], defaultPeople: 4 });
  await Promise.resolve();
  assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
  assert.equal(session.getSnapshot().saving, true);
  await finish();
  assert.equal((await restoring).error, null);
  assert.deepEqual(session.getSnapshot().state.currentIds, ['tomato']);
  const reopened = createKitchenSession(catalog, storage);
  reopened.load();
  await reopened.settled();
  assert.equal(reopened.getSnapshot().state.defaultPeople, 4);
  assert.deepEqual(reopened.getSnapshot().state.mealRecipeIds, ['tomato-egg']);
});

test('failed restore keeps old inventory on screen and disk and can retry the same backup', async () => {
  const storage = memoryStorage(JSON.stringify({ ...valid(), currentIds: ['egg'] }));
  const originalWrite = storage.write;
  let attempts = 0;
  storage.write = value => ++attempts === 1 ? Promise.resolve(fail('存储已满')) : originalWrite(value);
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  const backup = { ...valid(), currentIds: ['tomato'] };
  assert.equal((await session.restore(backup)).error, '存储已满');
  assert.equal(session.getSnapshot().error, '存储已满');
  assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
  assert.deepEqual(JSON.parse((await storage.read()).data).currentIds, ['egg']);
  assert.equal((await session.restore(backup)).error, null);
  assert.deepEqual(session.getSnapshot().state.currentIds, ['tomato']);
});

test('restore rejects invalid backups before writing or changing the visible state', async () => {
  const storage = memoryStorage();
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  const previous = session.getSnapshot().state;
  assert.notEqual((await session.restore({ ...valid(), currentIds: ['unknown'] })).error, null);
  assert.equal(session.getSnapshot().state, previous);
  assert.deepEqual(storage.writes, []);
});

test('edits queued during a restore apply to the restored kitchen and persist afterward', async () => {
  const storage = memoryStorage();
  const originalWrite = storage.write;
  let finish;
  let attempts = 0;
  storage.write = value => ++attempts === 1 ? new Promise(resolve => { finish = async () => resolve(await originalWrite(value)); }) : originalWrite(value);
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  const restoring = session.restore({ ...valid(), currentIds: ['tomato'] });
  session.update(state => ({ ...state, currentIds: [...state.currentIds, 'egg'] }));
  assert.deepEqual(session.getSnapshot().state.currentIds, []);
  assert.notEqual((await session.restore(valid())).error, null);
  await Promise.resolve();
  await finish();
  await restoring;
  await session.settled();
  assert.deepEqual(session.getSnapshot().state.currentIds, ['tomato', 'egg']);
  assert.deepEqual(storage.writes.map(raw => JSON.parse(raw).currentIds), [['tomato'], ['tomato', 'egg']]);
});

test('restore waits for previous saves and older completions cannot replace its state', async () => {
  const storage = memoryStorage();
  const originalWrite = storage.write;
  const pending = [];
  storage.write = value => new Promise(resolve => pending.push(async () => resolve(await originalWrite(value))));
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update(state => ({ ...state, currentIds: ['egg'] }));
  const restoring = session.restore({ ...valid(), currentIds: ['tomato'] });
  await Promise.resolve();
  assert.equal(pending.length, 1);
  await pending[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
  assert.equal(session.getSnapshot().saving, true);
  await pending[1]();
  await restoring;
  assert.deepEqual(session.getSnapshot().state.currentIds, ['tomato']);
});
