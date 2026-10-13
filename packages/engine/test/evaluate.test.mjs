import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRecipe } from '../src/evaluate.ts';
import { buildInventory } from '../src/inventory.ts';
import { prepareCatalog } from '../src/prepare.ts';
import { optionsForRequirement } from '../src/matching.ts';
import { buildPlan } from '../src/plan.ts';
import { loadCatalog } from '../../../tools/data/load-catalog.mjs';
import { validateCatalog } from '../../../tools/data/validate-catalog.mjs';

const text = value => ({ 'zh-CN': value });
const ingredient = (id, parents = []) => ({ ingredient_id: id, names: text(id), aliases: {},
  selectable: true, matching_parent_ids: parents, implicit_staple: false, review_state: 'pending_review' });
const requirement = (id, importance = 'required') => ({ requirement_id: `req_${id}`, ingredient_id: id,
  importance, role: 'main', consumes: true, quantity: { value: 10, unit: 'g' },
  ...(importance === 'required' ? {} : { omission: { note: text(`省略 ${id}`), step_changes: [{ step_id: `step_${id}`, action: 'skip' }] } }) });
const step = (id, ids) => ({ step_id: id, text: text(id), requirement_ids: ids.map(value => `req_${value}`) });
const replace = (id, ids, value) => ({ ...step(id, ids), action: 'replace', text: text(value) });
const rule = (id, target, substitute, extras = {}) => ({ rule_id: id, scope: 'global',
  required_ingredient_id: target, substitute_ingredient_id: substitute, level: 'acceptable',
  conditions: { cooking_methods: [], requires_available_ingredient_ids: [], requires_confirmation: false },
  quantity_ratio: { required_unit: 'g', substitute_unit: 'g', factor: 1 },
  usage_note: text(`用 ${substitute} 替代 ${target}`), step_policy: 'ingredient_replacement_only',
  review_state: 'pending_review', ...extras });
const allow = (target, ruleId, changes = []) => ({ requirement_id: `req_${target}`, rule_id: ruleId,
  action: 'allow', note: text('经过测试的合成规则'), step_changes: changes });

function fixture({ ingredients = ['a', 'b', 'xa', 'xb'].map(id => ingredient(id)),
  requirements = [requirement('a'), requirement('b')], rules = [], overrides = [], steps } = {}) {
  const recipe = { recipe_id: 'sample', dish_id: 'sample', name: text('合成评估场景'), course: 'veg',
    cooking_method: 'stir_fry', time_minutes: 10, spicy_level: 0, equipment_slots: [], requirements,
    steps: steps ?? requirements.map(item => step(`step_${item.ingredient_id}`, [item.ingredient_id])),
    substitution_overrides: overrides, review_state: 'pending_review' };
  const result = prepareCatalog({ schema_version: '0.1.0', dataset_version: 'synthetic-evaluation-1',
    release_state: 'draft', default_locale: 'zh-CN', ingredients, dishes: [{ dish_id: 'sample' }],
    recipes: [recipe], substitution_rules: rules }, { allowDraft: true });
  assert.equal(result.error, null);
  return { prepared: result.data, recipe: result.data.catalog.recipes[0] };
}

function evaluate(context, ids, options = {}) {
  const items = ids.map(id => typeof id === 'string' ? { item_id: `item_${id}`, ingredient_id: id, location: 'current' } : id);
  const inventory = buildInventory(context.prepared, { inventory: { items, use_implicit_staples: false,
    unavailable_ingredient_ids: options.unavailable ?? [] } });
  return evaluateRecipe(context.prepared, context.recipe, inventory, new Set(options.confirmations ?? []));
}

test('should retain a structurally valid plan diagnostic when required ingredients are missing', () => {
  const result = evaluate(fixture(), ['a']);
  assert.equal(result.plan_valid, true);
  assert.equal(result.plan_error, undefined);
  assert.equal(result.tier, 'insufficient');
  assert.deepEqual(result.missing_required_ingredient_ids, ['b']);
  assert.deepEqual(result.steps, []);
});

test('should prefer exact pantry stock before a current approved descendant', () => {
  const context = fixture({ ingredients: [ingredient('a'), ingredient('specific_a', ['a'])], requirements: [requirement('a')] });
  const result = evaluate(context, [{ item_id: 'pantry_a', ingredient_id: 'a', location: 'pantry' }, 'specific_a']);
  assert.equal(result.requirements[0].inventory_item_id, 'pantry_a');
  assert.equal(result.current_ingredient_count, 0);
});

test('should apply a rule with no cooking-method restriction', () => {
  const result = evaluate(fixture({ rules: [rule('rule_a', 'a', 'xa')] }), ['xa', 'b']);
  assert.equal(result.tier, 'caveat');
  assert.equal(result.requirements[0].rule_id, 'rule_a');
});

test('should require identifying a generic substitute independently of confirming the usage rule', () => {
  const context = fixture({ ingredients: [ingredient('a'), ingredient('b'), ingredient('xa'), ingredient('specific_xa', ['xa'])],
    rules: [rule('rule_a', 'a', 'specific_xa', { conditions: {
      cooking_methods: [], requires_available_ingredient_ids: [], requires_confirmation: true } })] });
  const pending = evaluate(context, ['xa', 'b']);
  assert.equal(pending.tier, 'needs_confirmation');
  assert.equal(pending.requirements[0].reason_code, 'substitute_requires_identity_confirmation');
  const confirmation = pending.requirements[0].confirmation_key;
  assert.equal(typeof confirmation, 'string');
  assert.equal(evaluate(context, ['xa', 'b'], { confirmations: [confirmation] }).tier, 'needs_confirmation');
  assert.deepEqual(pending.steps, []);
});

test('should deduplicate identical changes selected by different substitutions', () => {
  const change = replace('shared', ['a', 'b'], '合并后的步骤');
  const context = fixture({ rules: [rule('rule_a', 'a', 'xa', { step_policy: 'recipe_step_changes_required' }),
    rule('rule_b', 'b', 'xb', { step_policy: 'recipe_step_changes_required' })],
  overrides: [allow('a', 'rule_a', [change]), allow('b', 'rule_b', [change])], steps: [step('shared', ['a', 'b'])] });
  const result = evaluate(context, ['xa', 'xb']);
  assert.equal(result.tier, 'caveat');
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].text['zh-CN'], '合并后的步骤');
});

test('should reject incompatible changes on the same cooking step', () => {
  const context = fixture({ rules: [rule('rule_a', 'a', 'xa', { step_policy: 'recipe_step_changes_required' }),
    rule('rule_b', 'b', 'xb', { step_policy: 'recipe_step_changes_required' })],
  overrides: [allow('a', 'rule_a', [replace('shared', ['a', 'b'], '步骤甲')]),
    allow('b', 'rule_b', [replace('shared', ['a', 'b'], '步骤乙')])], steps: [step('shared', ['a', 'b'])] });
  const result = evaluate(context, ['xa', 'xb']);
  assert.equal(result.plan_valid, false);
  assert.equal(result.plan_error.code, 'plan.conflicting_changes');
  assert.equal(result.plan_error.path, '/recipes/sample');
  assert.equal(result.tier, 'insufficient');
  assert.deepEqual(result.steps, []);
});

test('should find another approved rule when the first complete plan has conflicting changes', () => {
  const context = fixture({ rules: [rule('first_a', 'a', 'xa', { step_policy: 'recipe_step_changes_required' }),
    rule('second_a', 'a', 'xa'), rule('rule_b', 'b', 'xb', { step_policy: 'recipe_step_changes_required' })],
  overrides: [allow('a', 'first_a', [replace('shared', ['a', 'b'], '步骤甲')]),
    allow('b', 'rule_b', [replace('shared', ['a', 'b'], '步骤乙')])], steps: [step('shared', ['a', 'b'])] });
  const result = evaluate(context, ['xa', 'xb']);
  assert.equal(result.plan_valid, true);
  assert.equal(result.tier, 'caveat');
  assert.equal(result.requirements[0].rule_id, 'second_a');
});

test('should reject a replacement that silently removes another required ingredient from all steps', () => {
  const context = fixture({ rules: [rule('rule_a', 'a', 'xa', { step_policy: 'recipe_step_changes_required' })],
    overrides: [allow('a', 'rule_a', [replace('shared', ['a'], '只使用替代品')])], steps: [step('shared', ['a', 'b'])] });
  const result = evaluate(context, ['xa', 'b']);
  assert.equal(result.plan_valid, false);
  assert.equal(result.plan_error.code, 'plan.invalid_steps');
  assert.equal(result.tier, 'insufficient');
});

test('should reject steps that still reference an omitted ingredient', () => {
  const optional = requirement('b', 'optional');
  const result = evaluate(fixture({ requirements: [requirement('a'), optional],
    steps: [step('step_a', ['a', 'b']), step('step_b', ['b'])] }), ['a']);
  assert.equal(result.plan_valid, false);
  assert.equal(result.tier, 'insufficient');
});

test('should preserve authored conditional wording while excluding an omitted ingredient from effective references', () => {
  const optional = requirement('b', 'optional');
  optional.omission.step_changes = [];
  const conditionalStep = { ...step('step_b', ['b']), text: text('如有 b 则加入，没有则跳过。') };
  const result = evaluate(fixture({ requirements: [requirement('a'), optional], steps: [step('step_a', ['a']), conditionalStep] }), ['a']);
  assert.equal(result.tier, 'ready');
  assert.deepEqual(result.steps[1].text, conditionalStep.text);
  assert.deepEqual(result.steps[1].requirement_ids, []);
});

test('should reject replacement text that reintroduces an ingredient omitted by an original conditional instruction', () => {
  const optional = requirement('b', 'optional');
  optional.omission.step_changes = [];
  const context = fixture({ requirements: [requirement('a'), optional],
    rules: [rule('rule_a', 'a', 'xa', { step_policy: 'recipe_step_changes_required' })],
    overrides: [allow('a', 'rule_a', [replace('step_b', ['a', 'b'], '加入 b 和替代品。')])] });
  const result = evaluate(context, ['xa']);
  assert.equal(result.plan_valid, false);
  assert.equal(result.tier, 'insufficient');
});

test('should accept a conditional omission that passes the existing full data validator', async () => {
  const loaded = await loadCatalog();
  assert.equal(loaded.error, null);
  const catalog = structuredClone(loaded.data);
  const recipe = catalog.recipes.find(value => value.recipe_id === 'tomato_egg');
  const optional = recipe.requirements.find(value => value.importance === 'optional');
  optional.omission.step_changes = [];
  for (const original of recipe.steps.filter(value => value.requirement_ids.includes(optional.requirement_id))) {
    original.text['zh-CN'] = `如有该可选原料，则按原用量操作。${original.text['zh-CN']}没有则跳过本步骤。`;
  }
  assert.equal(validateCatalog(catalog).valid, true);
  const prepared = prepareCatalog(catalog, { allowDraft: true });
  assert.equal(prepared.error, null);
  const inventory = buildInventory(prepared.data, { inventory: {
    items: recipe.requirements.filter(value => value.requirement_id !== optional.requirement_id).map(value => ({
      item_id: value.requirement_id, ingredient_id: value.ingredient_id, location: 'current',
    })), equipment: { available: recipe.equipment_slots.map(value => value.equipment), unavailable: [] },
  } });
  const result = evaluateRecipe(prepared.data, prepared.data.catalog.recipes.find(value => value.recipe_id === recipe.recipe_id), inventory, new Set());
  assert.equal(result.tier, 'ready');
  assert.equal(result.steps.some(value => value.requirement_ids.includes(optional.requirement_id)), false);
});

test('should attach the actual vinegar replacement to affected potato cooking steps without rewriting source text', async () => {
  const loaded = await loadCatalog();
  assert.equal(loaded.error, null);
  const prepared = prepareCatalog(loaded.data, { allowDraft: true });
  assert.equal(prepared.error, null);
  const recipe = prepared.data.catalog.recipes.find(value => value.recipe_id === 'shredded_potato');
  const inventory = buildInventory(prepared.data, { inventory: {
    items: recipe.requirements.map(value => ({ item_id: value.requirement_id, location: 'current',
      ingredient_id: value.ingredient_id === 'aromatic_vinegar' ? 'rice_vinegar' : value.ingredient_id })),
    equipment: { available: ['wok'], unavailable: [] },
  } });
  const result = evaluateRecipe(prepared.data, recipe, inventory, new Set());
  assert.equal(result.tier, 'caveat');
  const finish = result.steps.find(value => value.step_id === 'step_finish');
  assert.deepEqual(finish.text, recipe.steps.find(value => value.step_id === 'step_finish').text);
  assert.deepEqual(finish.substitutions, [{ requirement_id: 'req_aromatic_vinegar',
    original_ingredient_id: 'aromatic_vinegar', used_ingredient_id: 'rice_vinegar',
    rule_id: 'sub_rice_vinegar_for_aromatic_vinegar', recipe_quantity: { unit: 'ml', value: 15 },
    usage_note: prepared.data.catalog.substitution_rules.find(value => value.rule_id === 'sub_rice_vinegar_for_aromatic_vinegar').usage_note }]);
  assert.deepEqual(result.steps.find(value => value.step_id === 'step_cut_soak').substitutions, []);
});

test('should require condition ingredients to remain in the actual cooking plan', () => {
  const conditional = rule('rule_a', 'a', 'xa', { step_policy: 'recipe_step_changes_required',
    conditions: { cooking_methods: [], requires_available_ingredient_ids: ['b'], requires_confirmation: false } });
  const context = fixture({ requirements: [requirement('a'), requirement('b', 'optional')], rules: [conditional],
    overrides: [allow('a', 'rule_a', [{ step_id: 'step_b', action: 'skip' }])] });
  const result = evaluate(context, ['xa', 'b']);
  assert.equal(result.plan_valid, false);
  assert.equal(result.tier, 'insufficient');
  const inventory = buildInventory(context.prepared, { inventory: { items: ['xa', 'b'].map(id => ({
    item_id: `item_${id}`, ingredient_id: id, location: 'current',
  })) } });
  const choices = context.recipe.requirements.map(value => optionsForRequirement(context.prepared, context.recipe,
    value, inventory, new Set()));
  const omittedConditionPlan = buildPlan(context.prepared, context.recipe,
    [choices[0].find(value => value.rule), choices[1].find(value => value.match.omitted)]);
  assert.equal(omittedConditionPlan.error.code, 'plan.unsatisfied_conditions');
  assert.equal(omittedConditionPlan.error.path, '/recipes/sample');
});

test('should not satisfy a rule condition using another substituted ingredient', () => {
  const context = fixture({ rules: [rule('rule_a', 'a', 'xa', { conditions: { cooking_methods: [],
    requires_available_ingredient_ids: ['b'], requires_confirmation: false } }), rule('rule_b', 'b', 'xb')] });
  const result = evaluate(context, ['xa', 'xb']);
  assert.equal(result.tier, 'insufficient');
  assert.deepEqual(result.missing_required_ingredient_ids, ['a']);
});

test('should keep generic condition stock uncertain even when the substitution rule is otherwise usable', () => {
  const context = fixture({ ingredients: [ingredient('a'), ingredient('xa'), ingredient('generic_b'), ingredient('b', ['generic_b'])],
    rules: [rule('rule_a', 'a', 'xa', { conditions: { cooking_methods: [], requires_available_ingredient_ids: ['b'], requires_confirmation: false } })] });
  const result = evaluate(context, ['xa', 'generic_b']);
  assert.equal(result.tier, 'needs_confirmation');
  assert.equal(result.requirements.find(value => value.requirement_id === 'req_a').presence, 'uncertain');
  assert.deepEqual(result.steps, []);
});

test('should keep an important generic condition for confirmation when omission would prevent a required substitute', () => {
  const context = fixture({ ingredients: [ingredient('a'), ingredient('xa'), ingredient('generic_b'), ingredient('b', ['generic_b'])],
    requirements: [requirement('a'), requirement('b', 'important')],
    rules: [rule('rule_a', 'a', 'xa', { conditions: { cooking_methods: [], requires_available_ingredient_ids: ['b'], requires_confirmation: false } })] });
  const result = evaluate(context, ['xa', 'generic_b']);
  assert.equal(result.tier, 'needs_confirmation');
  assert.equal(result.requirements.find(value => value.requirement_id === 'req_a').presence, 'uncertain');
  assert.equal(result.requirements.find(value => value.requirement_id === 'req_b').omitted, false);
  assert.deepEqual(result.steps, []);
});

test('should omit an independent important generic ingredient instead of creating an unnecessary confirmation', () => {
  const context = fixture({ ingredients: [ingredient('a'), ingredient('generic_b'), ingredient('b', ['generic_b'])],
    requirements: [requirement('a'), requirement('b', 'important')] });
  const result = evaluate(context, ['a', 'generic_b']);
  assert.equal(result.tier, 'caveat');
  assert.equal(result.requirements[1].omitted, true);
});

test('should require a current confirmation for an authored usage note without a compatible ratio', () => {
  const context = fixture({ rules: [rule('rule_a', 'a', 'xa', { quantity_ratio: undefined,
    conditions: { cooking_methods: [], requires_available_ingredient_ids: [], requires_confirmation: true } })] });
  const pending = evaluate(context, ['xa', 'b']);
  assert.equal(pending.tier, 'needs_confirmation');
  const key = pending.requirements[0].confirmation_key;
  assert.equal(typeof key, 'string');
  const confirmed = evaluate(context, ['xa', 'b'], { confirmations: [key] });
  assert.equal(confirmed.tier, 'caveat');
  assert.equal(confirmed.requirements[0].quantity, undefined);
  assert.equal(confirmed.requirements[0].note['zh-CN'], '用 xa 替代 a');
  const changedWitness = { item_id: 'replacement_stock_xa', ingredient_id: 'xa', location: 'current' };
  assert.equal(evaluate(context, [changedWitness, 'b'], { confirmations: [key] }).tier, 'needs_confirmation');
});

test('should convert numeric and ranged recipe quantities using the declared ratio', () => {
  const ranged = requirement('a');
  ranged.quantity = { min: 10, max: 20, unit: 'g' };
  const context = fixture({ requirements: [ranged, requirement('b')], rules: [rule('rule_a', 'a', 'xa', {
    quantity_ratio: { required_unit: 'g', substitute_unit: 'ml', factor: 2 } })] });
  const result = evaluate(context, ['xa', 'b']);
  assert.deepEqual(result.requirements[0].quantity, { min: 20, max: 40, unit: 'ml' });
});

test('should respect a specific absence while still permitting a separate approved substitute', () => {
  const context = fixture({ ingredients: [ingredient('a'), ingredient('specific_a', ['a']), ingredient('xa'), ingredient('b')],
    requirements: [requirement('specific_a'), requirement('b')], rules: [rule('rule_a', 'specific_a', 'xa')] });
  const missing = evaluate(context, ['a', 'b'], { unavailable: ['specific_a'] });
  assert.equal(missing.requirements[0].presence, 'missing');
  assert.equal(evaluate(context, ['a', 'b', 'xa'], { unavailable: ['specific_a'] }).tier, 'caveat');
});

test('should omit an important ingredient instead of executing an unconfirmed replacement', () => {
  const context = fixture({ requirements: [requirement('a', 'important'), requirement('b')],
    rules: [rule('rule_a', 'a', 'xa', { conditions: { cooking_methods: [], requires_available_ingredient_ids: [], requires_confirmation: true } })] });
  const result = evaluate(context, ['xa', 'b']);
  assert.equal(result.tier, 'caveat');
  assert.equal(result.requirements[0].omitted, true);
  assert.deepEqual(result.steps.map(value => value.step_id), ['step_b']);
});

test('should choose a different direct witness when it is necessary for a complete valid plan', () => {
  const context = fixture({ ingredients: [ingredient('a'), ingredient('xa'), ingredient('generic_b'), ingredient('b', ['generic_b'])],
    requirements: [requirement('a'), requirement('generic_b'), requirement('b', 'optional')],
    rules: [rule('rule_a', 'a', 'xa', { step_policy: 'recipe_step_changes_required', conditions: {
      cooking_methods: [], requires_available_ingredient_ids: ['b'], requires_confirmation: false } })],
    overrides: [allow('a', 'rule_a', [{ step_id: 'step_b', action: 'skip' }])] });
  const result = evaluate(context, ['xa', 'generic_b', 'b']);
  assert.equal(result.tier, 'caveat');
  assert.equal(result.requirements.find(value => value.requirement_id === 'req_generic_b').used_ingredient_id, 'b');
  assert.equal(result.requirements.find(value => value.requirement_id === 'req_b').omitted, true);
});
