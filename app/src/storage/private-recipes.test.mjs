import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createKitchenBackup, decodeKitchenBackup } from './backup.ts';
import { createKitchenSession } from './session.ts';
import { decodeKitchen, initialKitchen, validateKitchen } from './state.ts';
import { MAX_PRIVATE_RECIPES } from '../model/private-recipes.ts';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const timestamp = '2026-10-14T10:00:00.000Z';
const recipe = {
  id: 'local_test_egg', name: '蒸蛋', course: 'meat', cookingMethod: 'steam', timeMinutes: 12,
  servings: 2, spicyLevel: 0, equipment: ['steamer'],
  ingredients: [{ ingredientId: 'egg', quantity: { unit: 'piece', value: 2 }, importance: 'required', role: 'main', consumes: true }],
  steps: [{ id: 'step_steam', text: '鸡蛋打散后蒸至熟透。', ingredientIds: ['egg'] }],
};
const ok = data => ({ data, error: null });
const fail = error => ({ data: null, error });
const kitchen = () => ({ ...initialKitchen(catalog), currentIds: ['egg'], privateRecipes: [structuredClone(recipe)], mealRecipeIds: [recipe.id], sharedIngredientIds: ['egg'] });

function memoryStorage(state = initialKitchen(catalog)) {
  let stored = JSON.stringify(state);
  const writes = [];
  const write = async value => { stored = value; writes.push(value); return ok(undefined); };
  return { writes, read: async () => ok(stored), write, reset: write };
}

async function openSession(storage) {
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  assert.equal(session.getSnapshot().error, null);
  return session;
}

test('private recipes and their meal selections survive storage and backup round trips', () => {
  const original = kitchen();
  const restored = decodeKitchen(JSON.stringify(original), catalog);
  assert.equal(restored.error, null);
  assert.deepEqual(restored.data, original);
  const backup = createKitchenBackup(original, catalog, timestamp);
  assert.equal(backup.error, null);
  assert.equal(backup.data.version, 2);
  const imported = decodeKitchenBackup(JSON.stringify(backup.data), catalog);
  assert.equal(imported.error, null);
  assert.deepEqual(imported.data.kitchen, original);
  assert.notEqual(imported.data.kitchen.privateRecipes, original.privateRecipes);
});

for (const [name, privateRecipes] of [
  ['non-array records', {}],
  ['malformed recipes', [{ ...recipe, ingredients: [] }]],
  ['unknown ingredients', [{ ...recipe, ingredients: [{ ...recipe.ingredients[0], ingredientId: 'unknown' }] }]],
  ['duplicate ids', [recipe, recipe]],
  ['too many recipes', Array.from({ length: MAX_PRIVATE_RECIPES + 1 }, (_, index) => ({ ...recipe, id: `local_overflow_${index}` }))],
]) {
  test(`invalid private ${name} cannot enter storage or a backup`, () => {
    const state = { ...kitchen(), privateRecipes };
    assert.notEqual(validateKitchen(state, catalog).error, null);
    assert.notEqual(createKitchenBackup(state, catalog, timestamp).error, null);
    const backup = { format: 'fastcook-kitchen', version: 1, exportedAt: timestamp, datasetVersion: catalog.dataset_version, kitchen: state };
    assert.notEqual(decodeKitchenBackup(JSON.stringify(backup), catalog).error, null);
  });
}

for (const version of [1, 2]) {
  test(`version ${version} backups migrate without losing old selections`, () => {
    const { privateRecipes, recipeMedia, ...state } = initialKitchen(catalog);
    const legacy = { ...state, schemaVersion: version, currentIds: ['egg'], pantryConfigured: true, equipment: ['steamer'], equipmentConfigured: true };
    if (version === 1) for (const field of ['defaultPeople', 'burnerCount', 'mealRecipeIds', 'mealPeople', 'sharedIngredientIds']) delete legacy[field];
    if (version === 2) legacy.mealRecipeIds = [catalog.recipes[0].recipe_id];
    const backup = { format: 'fastcook-kitchen', version: 1, exportedAt: timestamp, datasetVersion: catalog.dataset_version, kitchen: legacy };
    const imported = decodeKitchenBackup(JSON.stringify(backup), catalog);
    assert.equal(imported.error, null);
    assert.equal(imported.data.kitchen.schemaVersion, 4);
    assert.deepEqual(imported.data.kitchen.currentIds, ['egg']);
    assert.equal(imported.data.kitchen.pantryConfigured, true);
    assert.deepEqual(imported.data.kitchen.equipment, ['steamer']);
    assert.deepEqual(imported.data.kitchen.privateRecipes, []);
    assert.deepEqual(imported.data.kitchen.mealRecipeIds, version === 1 ? [] : legacy.mealRecipeIds);
  });
}

test('committing a private recipe publishes only after durable storage succeeds', async () => {
  const storage = memoryStorage();
  const session = await openSession(storage);
  const originalWrite = storage.write;
  let finish;
  storage.write = value => new Promise(resolve => { finish = async () => resolve(await originalWrite(value)); });
  const saving = session.commit(state => ok({ ...state, privateRecipes: [recipe] }));
  assert.deepEqual(session.getSnapshot().state.privateRecipes, []);
  assert.equal(session.getSnapshot().saving, true);
  await Promise.resolve();
  await finish();
  assert.equal((await saving).error, null);
  assert.deepEqual(session.getSnapshot().state.privateRecipes, [recipe]);
  const reopened = await openSession(storage);
  assert.deepEqual(reopened.getSnapshot().state.privateRecipes, [recipe]);
});

test('failed private recipe deletion retains the recipe and its basket entry on screen and disk', async () => {
  const storage = memoryStorage(kitchen());
  const session = await openSession(storage);
  storage.write = async () => fail('厨房存储已满，请检查空间后重试。');
  const deleting = state => ok({ ...state, privateRecipes: [], mealRecipeIds: [], sharedIngredientIds: [] });
  const result = await session.commit(deleting);
  assert.match(result.error, /存储已满/);
  assert.equal(session.getSnapshot().error, null);
  assert.deepEqual(session.getSnapshot().state.privateRecipes, [recipe]);
  assert.deepEqual(session.getSnapshot().state.mealRecipeIds, [recipe.id]);
  assert.deepEqual(session.getSnapshot().state.sharedIngredientIds, ['egg']);
  assert.deepEqual(JSON.parse((await storage.read()).data), kitchen());
});

test('private recipe deletion and basket cleanup persist together while inventory remains', async () => {
  const storage = memoryStorage(kitchen());
  const session = await openSession(storage);
  assert.equal((await session.commit(state => ok({ ...state, privateRecipes: [], mealRecipeIds: [], sharedIngredientIds: [] }))).error, null);
  assert.equal(storage.writes.length, 1);
  const reopened = await openSession(storage);
  assert.deepEqual(reopened.getSnapshot().state.privateRecipes, []);
  assert.deepEqual(reopened.getSnapshot().state.mealRecipeIds, []);
  assert.deepEqual(reopened.getSnapshot().state.sharedIngredientIds, []);
  assert.deepEqual(reopened.getSnapshot().state.currentIds, ['egg']);
});

test('a private recipe cannot be deleted while its basket reference remains', async () => {
  const storage = memoryStorage(kitchen());
  const session = await openSession(storage);
  assert.notEqual((await session.commit(state => ok({ ...state, privateRecipes: [] }))).error, null);
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(session.getSnapshot().state.mealRecipeIds, [recipe.id]);
});

test('commits preserve queued inventory changes and reject simultaneous confirmed operations', async () => {
  const storage = memoryStorage();
  const session = await openSession(storage);
  const originalWrite = storage.write;
  const pending = [];
  storage.write = value => new Promise(resolve => pending.push(async () => resolve(await originalWrite(value))));
  session.update(state => ({ ...state, currentIds: ['egg'] }));
  const saving = session.commit(state => ok({ ...state, privateRecipes: [recipe] }));
  session.update(state => ({ ...state, pantryConfigured: true }));
  assert.notEqual((await session.commit(state => ok(state))).error, null);
  assert.notEqual((await session.restore(initialKitchen(catalog))).error, null);
  assert.equal(pending.length, 1);
  await pending[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  assert.deepEqual(session.getSnapshot().state.privateRecipes, []);
  await pending[1]();
  assert.equal((await saving).error, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 3);
  await pending[2]();
  await session.settled();
  const reopened = await openSession(storage);
  assert.deepEqual(reopened.getSnapshot().state.currentIds, ['egg']);
  assert.deepEqual(reopened.getSnapshot().state.privateRecipes, [recipe]);
  assert.equal(reopened.getSnapshot().state.pantryConfigured, true);
});

test('inventory updates during a failed commit apply to the retained kitchen', async () => {
  const storage = memoryStorage();
  const session = await openSession(storage);
  const originalWrite = storage.write;
  let failWrite;
  let writes = 0;
  storage.write = value => ++writes === 1 ? new Promise(resolve => { failWrite = () => resolve(fail('菜谱未保存')); }) : originalWrite(value);
  const saving = session.commit(state => ok({ ...state, privateRecipes: [recipe] }));
  session.update(state => ({ ...state, currentIds: ['egg'] }));
  await Promise.resolve();
  failWrite();
  assert.equal((await saving).error, '菜谱未保存');
  await session.settled();
  const reopened = await openSession(storage);
  assert.deepEqual(reopened.getSnapshot().state.privateRecipes, []);
  assert.deepEqual(reopened.getSnapshot().state.currentIds, ['egg']);
});

test('failed recipe commit preserves an existing inventory save error for the global retry action', async () => {
  const storage = memoryStorage();
  const session = await openSession(storage);
  storage.write = async () => fail('食材记录未保存');
  session.update(state => ({ ...state, currentIds: ['egg'] }));
  await session.settled();
  storage.write = async () => fail('菜谱未保存');
  const result = await session.commit(state => ok({ ...state, privateRecipes: [recipe] }));
  assert.equal(result.error, '菜谱未保存');
  assert.equal(session.getSnapshot().error, '食材记录未保存');
  assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
  assert.deepEqual(session.getSnapshot().state.privateRecipes, []);
});

for (const [name, inventoryResults, commitResult, expectedError] of [
  ['pending inventory failure remains visible after commit failure', [fail('食材记录未保存')], fail('菜谱未保存'), '食材记录未保存'],
  ['a later inventory success clears an older failure before commit failure', [fail('旧食材未保存'), ok(undefined)], fail('菜谱未保存'), null],
  ['the latest pending inventory failure survives earlier success and commit failure', [ok(undefined), fail('最新食材未保存')], fail('菜谱未保存'), '最新食材未保存'],
  ['successful commit persists inventory after a pending inventory failure', [fail('食材记录未保存')], ok(undefined), null],
]) {
  test(name, async () => {
    const storage = memoryStorage();
    const session = await openSession(storage);
    const originalWrite = storage.write;
    const results = [...inventoryResults, commitResult];
    storage.write = async value => {
      const result = results.shift();
      return result.error === null ? originalWrite(value) : result;
    };
    for (const [index] of inventoryResults.entries()) session.update(state => ({ ...state, currentIds: ['egg'], defaultPeople: index + 2 }));
    const result = await session.commit(state => ok({ ...state, privateRecipes: [recipe] }));
    assert.equal(result.error, commitResult.error);
    assert.equal(session.getSnapshot().error, expectedError);
    assert.deepEqual(session.getSnapshot().state.currentIds, ['egg']);
    assert.deepEqual(session.getSnapshot().state.privateRecipes, commitResult.error === null ? [recipe] : []);
    if (commitResult.error === null) assert.deepEqual(JSON.parse((await storage.read()).data).privateRecipes, [recipe]);
  });
}

test('an obsolete pending inventory save cannot clear a newer validation error when commit fails', async () => {
  const storage = memoryStorage();
  const session = await openSession(storage);
  const originalWrite = storage.write;
  let writes = 0;
  storage.write = value => ++writes === 1 ? originalWrite(value) : Promise.resolve(fail('菜谱未保存'));
  session.update(state => ({ ...state, currentIds: ['egg'] }));
  session.update(state => ({ ...state, currentIds: ['unknown'] }));
  const validationError = session.getSnapshot().error;
  assert.notEqual(validationError, null);
  assert.equal((await session.commit(state => ok({ ...state, privateRecipes: [recipe] }))).error, '菜谱未保存');
  assert.equal(session.getSnapshot().error, validationError);
});

test('commit validation errors do not publish or write partial state', async () => {
  const storage = memoryStorage();
  const session = await openSession(storage);
  const previous = session.getSnapshot();
  assert.equal((await session.commit(() => fail('请选择原料。'))).error, '请选择原料。');
  assert.notEqual((await session.commit(state => ok({ ...state, privateRecipes: [{ ...recipe, name: '' }] }))).error, null);
  assert.equal(session.getSnapshot(), previous);
  assert.equal(storage.writes.length, 0);
});

test('inventory updates retain the validated private recipe array identity', async () => {
  const session = await openSession(memoryStorage(kitchen()));
  const recipes = session.getSnapshot().state.privateRecipes;
  session.update(state => ({ ...state, pantryConfigured: true }));
  await session.settled();
  assert.equal(session.getSnapshot().state.privateRecipes, recipes);
});

test('explicit kitchen reset clears private recipes and meal references together', async () => {
  const storage = memoryStorage(kitchen());
  const session = await openSession(storage);
  session.reset();
  await session.settled();
  assert.deepEqual(session.getSnapshot().state.privateRecipes, []);
  assert.deepEqual(session.getSnapshot().state.mealRecipeIds, []);
  assert.deepEqual(session.getSnapshot().state.sharedIngredientIds, []);
  const reopened = await openSession(storage);
  assert.deepEqual(reopened.getSnapshot().state.privateRecipes, []);
});
