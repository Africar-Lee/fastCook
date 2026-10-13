import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCatalog } from '../../../tools/data/load-catalog.mjs';
import { createEngine } from '../src/index.ts';

const loaded = await loadCatalog();
assert.equal(loaded.error, null);
const catalog = loaded.data;
const created = createEngine(catalog, { allowDraft: true });
assert.equal(created.error, null);
const engine = created.data;
const upstreamCommit = '3dfa950f6daf0a5b311fc46619f1b559bac980c4';
const licenseHash = '6b0382b16279f26ff69014300541967a356a666eb0b91b422f6862f6b7dad17e';
const fixtures = [
  { id: 'spinach_egg', ingredients: ['spinach', 'egg', 'cooking_oil', 'salt', 'water'], equipment: ['wok'] },
  { id: 'onion_egg', ingredients: ['onion', 'egg', 'cooking_oil', 'salt', 'scallion', 'cooking_wine'], equipment: ['wok'] },
  { id: 'tiger_skin_pepper', ingredients: ['green_pepper', 'garlic', 'cooking_oil', 'sugar', 'light_soy_sauce', 'aromatic_vinegar', 'salt'], equipment: ['wok'] },
  { id: 'cold_cucumber', ingredients: ['cucumber', 'vinegar', 'soy_sauce', 'garlic', 'salt', 'sesame_oil', 'oyster_sauce', 'sugar'], equipment: [] },
  { id: 'steamed_pumpkin', ingredients: ['pumpkin', 'water'], equipment: ['steamer'] },
];

function inputFor(fixture) {
  return { inventory: {
    items: fixture.ingredients.map(id => ({ item_id: `stock_${id}`, ingredient_id: id, location: 'current' })),
    use_implicit_staples: false,
    equipment: { available: fixture.equipment, unavailable: [] },
  } };
}

function evaluation(id, input) {
  const response = engine.recommend(input);
  assert.equal(response.error, null);
  const result = response.data.dishes.find(dish => dish.recipe_id === `howtocook_${id}`);
  assert.ok(result, `Imported recipe howtocook_${id} should be included in recommendations`);
  return result;
}

for (const fixture of fixtures) {
  test(`should make imported ${fixture.id} ready with its stated ingredients and equipment`, () => {
    const result = evaluation(fixture.id, inputFor(fixture));
    const recipe = catalog.recipes.find(item => item.recipe_id === result.recipe_id);
    assert.equal(result.tier, 'ready');
    assert.equal(result.plan_valid, true);
    assert.deepEqual(result.missing_required_ingredient_ids, []);
    assert.deepEqual(result.uncertain_requirement_ids, []);
    assert.deepEqual(result.missing_equipment, []);
    assert.deepEqual(result.uncertain_equipment, []);
    assert.deepEqual(result.steps.map(step => step.text), recipe.steps.map(step => step.text));
  });

  test(`should keep imported ${fixture.id} unavailable when all ingredients are absent`, () => {
    const input = inputFor(fixture);
    input.inventory.items = [];
    const result = evaluation(fixture.id, input);
    assert.equal(result.tier, 'insufficient');
    assert.ok(result.missing_required_ingredient_ids.length > 0);
    assert.deepEqual(result.steps, []);
  });
}

test('should require the sugar used by imported cucumber preparation even though its upstream ingredient list omits it', () => {
  const fixture = fixtures.find(item => item.id === 'cold_cucumber');
  const input = inputFor(fixture);
  input.inventory.items = input.inventory.items.filter(item => item.ingredient_id !== 'sugar');
  const result = evaluation(fixture.id, input);
  assert.equal(result.tier, 'one_missing');
  assert.deepEqual(result.missing_required_ingredient_ids, ['sugar']);
  assert.ok(result.buy_ingredient_ids.includes('sugar'));
  assert.deepEqual(result.steps, []);
});

test('should respect unavailable water in imported spinach despite implicit staples and stale stock', () => {
  const fixture = fixtures.find(item => item.id === 'spinach_egg');
  const input = inputFor(fixture);
  input.inventory.use_implicit_staples = true;
  input.inventory.unavailable_ingredient_ids = ['water'];
  const result = evaluation(fixture.id, input);
  assert.equal(result.tier, 'one_missing');
  assert.deepEqual(result.missing_required_ingredient_ids, ['water']);
  assert.deepEqual(result.steps, []);
});

test('should require aromatic vinegar for imported peppers until its rice vinegar substitution is reviewed', () => {
  const fixture = fixtures.find(item => item.id === 'tiger_skin_pepper');
  const input = inputFor(fixture);
  input.inventory.items = input.inventory.items.map(item => item.ingredient_id === 'aromatic_vinegar'
    ? { item_id: 'stock_rice_vinegar', ingredient_id: 'rice_vinegar', location: 'current' } : item);
  const result = evaluation(fixture.id, input);
  assert.equal(result.tier, 'one_missing');
  assert.deepEqual(result.missing_required_ingredient_ids, ['aromatic_vinegar']);
  assert.equal(result.requirements.find(item => item.ingredient_id === 'aromatic_vinegar').rule_id, undefined);
  assert.deepEqual(result.steps, []);
});

test('should block imported pumpkin when the steamer is explicitly unavailable', () => {
  const fixture = fixtures.find(item => item.id === 'steamed_pumpkin');
  const input = inputFor(fixture);
  input.inventory.equipment = { available: ['wok'], unavailable: ['steamer'] };
  const result = evaluation(fixture.id, input);
  assert.equal(result.tier, 'insufficient');
  assert.deepEqual(result.missing_required_ingredient_ids, []);
  assert.deepEqual(result.missing_equipment, ['steamer']);
  assert.deepEqual(result.uncertain_equipment, []);
  assert.deepEqual(result.buy_ingredient_ids, []);
  assert.deepEqual(result.steps, []);
});

test('should request steamer confirmation for imported pumpkin when equipment has not been configured', () => {
  const fixture = fixtures.find(item => item.id === 'steamed_pumpkin');
  const input = inputFor(fixture);
  delete input.inventory.equipment;
  const result = evaluation(fixture.id, input);
  assert.equal(result.tier, 'needs_confirmation');
  assert.deepEqual(result.missing_required_ingredient_ids, []);
  assert.deepEqual(result.missing_equipment, []);
  assert.deepEqual(result.uncertain_equipment, ['steamer']);
  assert.deepEqual(result.steps, []);
});

test('should retain pending review and pinned upstream license evidence for every imported recipe', () => {
  for (const fixture of fixtures) {
    const recipe = catalog.recipes.find(item => item.recipe_id === `howtocook_${fixture.id}`);
    assert.ok(recipe);
    assert.equal(recipe.review_state, 'pending_review');
    assert.ok(recipe.source_ids.length > 0);
    for (const sourceId of recipe.source_ids) {
      const source = catalog.sources.find(item => item.source_id === sourceId);
      assert.ok(source);
      assert.equal(source.provenance.kind, 'upstream');
      assert.equal(source.revision.identifier, upstreamCommit);
      assert.match(source.revision.snapshot_sha256, /^[a-f0-9]{64}$/);
      assert.equal(source.license.state, 'pending');
      assert.equal(source.license.identifier, 'Unlicense');
      assert.equal(source.license.evidence_sha256, licenseHash);
      assert.ok(source.license.evidence_locator.length > 0);
    }
  }
});
