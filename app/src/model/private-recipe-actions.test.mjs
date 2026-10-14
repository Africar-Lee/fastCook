import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createEngine } from '../../../packages/engine/src/index.ts';
import { deletePrivateRecipe, savePrivateRecipe } from './private-recipe-actions.ts';
import { mergePrivateRecipes } from './private-recipes.ts';
import { initialKitchen, decodeKitchen } from '../storage/state.ts';
import { createKitchenSession } from '../storage/session.ts';
import { success, failure } from '../storage/types.ts';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const egg = catalog.ingredients.find(item => item.names['zh-CN'] === '鸡蛋').ingredient_id;
const recipe = {
  id: 'local_action_test', name: '我的煮蛋', course: 'meat', cookingMethod: 'boil', timeMinutes: 10,
  servings: 2, spicyLevel: 0, equipment: ['pot'],
  ingredients: [{ ingredientId: egg, quantity: { unit: 'piece', value: 2 }, importance: 'required', role: 'main', consumes: true }],
  steps: [{ id: 'step_boil', text: '将鸡蛋煮熟。', ingredientIds: [egg] }],
};

test('creating a private recipe preserves the kitchen and includes it in deterministic recommendations', () => {
  const initial = { ...initialKitchen(catalog), currentIds: [egg], pantryConfigured: true, equipmentConfigured: true, equipment: ['pot'] };
  const saved = savePrivateRecipe(initial, catalog, recipe);
  assert.equal(saved.error, null);
  assert.deepEqual(saved.data.currentIds, [egg]);
  assert.deepEqual(initial.privateRecipes, []);
  const built = createEngine(mergePrivateRecipes(catalog, saved.data.privateRecipes), { allowDraft: true });
  assert.equal(built.error, null);
  const result = built.data.recommend({ inventory: { items: [{ item_id: 'egg', ingredient_id: egg, location: 'current' }], equipment: { available: ['pot'], unavailable: [] } } });
  assert.equal(result.error, null);
  assert.equal(result.data.dishes.find(item => item.recipe_id === recipe.id).tier, 'ready');
});

test('editing a basket recipe preserves its identity and clears shared-ingredient approvals', () => {
  const saved = savePrivateRecipe(initialKitchen(catalog), catalog, recipe).data;
  const state = { ...saved, mealRecipeIds: [recipe.id], mealPeople: 4, sharedIngredientIds: [egg] };
  const edited = savePrivateRecipe(state, catalog, { ...recipe, name: '改过的煮蛋', servings: 4 }, recipe.id);
  assert.equal(edited.error, null);
  assert.equal(edited.data.privateRecipes.length, 1);
  assert.equal(edited.data.privateRecipes[0].name, '改过的煮蛋');
  assert.deepEqual(edited.data.mealRecipeIds, [recipe.id]);
  assert.deepEqual(edited.data.sharedIngredientIds, []);
  assert.equal(edited.data.mealPeople, 4);
});

test('deleting a recipe atomically removes its basket entry and resets an empty basket', () => {
  const saved = savePrivateRecipe(initialKitchen(catalog), catalog, recipe).data;
  const state = { ...saved, mealRecipeIds: [recipe.id], mealPeople: 4, sharedIngredientIds: [egg], currentIds: [egg] };
  const removed = deletePrivateRecipe(state, recipe.id);
  assert.equal(removed.error, null);
  assert.deepEqual(removed.data.privateRecipes, []);
  assert.deepEqual(removed.data.mealRecipeIds, []);
  assert.deepEqual(removed.data.sharedIngredientIds, []);
  assert.equal(removed.data.mealPeople, state.defaultPeople);
  assert.deepEqual(removed.data.currentIds, [egg]);
  assert.equal(decodeKitchen(JSON.stringify(removed.data), catalog).error, null);
});

test('invalid edits, ID collisions and missing deletions leave existing recipes unchanged', () => {
  const state = savePrivateRecipe(initialKitchen(catalog), catalog, recipe).data;
  for (const result of [savePrivateRecipe(state, catalog, recipe),
    savePrivateRecipe(state, catalog, { ...recipe, id: 'local_other' }, recipe.id),
    savePrivateRecipe(state, catalog, { ...recipe, name: '' }, recipe.id),
    savePrivateRecipe(initialKitchen(catalog), catalog, recipe, recipe.id), deletePrivateRecipe(state, 'missing')]) {
    assert.equal(result.data, null);
    assert.ok(result.error);
  }
  assert.equal(state.privateRecipes[0].name, recipe.name);
});

test('failed private-recipe deletion retains both the recipe and basket on disk and in memory', async () => {
  const saved = savePrivateRecipe(initialKitchen(catalog), catalog, recipe).data;
  const state = { ...saved, mealRecipeIds: [recipe.id] };
  const original = JSON.stringify(state);
  let payload = original;
  let rejectWrite = true;
  const storage = {
    read: async () => success(payload),
    write: async value => { if (rejectWrite) return failure('存储空间不足'); payload = value; return success(undefined); },
    reset: async () => failure('未使用重置'),
  };
  const session = createKitchenSession(catalog, storage);
  session.load(); await session.settled();
  const result = await session.commit(previous => deletePrivateRecipe(previous, recipe.id));
  assert.ok(result.error);
  assert.equal(payload, original);
  assert.equal(session.getSnapshot().state.privateRecipes.length, 1);
  assert.deepEqual(session.getSnapshot().state.mealRecipeIds, [recipe.id]);
  rejectWrite = false;
  assert.equal((await session.commit(previous => deletePrivateRecipe(previous, recipe.id))).error, null);
  assert.equal(decodeKitchen(payload, catalog).data.privateRecipes.length, 0);
});
