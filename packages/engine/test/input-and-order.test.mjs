import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog } from '../../../tools/data/load-catalog.mjs';
import { validateCatalog } from '../../../tools/data/validate-catalog.mjs';
import { createEngine } from '../src/index.ts';
import { compareEvaluations } from '../src/recommend.ts';

const loaded = await loadCatalog();
assert.equal(loaded.error, null);
assert.equal(validateCatalog(loaded.data).valid, true);
const created = createEngine(loaded.data, { allowDraft: true });
assert.equal(created.error, null);
const engine = created.data;
const equipment = { available: ['wok', 'pot', 'steamer', 'frying_pan'], unavailable: [] };
const inventoryInput = (...ids) => ({ inventory: { items: ids.map(id => ({ item_id: id, ingredient_id: id, location: 'current' })), equipment } });
const result = input => {
  const response = engine.recommend(input);
  assert.equal(response.error, null);
  return response.data;
};

for (const [name, input] of [
  ['null input', null],
  ['missing inventory', {}],
  ['array inventory', { inventory: [] }],
  ['unknown top-level property', { ...inventoryInput(), api_key: 'unused' }],
  ['unknown inventory property', { inventory: { items: [], inherited: true } }],
  ['unknown ingredient', inventoryInput('unknown_ingredient')],
  ['navigation-only ingredient', inventoryInput('meat')],
  ['invalid location', { inventory: { items: [{ item_id: 'egg', ingredient_id: 'egg', location: 'implicit' }] } }],
  ['reserved internal item identity', { inventory: { items: [{ item_id: 'implicit:egg', ingredient_id: 'egg', location: 'current' }] } }],
  ['conflicting repeated item identity', { inventory: { items: [{ item_id: 'same', ingredient_id: 'egg', location: 'current' }, { item_id: 'same', ingredient_id: 'tomato', location: 'current' }] } }],
  ['oversized inventory', { inventory: { items: Array.from({ length: 513 }, (_, index) => ({ item_id: `egg_${index}`, ingredient_id: 'egg', location: 'current' })) } }],
  ['unknown unavailable ingredient', { inventory: { items: [], unavailable_ingredient_ids: ['unknown'] } }],
  ['invalid implicit setting', { inventory: { items: [], use_implicit_staples: 'yes' } }],
  ['contradictory equipment', { inventory: { items: [], equipment: { available: ['wok'], unavailable: ['wok'] } } }],
  ['unknown equipment', { inventory: { items: [], equipment: { available: ['unknown'], unavailable: [] } } }],
  ['missing equipment array', { inventory: { items: [], equipment: { available: ['wok'] } } }],
  ['invalid filters', { ...inventoryInput(), filters: [] }],
  ['unknown filter', { ...inventoryInput(), filters: { ai_sort: true } }],
  ['infinite duration', { ...inventoryInput(), filters: { max_time_minutes: Infinity } }],
  ['negative duration', { ...inventoryInput(), filters: { max_time_minutes: -1 } }],
  ['fractional spicy level', { ...inventoryInput(), filters: { max_spicy_level: 0.5 } }],
  ['unknown course', { ...inventoryInput(), filters: { courses: ['dessert'] } }],
  ['non-array confirmations', { ...inventoryInput(), confirmations: 'confirmed' }],
  ['non-string confirmation', { ...inventoryInput(), confirmations: [false] }],
]) {
  test(`rejects ${name} with a contextual input error`, () => {
    const response = engine.recommend(input);
    assert.equal(response.data, null);
    assert.equal(response.error.code, 'input.invalid');
    assert.ok(response.error.path);
    assert.ok(response.error.message.length > 10);
  });
}

test('ingredient and equipment order do not change recommendations or signatures', () => {
  const input = inventoryInput('tomato', 'egg', 'scallion', 'light_soy_sauce');
  const reversed = structuredClone(input);
  reversed.inventory.items.reverse();
  reversed.inventory.equipment.available.reverse();
  assert.deepEqual(result(input), result(reversed));
});

test('duplicate IDs and duplicate ingredient entries do not increase ingredient coverage', () => {
  const input = inventoryInput('tomato', 'egg');
  const repeated = structuredClone(input);
  repeated.inventory.items.push({ ...repeated.inventory.items[1] }, { item_id: 'z_another_egg', ingredient_id: 'egg', location: 'current' });
  assert.deepEqual(result(input), result(repeated));
});

test('current inventory wins over a duplicate pantry entry without counting both', () => {
  const input = inventoryInput('tomato', 'egg');
  input.inventory.items.push({ item_id: 'a_pantry_egg', ingredient_id: 'egg', location: 'pantry' });
  const dish = result(input).dishes.find(dish => dish.dish_id === 'tomato_egg');
  assert.deepEqual(dish.used_inventory_item_ids, ['egg', 'tomato']);
  assert.equal(dish.current_ingredient_count, 2);
});

test('implicit staples can be disabled and explicit absence takes precedence over stale ownership', () => {
  const input = inventoryInput('tomato', 'egg', 'salt');
  input.inventory.use_implicit_staples = false;
  input.inventory.unavailable_ingredient_ids = ['salt'];
  const dish = result(input).dishes.find(dish => dish.dish_id === 'tomato_egg');
  assert.equal(dish.tier, 'insufficient');
  assert.deepEqual(dish.missing_required_ingredient_ids, ['cooking_oil', 'salt']);
});

test('adding a purchased ingredient clears its absence without reviving other excluded items', () => {
  const input = inventoryInput('tomato', 'egg', 'salt');
  input.inventory.unavailable_ingredient_ids = ['salt'];
  const response = result(input);
  const dish = response.dishes.find(dish => dish.dish_id === 'tomato_egg');
  assert.equal(dish.tier, 'one_missing');
  assert.ok(dish.buy_ingredient_ids.includes('salt'));
  assert.ok(response.purchases.find(purchase => purchase.ingredient_id === 'salt').dish_ids.includes('tomato_egg'));
});

test('recommendation does not mutate the catalog or the callers inventory', () => {
  const catalog = structuredClone(loaded.data);
  const before = structuredClone(catalog);
  const localEngine = createEngine(catalog, { allowDraft: true }).data;
  const input = inventoryInput('tomato', 'egg');
  const original = structuredClone(input);
  localEngine.recommend(input);
  assert.deepEqual(input, original);
  assert.deepEqual(catalog, before);
  catalog.recipes[0].time_minutes = 1234;
  assert.deepEqual(localEngine.recommend(input), engine.recommend(input));
});

test('unconfirmed empty equipment remains explicit even when ingredient kinds are complete', () => {
  const input = inventoryInput('tomato', 'egg');
  delete input.inventory.equipment;
  const dish = result(input).dishes.find(dish => dish.dish_id === 'tomato_egg');
  assert.equal(dish.tier, 'needs_confirmation');
  assert.deepEqual(dish.uncertain_equipment, ['wok']);
  assert.deepEqual(dish.steps, []);
});

test('an empty course filter returns no recipes or purchase suggestions', () => {
  const response = result({ ...inventoryInput('egg'), filters: { courses: [] } });
  assert.deepEqual(response.dishes, []);
  assert.deepEqual(response.purchases, []);
});

test('name resolution validates bounded input and keeps ambiguous aliases unresolved', () => {
  assert.equal(engine.resolveIngredient(null).error.code, 'input.invalid');
  assert.equal(engine.resolveIngredient('x'.repeat(161)).error.code, 'input.invalid');
  assert.equal(engine.resolveIngredient('番茄', '../../../bad').error.code, 'input.invalid');
  assert.deepEqual(engine.resolveIngredient('　西红柿　').data, { status: 'resolved', ingredient_ids: ['tomato'] });
  assert.equal(engine.resolveIngredient('生粉').data.status, 'needs_confirmation');
});

test('adding definitely owned ingredients preserves feasible dishes when no rule confirmation is invalidated', () => {
  const ids = ['tomato', 'egg', 'potato', 'garlic', 'pork_tenderloin', 'green_pepper', 'light_soy_sauce', 'rice_vinegar', 'sugar', 'broccoli', 'corn_starch', 'chicken_thigh', 'peanut'];
  const feasible = response => new Set(response.dishes.filter(dish => ['ready', 'caveat'].includes(dish.tier)).map(dish => dish.dish_id));
  for (let offset = 0; offset < ids.length; offset += 1) {
    const selected = ids.filter((_, index) => (index + offset) % 3 === 0);
    const baseline = feasible(result(inventoryInput(...selected)));
    const extended = feasible(result(inventoryInput(...new Set([...selected, ids[offset]]))));
    for (const dishId of baseline) assert.ok(extended.has(dishId), `${dishId} disappeared after adding ${ids[offset]}`);
  }
});

test('lexicographic ranking uses tiers, important gaps, uncertainty, substitution impact, actual coverage, time and stable IDs', () => {
  const baseline = result(inventoryInput('tomato', 'egg')).dishes.find(dish => dish.dish_id === 'tomato_egg');
  const compare = (better, worse) => assert.ok(compareEvaluations({ ...baseline, ...better }, { ...baseline, ...worse }) < 0);
  compare({ tier: 'ready', time_minutes: 100 }, { tier: 'caveat', time_minutes: 1 });
  compare({ tier: 'caveat' }, { tier: 'needs_confirmation' });
  compare({ tier: 'needs_confirmation' }, { tier: 'one_missing' });
  compare({ tier: 'one_missing' }, { tier: 'insufficient' });
  compare({ important_gap_count: 0, time_minutes: 100 }, { important_gap_count: 1, time_minutes: 1 });
  compare({ uncertain_required_count: 0 }, { uncertain_required_count: 1 });
  compare({ substitution_counts: { poor: 0, acceptable: 10, equivalent: 0 } }, { substitution_counts: { poor: 1, acceptable: 0, equivalent: 0 } });
  compare({ substitution_counts: { poor: 0, acceptable: 0, equivalent: 10 } }, { substitution_counts: { poor: 0, acceptable: 1, equivalent: 0 } });
  compare({ substitution_counts: { poor: 0, acceptable: 0, equivalent: 0 } }, { substitution_counts: { poor: 0, acceptable: 0, equivalent: 1 } });
  compare({ current_ingredient_count: 2 }, { current_ingredient_count: 1 });
  compare({ time_minutes: 10 }, { time_minutes: 20 });
  compare({ dish_id: 'a' }, { dish_id: 'b' });
  compare({ recipe_id: 'a' }, { recipe_id: 'b' });
});
