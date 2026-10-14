import assert from 'node:assert/strict';
import test from 'node:test';
import { addMealRecipe, adoptMeal, clearMeal, removeMealRecipe, replaceMealRecipe } from './meal-actions.ts';

const catalog = { recipes: [
  { recipe_id: 'a', dish_id: 'dish_a' }, { recipe_id: 'a_variant', dish_id: 'dish_a' },
  ...['b', 'c', 'd', 'e', 'f'].map(id => ({ recipe_id: id, dish_id: `dish_${id}` })),
] };
const initial = { defaultPeople: 3, mealPeople: 3, mealRecipeIds: [], sharedIngredientIds: [], currentIds: ['egg'] };

test('first addition uses default people and does not change inventory', () => {
  const state = { ...initial, mealPeople: 2 };
  const added = addMealRecipe(state, catalog, 'a');
  assert.deepEqual(added.mealRecipeIds, ['a']);
  assert.equal(added.mealPeople, 3);
  assert.deepEqual(added.currentIds, ['egg']);
  assert.deepEqual(state.mealRecipeIds, []);
});

test('basket rejects unknown recipes, duplicate dish variants and a sixth dish', () => {
  const state = { ...initial, mealRecipeIds: ['a', 'b', 'c', 'd', 'e'] };
  for (const id of ['missing', 'a', 'a_variant', 'f']) assert.equal(addMealRecipe(state, catalog, id), state);
  const one = { ...initial, mealRecipeIds: ['a'] };
  assert.equal(addMealRecipe(one, catalog, 'a_variant'), one);
});

test('changing a basket requires confirming shared ingredients again and preserves temporary people', () => {
  const state = { ...initial, mealPeople: 5, mealRecipeIds: ['a', 'b'], sharedIngredientIds: ['egg'] };
  const added = addMealRecipe(state, catalog, 'c');
  assert.equal(added.mealPeople, 5);
  assert.deepEqual(added.sharedIngredientIds, []);
  const replaced = replaceMealRecipe(state, catalog, 'a', 'c');
  assert.deepEqual(replaced.mealRecipeIds, ['c', 'b']);
  assert.deepEqual(replaced.sharedIngredientIds, []);
  assert.equal(replaceMealRecipe(state, catalog, 'b', 'a_variant'), state);
  assert.equal(replaceMealRecipe(state, catalog, 'missing', 'c'), state);
});

test('removing the final dish clears meal-specific people and shared approvals', () => {
  const state = { ...initial, mealPeople: 5, mealRecipeIds: ['a'], sharedIngredientIds: ['egg'] };
  const emptied = removeMealRecipe(state, 'a');
  assert.deepEqual(emptied, initial);
  assert.deepEqual(clearMeal(state), initial);
  assert.equal(removeMealRecipe(state, 'missing'), state);
});

test('adopting a full plan replaces the basket without carrying sharing approvals', () => {
  const state = { ...initial, mealRecipeIds: ['a'], sharedIngredientIds: ['egg'] };
  const adopted = adoptMeal(state, catalog, ['b', 'c', 'd'], 4);
  assert.deepEqual(adopted.mealRecipeIds, ['b', 'c', 'd']);
  assert.equal(adopted.mealPeople, 4);
  assert.equal(adopted.defaultPeople, 3);
  assert.deepEqual(adopted.sharedIngredientIds, []);
  for (const ids of [[], ['a'], ['a', 'a_variant'], ['a', 'missing'], ['a', 'b', 'c', 'd', 'e', 'f']]) {
    assert.equal(adoptMeal(state, catalog, ids, 3), state);
  }
  for (const people of [0, 13, 2.5, NaN]) assert.equal(adoptMeal(state, catalog, ['b', 'c'], people), state);
});
