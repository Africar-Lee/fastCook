import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createEngine } from '../../../packages/engine/src/index.ts';
import { orderRequirements } from './requirement-presentation.ts';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const created = createEngine(catalog, { allowDraft: true });
assert.equal(created.error, null);
const engine = created.data;

function evaluate(recipeId, ingredientIds) {
  const recipe = catalog.recipes.find(value => value.recipe_id === recipeId);
  assert.ok(recipe);
  const response = engine.recommend({ inventory: {
    items: ingredientIds.map(id => ({ item_id: `stock_${id}`, ingredient_id: id, location: 'current' })),
    equipment: { available: recipe.equipment_slots.map(slot => slot.equipment), unavailable: [] },
  } });
  assert.equal(response.error, null);
  const evaluation = response.data.dishes.find(value => value.recipe_id === recipeId);
  assert.ok(evaluation);
  return { recipe, evaluation };
}

const ingredientOrder = rows => rows.map(row => row.requirement.ingredient_id);

test('shows missing egg first and omitted sugar last for tomato eggs', () => {
  const { recipe, evaluation } = evaluate('tomato_egg', ['tomato']);
  assert.equal(evaluation.tier, 'one_missing');
  const rows = orderRequirements(recipe.requirements, evaluation.requirements);
  assert.deepEqual(ingredientOrder(rows), ['egg', 'tomato', 'cooking_oil', 'salt', 'sugar']);
  assert.equal(rows[0].match.presence, 'missing');
  assert.equal(rows.at(-1).match.omitted, true);
});

test('returns newly available egg to its recipe position after stock changes', () => {
  const { recipe, evaluation } = evaluate('tomato_egg', ['tomato', 'egg']);
  assert.equal(evaluation.tier, 'ready');
  assert.deepEqual(ingredientOrder(orderRequirements(recipe.requirements, evaluation.requirements)),
    ['tomato', 'egg', 'cooking_oil', 'salt', 'sugar']);
});

test('shows missing items before pork identity confirmation and a starch replacement', () => {
  const { recipe, evaluation } = evaluate('sweet_sour_pork', ['pork', 'potato_starch', 'rice_vinegar']);
  const rows = orderRequirements(recipe.requirements, evaluation.requirements);
  assert.deepEqual(ingredientOrder(rows), [
    'egg', 'sugar', 'pork_tenderloin', 'corn_starch', 'cooking_oil', 'rice_vinegar', 'salt', 'water', 'light_soy_sauce',
  ]);
  assert.equal(rows[2].match.presence, 'uncertain');
  assert.equal(rows[2].match.used_ingredient_id, 'pork');
  assert.equal(rows[3].match.match_kind, 'substitution');
  assert.equal(rows[3].match.used_ingredient_id, 'potato_starch');
  assert.equal(rows.at(-1).match.omitted, true);
});

test('preserves recipe order within a status group even if matches arrive in another order', () => {
  const { recipe, evaluation } = evaluate('tomato_egg', ['sugar']);
  const rows = orderRequirements(recipe.requirements, [...evaluation.requirements].reverse());
  assert.deepEqual(ingredientOrder(rows), ['tomato', 'egg', 'cooking_oil', 'salt', 'sugar']);
  assert.equal(rows[0].match.presence, 'missing');
  assert.equal(rows[1].match.presence, 'missing');
});

test('omits requirements without matching results and ignores unrelated matches', () => {
  const { recipe, evaluation } = evaluate('tomato_egg', ['tomato']);
  const egg = evaluation.requirements.find(match => match.ingredient_id === 'egg');
  const unrelated = { ...egg, requirement_id: 'req_unrelated' };
  const rows = orderRequirements(recipe.requirements, [unrelated, egg]);
  assert.deepEqual(ingredientOrder(rows), ['egg']);
  assert.equal(rows[0].match, egg);
  assert.deepEqual(orderRequirements(recipe.requirements, []), []);
  assert.deepEqual(orderRequirements([], evaluation.requirements), []);
});

test('keeps recipe data and engine results unchanged while retaining the original row objects', () => {
  const { recipe, evaluation } = evaluate('sweet_sour_pork', ['pork', 'potato_starch', 'rice_vinegar']);
  const before = structuredClone({ recipe, evaluation });
  const requirements = Object.freeze(recipe.requirements.map(value => Object.freeze(value)));
  const matches = Object.freeze(evaluation.requirements.map(value => Object.freeze(value)));
  const rows = orderRequirements(requirements, matches);
  assert.deepEqual({ recipe, evaluation }, before);
  for (const row of rows) {
    assert.ok(requirements.includes(row.requirement));
    assert.ok(matches.includes(row.match));
    assert.equal(row.requirement.requirement_id, row.match.requirement_id);
  }
});
