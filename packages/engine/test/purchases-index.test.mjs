import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCatalog } from '../../../tools/data/load-catalog.mjs';
import { validateCatalog } from '../../../tools/data/validate-catalog.mjs';
import { evaluateRecipe } from '../src/evaluate.ts';
import { addPurchase, buildInventory } from '../src/inventory.ts';
import { prepareCatalog } from '../src/prepare.ts';
import { recommend } from '../src/recommend.ts';
import { fixtureCatalog, goldenInput } from './golden-fixtures.mjs';

const loaded = await loadCatalog();
assert.equal(loaded.error, null);

function feasible(evaluation) {
  return ['ready', 'caveat'].includes(evaluation.tier);
}

function selectedRecipes(catalog, filters) {
  return catalog.recipes.filter(recipe => (!filters?.courses || filters.courses.includes(recipe.course))
    && (filters?.max_time_minutes === undefined || recipe.time_minutes <= filters.max_time_minutes)
    && (filters?.max_spicy_level === undefined || recipe.spicy_level <= filters.max_spicy_level));
}

function bruteForcePurchases(prepared, input, inventory) {
  const recipes = selectedRecipes(prepared.catalog, input.filters);
  const confirmations = new Set(input.confirmations ?? []);
  const baseline = recipes.map(recipe => evaluateRecipe(prepared, recipe, inventory, confirmations));
  const feasibleDishes = new Set(baseline.filter(feasible).map(result => result.dish_id));
  const owned = new Set(inventory.items.map(item => item.ingredient_id));
  const purchases = [];
  const recipeAdditions = new Map(recipes.map(recipe => [recipe.recipe_id, []]));
  for (const ingredient of prepared.catalog.ingredients) {
    if (!ingredient.selectable || owned.has(ingredient.ingredient_id)) continue;
    const nextInventory = addPurchase(prepared, inventory, ingredient.ingredient_id);
    const newDishes = new Set();
    for (const [index, recipe] of recipes.entries()) {
      const result = evaluateRecipe(prepared, recipe, nextInventory, confirmations);
      if (!feasible(result)) continue;
      if (!feasible(baseline[index])) recipeAdditions.get(recipe.recipe_id).push(ingredient.ingredient_id);
      if (!feasibleDishes.has(recipe.dish_id)) newDishes.add(recipe.dish_id);
    }
    if (newDishes.size > 0) purchases.push({ ingredient_id: ingredient.ingredient_id,
      dish_ids: [...newDishes].sort(), new_dish_count: newDishes.size });
  }
  for (const additions of recipeAdditions.values()) additions.sort();
  purchases.sort((left, right) => right.new_dish_count - left.new_dish_count
    || (left.ingredient_id < right.ingredient_id ? -1 : Number(left.ingredient_id > right.ingredient_id)));
  return { purchases, recipeAdditions };
}

function assertMatchesBruteForce(catalog, input) {
  assert.equal(validateCatalog(catalog).valid, true);
  const preparation = prepareCatalog(catalog, { allowDraft: true });
  assert.equal(preparation.error, null);
  const prepared = preparation.data;
  const inventory = buildInventory(prepared, input);
  const expected = bruteForcePurchases(prepared, input, inventory);
  const actual = recommend(prepared, input, inventory);
  assert.deepEqual(actual.purchases, expected.purchases);
  for (const dish of actual.dishes) {
    assert.deepEqual(dish.buy_ingredient_ids, expected.recipeAdditions.get(dish.recipe_id), dish.recipe_id);
  }
}

const scenarios = [
  { name: 'empty_current_selection', input: {} },
  { name: 'seed_direct_and_substitute_ingredients', input: {
    current: ['tomato', 'egg', 'potato', 'pork_tenderloin'],
    pantry: ['rice_vinegar', 'garlic', 'light_soy_sauce'],
  } },
  { name: 'explicit_missing_staples', input: {
    current: ['tomato', 'egg', 'salt'], unavailable: ['salt'],
  } },
  { name: 'disabled_implicit_staples', input: {
    current: ['tomato', 'egg', 'water', 'cooking_oil'], implicit: false,
  } },
  { name: 'seed_filters', input: {
    current: ['egg'], pantry: ['light_soy_sauce'],
    filters: { courses: ['soup', 'veg'], max_time_minutes: 20, max_spicy_level: 0 },
  } },
  { name: 'unknown_equipment', input: { current: ['egg', 'tomato'], equipment: null } },
  { name: 'approved_descendants', fixture: 'single_pork', input: {} },
  { name: 'descendant_removes_generic_absence', fixture: 'single_soy_sauce', input: { unavailable: ['soy_sauce'] } },
  { name: 'generic_inventory_can_be_refined', fixture: 'single_pork_tenderloin', input: { current: ['pork'] } },
  { name: 'one_purchase_satisfies_multiple_requirements', fixture: 'duplicate_requirements', input: {} },
  { name: 'single_hop_substitutions', fixture: 'acceptable', input: {} },
  { name: 'substitution_condition_dependency', fixture: 'condition', input: { current: ['potato_starch'] } },
  { name: 'forbidden_substitution_pair', fixture: 'forbidden_pair', input: {} },
  { name: 'deduplicated_dishes', fixture: 'purchase_aggregation', input: {} },
  { name: 'already_feasible_dish_variant', fixture: 'purchase_aggregation', input: { current: ['tomato'] } },
  { name: 'filtered_dish_variants', fixture: 'variants', input: { filters: { courses: ['soup'] } } },
];

for (const scenario of scenarios) {
  test(`should_match_all_ingredient_all_recipe_purchase_search_for_${scenario.name}`, () => {
    assertMatchesBruteForce(fixtureCatalog(loaded.data, scenario.fixture), goldenInput(scenario.input));
  });
}

test('should_match_exhaustive_purchase_search_with_existing_rule_confirmation', () => {
  const catalog = fixtureCatalog(loaded.data, 'confirm');
  const prepared = prepareCatalog(catalog, { allowDraft: true }).data;
  const input = goldenInput({ current: ['potato_starch'] });
  const first = recommend(prepared, input, buildInventory(prepared, input));
  const confirmation = first.dishes[0].requirements.find(requirement => requirement.confirmation_key)?.confirmation_key;
  assert.ok(confirmation);
  input.confirmations = [confirmation];
  assertMatchesBruteForce(catalog, input);
});
