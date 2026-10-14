import assert from 'node:assert/strict';
import test from 'node:test';
import { addRecognizedIngredients } from './vision-actions.ts';
import { initialKitchen } from '../storage/state.ts';

const catalog = { dataset_version: 'test', recipes: [], ingredients: [
  { ingredient_id: 'egg', selectable: true },
  { ingredient_id: 'salt', selectable: true },
  { ingredient_id: 'chicken', selectable: true },
  { ingredient_id: 'chicken_breast', selectable: true, matching_parent_ids: ['chicken'] },
  { ingredient_id: 'hidden', selectable: false },
] };

test('confirmed recognition adds known ingredients without moving pantry items or duplicating stock', () => {
  const state = { ...initialKitchen(catalog), currentIds: ['egg'], pantryIds: ['salt'] };
  const result = addRecognizedIngredients(state, catalog, ['egg', 'salt', 'chicken_breast', 'chicken_breast']);
  assert.equal(result.error, null);
  assert.deepEqual(result.data.currentIds, ['egg', 'chicken_breast']);
  assert.deepEqual(result.data.pantryIds, ['salt']);
  assert.deepEqual(state.currentIds, ['egg']);
});

test('confirmed ingredients clear their prior unavailable status including matching parents', () => {
  const state = { ...initialKitchen(catalog), unavailableIds: ['chicken', 'chicken_breast', 'salt'] };
  const result = addRecognizedIngredients(state, catalog, ['chicken_breast']);
  assert.deepEqual(result.data.unavailableIds, ['salt']);
});

test('unknown, hidden, empty and oversized selections are rejected without partially updating inventory', () => {
  const state = initialKitchen(catalog);
  for (const ids of [[], ['egg', 'unknown'], ['hidden'], Array(31).fill('egg'), null]) {
    const result = addRecognizedIngredients(state, catalog, ids);
    assert.equal(result.data, null);
    assert.ok(result.error);
    assert.deepEqual(state.currentIds, []);
  }
});

test('recognition cannot exceed the persisted inventory limit', () => {
  const largeCatalog = { ...catalog, ingredients: Array.from({ length: 257 }, (_, index) => ({ ingredient_id: `item_${index}`, selectable: true })) };
  const state = { ...initialKitchen(largeCatalog), currentIds: largeCatalog.ingredients.slice(0, 256).map(item => item.ingredient_id) };
  const result = addRecognizedIngredients(state, largeCatalog, ['item_256']);
  assert.ok(result.error);
  assert.equal(state.currentIds.length, 256);
});
