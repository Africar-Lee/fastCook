import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadCatalog } from '../../../tools/data/load-catalog.mjs';
import { validateCatalog } from '../../../tools/data/validate-catalog.mjs';
import { createEngine } from '../src/index.ts';
import { fixtureCatalog, goldenInput } from './golden-fixtures.mjs';

const golden = JSON.parse(await readFile(new URL('../../../data/golden/cases.json', import.meta.url), 'utf8'));
const loaded = await loadCatalog();
assert.equal(loaded.error, null);
const baseCatalog = loaded.data;
const engines = new Map();

function succeed(result) {
  assert.equal(result.error, null, JSON.stringify(result.error));
  return result.data;
}

function createValidatedEngine(catalog) {
  const validation = validateCatalog(catalog);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  return succeed(createEngine(catalog, { allowDraft: true }));
}

function getEngine(fixture) {
  const key = fixture ?? 'real_catalog';
  if (!engines.has(key)) engines.set(key, createValidatedEngine(fixtureCatalog(baseCatalog, fixture)));
  return engines.get(key);
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function feasible(result) {
  return sorted(result.dishes.filter(item => ['ready', 'caveat'].includes(item.tier)).map(item => item.dish_id));
}

function freeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function assertRequirementDetails(actual, expected) {
  const requirements = new Map(actual.requirements.map(item => [item.requirement_id, item]));
  for (const [requirementId, kind] of Object.entries(expected.matches ?? {})) {
    assert.equal(requirements.get(requirementId)?.match_kind, kind, requirementId);
  }
  for (const [requirementId, quantity] of Object.entries(expected.quantities ?? {})) {
    assert.deepEqual(requirements.get(requirementId)?.quantity, quantity, requirementId);
  }
  for (const requirementId of expected.omitted ?? []) {
    assert.equal(requirements.get(requirementId)?.omitted, true, requirementId);
  }
  for (const requirementId of expected.confirmation_for ?? []) {
    assert.equal(typeof requirements.get(requirementId)?.confirmation_key, 'string', requirementId);
    assert.ok(requirements.get(requirementId).confirmation_key.length > 0);
  }
}

function assertRecommendation(result, scenario) {
  const expected = scenario.expect;
  const targetId = scenario.target ?? 'fixture_dish';
  const actual = result.dishes.find(item => item.dish_id === targetId);
  if (expected.absent) {
    assert.equal(actual, undefined, targetId);
    return;
  }
  assert.ok(actual, `Expected dish ${targetId}`);
  for (const field of ['tier', 'recipe_id']) {
    if (field in expected) assert.equal(actual[field], expected[field], field);
  }
  const arrayFields = {
    missing: 'missing_required_ingredient_ids', uncertain: 'uncertain_requirement_ids',
    missing_equipment: 'missing_equipment', uncertain_equipment: 'uncertain_equipment',
  };
  for (const [expectedField, actualField] of Object.entries(arrayFields)) {
    if (expectedField in expected) assert.deepEqual(sorted(actual[actualField]), sorted(expected[expectedField]), expectedField);
  }
  if ('current_count' in expected) assert.equal(actual.current_ingredient_count, expected.current_count);
  if (expected.rule_ids) assert.deepEqual(sorted(actual.requirements.flatMap(item => item.rule_id ? [item.rule_id] : [])), sorted(expected.rule_ids));
  if (expected.dish_ids) assert.deepEqual(sorted(result.dishes.map(item => item.dish_id)), sorted(expected.dish_ids));
  if (expected.order) assert.deepEqual(result.dishes.map(item => item.dish_id), expected.order);
  for (const id of expected.steps_absent ?? []) assert.ok(!actual.steps.some(step => step.step_id === id), id);
  for (const id of expected.buy_contains ?? []) assert.ok(actual.buy_ingredient_ids.includes(id), id);
  for (const id of expected.uncertain_contains ?? []) assert.ok(actual.uncertain_requirement_ids.includes(id), id);
  for (const purchase of expected.purchases ?? []) {
    const actualPurchase = result.purchases.find(item => item.ingredient_id === purchase.ingredient_id);
    assert.deepEqual(actualPurchase, purchase, purchase.ingredient_id);
  }
  if (expected.no_purchase_dish) assert.ok(result.purchases.every(item => !item.dish_ids.includes(expected.no_purchase_dish)));
  assertRequirementDetails(actual, expected);
  assert.equal(result.quantity_scope, 'ingredient_kinds_only');
  assert.equal(result.data_status, 'draft');
}

function withConfirmations(engine, input, scenario) {
  if (!scenario.confirm_rules) return input;
  const preview = succeed(engine.recommend(input));
  const confirmations = preview.dishes.flatMap(dish => dish.requirements)
    .filter(item => scenario.confirm_rules.includes(item.rule_id)).map(item => item.confirmation_key);
  assert.equal(confirmations.length, scenario.confirm_rules.length);
  assert.ok(confirmations.every(key => typeof key === 'string' && key.length > 0));
  if (scenario.change_item_after_confirmation) {
    assert.ok(input.inventory.items.some(item => item.ingredient_id === scenario.change_item_after_confirmation));
  }
  const items = input.inventory.items.map(item => item.ingredient_id === scenario.change_item_after_confirmation
    ? { ...item, item_id: `${item.item_id}_changed_after_confirmation` } : item);
  return {
    ...input,
    inventory: {
      ...input.inventory,
      items: [...items, ...(scenario.add_after_confirmation ? [{
        item_id: 'added_after_confirmation', ingredient_id: scenario.add_after_confirmation, location: 'current',
      }] : [])],
    },
    confirmations,
  };
}

function assertProperty(scenario) {
  const catalog = fixtureCatalog(baseCatalog, scenario.fixture);
  const input = goldenInput(scenario);
  const engine = createValidatedEngine(catalog);
  const before = succeed(engine.recommend(input));
  if (scenario.property === 'input_order') {
    const reordered = { ...input, inventory: { ...input.inventory, items: [...input.inventory.items].reverse() } };
    assert.deepEqual(succeed(engine.recommend(reordered)), before);
    assert.deepEqual(before.dishes.map(item => item.dish_id), scenario.expect.order);
  } else if (scenario.property === 'catalog_order') {
    catalog.ingredients.reverse();
    catalog.recipes.reverse();
    catalog.dishes.reverse();
    catalog.substitution_rules.reverse();
    const reordered = succeed(createValidatedEngine(catalog).recommend(input));
    assert.deepEqual(reordered, before);
    assert.deepEqual(before.dishes.map(item => item.dish_id), scenario.expect.order);
  } else if (scenario.property === 'no_mutation') {
    const originalInput = structuredClone(input);
    const originalCatalog = structuredClone(catalog);
    const frozenEngine = createValidatedEngine(freeze(catalog));
    const output = succeed(frozenEngine.recommend(freeze(input)));
    assert.deepEqual(input, originalInput);
    assert.deepEqual(catalog, originalCatalog);
    assert.deepEqual(feasible(output), scenario.expect.feasible);
  } else if (scenario.property === 'monotonic') {
    const added = { ...input, inventory: { ...input.inventory, items: [...input.inventory.items, {
      item_id: 'added_inventory', ingredient_id: scenario.add, location: 'current',
    }] } };
    const after = succeed(engine.recommend(added));
    assert.deepEqual(feasible(before), scenario.expect.before);
    assert.deepEqual(feasible(after), scenario.expect.after);
    assert.ok(feasible(before).every(id => feasible(after).includes(id)));
  } else assert.fail(`Unknown property ${scenario.property}`);
}

test('golden expectations stay versioned and explicitly pending human review', () => {
  assert.equal(golden.dataset_version, baseCatalog.dataset_version);
  assert.equal(golden.review_state, 'pending_review');
  assert.equal(golden.provenance, 'assistant_authored');
  assert.ok(golden.cases.length >= 50);
  assert.equal(new Set(golden.cases.map(item => item.id)).size, golden.cases.length);
});

for (const scenario of golden.cases) {
  test(`golden ${scenario.id}`, () => {
    if (scenario.kind === 'invalid_catalog') {
      const validation = validateCatalog(fixtureCatalog(baseCatalog, scenario.fixture));
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.some(error => error.code === scenario.expect.validation_code), JSON.stringify(validation.errors));
      return;
    }
    if (scenario.kind === 'property') return assertProperty(scenario);
    let engine = getEngine(scenario.fixture);
    if (scenario.kind === 'resolve') {
      const actual = succeed(engine.resolveIngredient(scenario.query, scenario.locale));
      assert.equal(actual.status, scenario.expect.status);
      assert.deepEqual(sorted(actual.ingredient_ids), scenario.expect.ingredient_ids);
      return;
    }
    const input = withConfirmations(engine, goldenInput(scenario), scenario);
    if (scenario.change_version_after_confirmation) {
      const updated = fixtureCatalog(baseCatalog, scenario.fixture);
      updated.dataset_version += '-changed';
      engine = createValidatedEngine(updated);
    }
    assertRecommendation(succeed(engine.recommend(input)), scenario);
  });
}
