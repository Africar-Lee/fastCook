import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createEngine } from '../../../packages/engine/src/index.ts';
import {
  createPrivateRecipeId, createPrivateRecipeStepId, isPrivateRecipeId, MAX_PRIVATE_RECIPES,
  mergePrivateRecipes, validatePrivateRecipe, validatePrivateRecipes,
} from './private-recipes.ts';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const ingredient = (ingredientId, extra = {}) => ({
  ingredientId, quantity: { unit: 'to_taste' }, importance: 'required', role: 'main', consumes: true, ...extra,
});
const recipe = (extra = {}) => ({
  id: 'local_test_egg', name: '蒸蛋', course: 'meat', cookingMethod: 'steam', timeMinutes: 12,
  servings: 2, spicyLevel: 0, equipment: ['steamer'],
  ingredients: [ingredient('egg', { quantity: { unit: 'piece', value: 2 } })],
  steps: [{ id: 'step_steam', text: '鸡蛋打散后蒸至熟透。', ingredientIds: ['egg'] }], ...extra,
});
const input = (ids, equipment = ['steamer']) => ({ inventory: {
  items: ids.map(id => ({ item_id: `current_${id}`, ingredient_id: id, location: 'current' })),
  use_implicit_staples: false,
  equipment: { available: equipment, unavailable: [] },
} });

function evaluate(value, inventory) {
  const validated = validatePrivateRecipe(value, catalog);
  assert.equal(validated.error, null);
  const engine = createEngine(mergePrivateRecipes(catalog, [validated.data]), { allowDraft: true });
  assert.equal(engine.error, null);
  return engine.data.evaluateRecipe(value.id, inventory);
}

function optionalRecipe() {
  return recipe({
    ingredients: [ingredient('egg'), ingredient('salt', { importance: 'optional', role: 'seasoning', omission: {
      note: '省略盐会减淡咸味。', stepChanges: [{ stepId: 'step_mix', action: 'replace', text: '鸡蛋打散。', ingredientIds: ['egg'] }],
    } })],
    steps: [
      { id: 'step_mix', text: '鸡蛋加盐打散。', ingredientIds: ['egg', 'salt'] },
      { id: 'step_steam', text: '蒸至熟透。', ingredientIds: [] },
    ],
  });
}

test('a private recipe joins deterministic recommendations and retains pending review status', () => {
  const valid = validatePrivateRecipe(recipe(), catalog);
  assert.equal(valid.error, null);
  const merged = mergePrivateRecipes(catalog, [valid.data]);
  const stored = merged.recipes.find(item => item.recipe_id === valid.data.id);
  assert.equal(stored.review_state, 'pending_review');
  assert.deepEqual(stored.source_ids, []);
  assert.equal(stored.servings, 2);
  assert.deepEqual(stored.equipment_slots, [{ equipment: 'steamer', minutes: 12, burner_slots: 1 }]);
  const engine = createEngine(merged, { allowDraft: true });
  assert.equal(engine.error, null);
  const recommendations = engine.data.recommend(input(['egg']));
  assert.equal(recommendations.error, null);
  assert.equal(recommendations.data.dishes.find(item => item.recipe_id === valid.data.id).tier, 'ready');
  const absent = engine.data.evaluateRecipe(valid.data.id, input([]));
  assert.equal(absent.data.tier, 'one_missing');
  assert.deepEqual(absent.data.missing_required_ingredient_ids, ['egg']);
});

test('merging and validating recipes preserve the base catalog and caller records', () => {
  const originalCatalog = structuredClone(catalog);
  const source = recipe();
  const before = structuredClone(source);
  const valid = validatePrivateRecipe(source, catalog);
  const merged = mergePrivateRecipes(catalog, [valid.data]);
  assert.deepEqual(catalog, originalCatalog);
  assert.deepEqual(source, before);
  assert.notStrictEqual(merged, catalog);
  assert.equal(merged.recipes.length, catalog.recipes.length + 1);
  assert.deepEqual(merged.recipes.slice(0, catalog.recipes.length), catalog.recipes);
  assert.strictEqual(mergePrivateRecipes(catalog, []), catalog);
  assert.equal(Object.isFrozen(source), false);
});

test('empty private records work with the minimal catalogs used by kitchen migrations', () => {
  assert.deepEqual(validatePrivateRecipes([], { dataset_version: 'minimal' }), { data: [], error: null });
});

test('validated collections are immutable and retain identity when rechecked for inventory updates', () => {
  const source = [recipe()];
  const first = validatePrivateRecipes(source, catalog);
  assert.equal(first.error, null);
  assert.notStrictEqual(first.data, source);
  assert.equal(Object.isFrozen(first.data), true);
  assert.equal(Object.isFrozen(first.data[0].ingredients[0].quantity), true);
  assert.strictEqual(validatePrivateRecipes(first.data, catalog).data, first.data);
  source[0].name = '外部修改';
  assert.equal(first.data[0].name, '蒸蛋');
  assert.throws(() => { first.data[0].steps[0].ingredientIds.push('salt'); }, TypeError);
});

test('editing the same local ID replaces its behavior when merged from the base catalog', () => {
  const first = validatePrivateRecipe(recipe(), catalog).data;
  const edited = validatePrivateRecipe(recipe({ name: '番茄蒸蛋', ingredients: [ingredient('egg'), ingredient('tomato')],
    steps: [{ id: 'step_steam', text: '番茄加入蛋液后蒸熟。', ingredientIds: ['egg', 'tomato'] }] }), catalog);
  assert.equal(edited.error, null);
  assert.equal(edited.data.id, first.id);
  const merged = mergePrivateRecipes(catalog, [edited.data]);
  assert.equal(merged.recipes.filter(item => item.recipe_id === first.id).length, 1);
  assert.equal(merged.recipes.at(-1).name['zh-CN'], '番茄蒸蛋');
  const result = createEngine(merged, { allowDraft: true }).data.evaluateRecipe(first.id, input(['egg']));
  assert.deepEqual(result.data.missing_required_ingredient_ids, ['tomato']);
  assert.equal(mergePrivateRecipes(catalog, []).recipes.some(item => item.recipe_id === first.id), false);
});

test('global substitutions are explicitly forbidden for every matching private requirement', () => {
  const value = recipe({ equipment: [], cookingMethod: 'cold_mix',
    ingredients: [ingredient('aromatic_vinegar')],
    steps: [{ id: 'step_mix', text: '倒入香醋。', ingredientIds: ['aromatic_vinegar'] }] });
  const validated = validatePrivateRecipe(value, catalog);
  assert.equal(validated.error, null);
  const merged = mergePrivateRecipes(catalog, [validated.data]);
  assert.deepEqual(merged.recipes.at(-1).substitution_overrides.map(item => [item.rule_id, item.action]),
    [['sub_rice_vinegar_for_aromatic_vinegar', 'forbid']]);
  const result = evaluate(value, input(['rice_vinegar'], []));
  assert.equal(result.error, null);
  assert.deepEqual(result.data.missing_required_ingredient_ids, ['aromatic_vinegar']);
  assert.equal(result.data.requirements[0].match_kind, 'none');
});

test('an omitted optional ingredient applies the authored replacement step', () => {
  const value = optionalRecipe();
  const result = evaluate(value, input(['egg']));
  assert.equal(result.error, null);
  assert.equal(result.data.plan_valid, true);
  assert.equal(result.data.requirements.find(item => item.ingredient_id === 'salt').omitted, true);
  assert.equal(result.data.steps[0].text['zh-CN'], '鸡蛋打散。');
  assert.deepEqual(result.data.steps[0].requirement_ids, ['req_egg']);
  const complete = evaluate(value, input(['egg', 'salt']));
  assert.equal(complete.data.steps[0].text['zh-CN'], '鸡蛋加盐打散。');
});

test('important ingredients use the same valid omission rules and affect ranking', () => {
  const value = optionalRecipe();
  value.ingredients[1].importance = 'important';
  const result = evaluate(value, input(['egg']));
  assert.equal(result.data.plan_valid, true);
  assert.equal(result.data.important_gap_count, 1);
  assert.equal(result.data.tier, 'caveat');
});

test('a skipped optional-only step leaves required cooking steps executable', () => {
  const value = recipe({ ingredients: [ingredient('egg'), ingredient('salt', { importance: 'optional', omission: {
    note: '省略最后撒盐。', stepChanges: [{ stepId: 'step_finish', action: 'skip' }],
  } })], steps: [
    { id: 'step_cook', text: '鸡蛋蒸熟。', ingredientIds: ['egg'] },
    { id: 'step_finish', text: '撒盐。', ingredientIds: ['salt'] },
  ] });
  const result = evaluate(value, input(['egg']));
  assert.equal(result.data.plan_valid, true);
  assert.deepEqual(result.data.steps.map(step => step.step_id), ['step_cook']);
});

test('conflicting simultaneous omissions are rejected even when each individual plan is valid', () => {
  const value = recipe({ ingredients: [ingredient('egg'), ingredient('salt', { importance: 'optional', omission: {
    note: '不放盐。', stepChanges: [{ stepId: 'step_mix', action: 'replace', text: '鸡蛋加糖打散。', ingredientIds: ['egg', 'sugar'] }],
  } }), ingredient('sugar', { importance: 'optional', omission: {
    note: '不放糖。', stepChanges: [{ stepId: 'step_mix', action: 'replace', text: '鸡蛋加盐打散。', ingredientIds: ['egg', 'salt'] }],
  } })], steps: [{ id: 'step_mix', text: '鸡蛋加入盐和糖打散。', ingredientIds: ['egg', 'salt', 'sugar'] }] });
  assert.match(validatePrivateRecipe(value, catalog).error, /多个省略方案/);
});

test('independent skip plans cannot jointly remove all uses of a required ingredient', () => {
  const value = recipe({ ingredients: [ingredient('egg'), ingredient('salt', { importance: 'optional', omission: {
    note: '不放盐。', stepChanges: [{ stepId: 'step_salt', action: 'skip' }],
  } }), ingredient('sugar', { importance: 'optional', omission: {
    note: '不放糖。', stepChanges: [{ stepId: 'step_sugar', action: 'skip' }],
  } })], steps: [
    { id: 'step_salt', text: '一份蛋液加盐。', ingredientIds: ['egg', 'salt'] },
    { id: 'step_sugar', text: '另一份蛋液加糖。', ingredientIds: ['egg', 'sugar'] },
    { id: 'step_rest', text: '静置。', ingredientIds: [] },
  ] });
  assert.match(validatePrivateRecipe(value, catalog).error, /实际原料不一致/);
});

test('malformed, unknown, oversized and duplicate private collections are rejected', () => {
  for (const value of [null, {}, 'recipe', Array(MAX_PRIVATE_RECIPES + 1).fill(recipe()), [recipe(), recipe()]]) {
    assert.equal(validatePrivateRecipes(value, catalog).data, null);
  }
});

test('one hundred distinct private recipes can be validated and merged', () => {
  const values = Array.from({ length: MAX_PRIVATE_RECIPES }, (_, index) => recipe({ id: `local_saved_${index}` }));
  const result = validatePrivateRecipes(values, catalog);
  assert.equal(result.error, null);
  assert.equal(result.data.length, MAX_PRIVATE_RECIPES);
  assert.equal(mergePrivateRecipes(catalog, result.data).recipes.length, catalog.recipes.length + MAX_PRIVATE_RECIPES);
});

test('excessive omission combinations are rejected before expansion', () => {
  const ids = catalog.ingredients.filter(item => item.selectable).slice(0, 13).map(item => item.ingredient_id);
  const value = recipe({ ingredients: ids.map((id, index) => ingredient(id, { importance: 'optional', omission: {
    note: '省略该原料。', stepChanges: [{ stepId: `step_${index}`, action: 'skip' }],
  } })), steps: [...ids.map((id, index) => ({ id: `step_${index}`, text: '处理原料。', ingredientIds: [id] })),
    { id: 'step_rest', text: '静置。', ingredientIds: [] }] });
  assert.match(validatePrivateRecipe(value, catalog).error, /最多 12 种/);
});

test('unknown fields and invalid basic recipe values are rejected', () => {
  const invalid = [
    null, [], { ...recipe(), extra: true }, { ...recipe(), name: '' }, { ...recipe(), name: '菜'.repeat(81) },
    { ...recipe(), id: 'builtin_recipe' }, { ...recipe(), id: 'local_' }, { ...recipe(), id: 'local_../file' },
    { ...recipe(), course: 'dessert' }, { ...recipe(), cookingMethod: 'unknown' },
    ...[0, 1441, 1.5, NaN].map(timeMinutes => ({ ...recipe(), timeMinutes })),
    ...[0, 21, 2.5].map(servings => ({ ...recipe(), servings })),
    ...[-1, 4, '1'].map(spicyLevel => ({ ...recipe(), spicyLevel })),
    { ...recipe(), equipment: ['wok', 'wok'] }, { ...recipe(), equipment: ['unknown'] },
  ];
  for (const value of invalid) assert.equal(validatePrivateRecipe(value, catalog).data, null);
});

test('recipe IDs cannot collide with base recipes or dishes', () => {
  for (const field of ['recipes', 'dishes']) {
    const collision = { ...catalog, [field]: [...catalog[field], field === 'recipes'
      ? { ...catalog.recipes[0], recipe_id: 'local_test_egg' }
      : { dish_id: 'local_test_egg' }] };
    assert.match(validatePrivateRecipe(recipe(), collision).error, /编号与已有菜谱重复/);
  }
});

test('ingredient records require known selectable unique IDs and valid fields', () => {
  for (const ingredients of [[], Array(31).fill(ingredient('egg')), [ingredient('unknown')], [ingredient('meat')],
    [ingredient('egg'), ingredient('egg')], [null], [ingredient('egg', { extra: true })],
    [ingredient('egg', { importance: 'recommended' })], [ingredient('egg', { role: 'unknown' })],
    [ingredient('egg', { consumes: 'yes' })]]) {
    assert.equal(validatePrivateRecipe(recipe({ ingredients }), catalog).data, null);
  }
});

test('exact, ranged, taste and metric spoon quantities are accepted without altering their meaning', () => {
  for (const quantity of [
    { unit: 'g', value: 125.5 }, { unit: 'ml', min: 50, max: 100 }, { unit: 'piece', value: 2 },
    { unit: 'to_taste' }, { unit: 'tsp', value: 0.5, spoon_standard: 'metric_15ml_5ml' },
    { unit: 'tbsp', min: 1, max: 2, spoon_standard: 'metric_15ml_5ml' },
  ]) {
    const result = validatePrivateRecipe(recipe({ ingredients: [ingredient('egg', { quantity })] }), catalog);
    assert.equal(result.error, null);
    assert.deepEqual(result.data.ingredients[0].quantity, quantity);
  }
});

test('invalid quantity values and unsupported spoon conventions are rejected', () => {
  for (const quantity of [
    null, { unit: 'cup', value: 1 }, { unit: 'g' }, { unit: 'g', value: 0 }, { unit: 'g', value: -1 },
    { unit: 'g', value: Infinity }, { unit: 'g', value: 100001 }, { unit: 'g', value: '1' },
    { unit: 'g', min: 3, max: 2 }, { unit: 'g', min: 1 }, { unit: 'g', value: 2, min: 1, max: 3 },
    { unit: 'to_taste', value: 1 }, { unit: 'g', value: 1, spoon_standard: 'metric_15ml_5ml' },
    { unit: 'tsp', value: 1 }, { unit: 'tbsp', value: 1, spoon_standard: 'US' }, { unit: 'g', value: 1, extra: true },
  ]) assert.equal(validatePrivateRecipe(recipe({ ingredients: [ingredient('egg', { quantity })] }), catalog).data, null);
});

test('steps must be bounded, unique and reference all recipe ingredients without unknown IDs', () => {
  const step = recipe().steps[0];
  for (const steps of [[], Array(31).fill(step), [step, step], [{ ...step, id: 'step_' }],
    [{ ...step, text: '' }], [{ ...step, text: '长'.repeat(1001) }], [{ ...step, text: '文字\u0000' }],
    [{ ...step, ingredientIds: [] }], [{ ...step, ingredientIds: ['salt'] }],
    [{ ...step, ingredientIds: ['egg', 'egg'] }], [{ ...step, extra: true }]]) {
    assert.equal(validatePrivateRecipe(recipe({ steps }), catalog).data, null);
  }
});

test('required ingredients cannot carry an omission and optional ingredients must provide one', () => {
  const valid = optionalRecipe();
  const required = structuredClone(valid);
  required.ingredients[1].importance = 'required';
  assert.equal(validatePrivateRecipe(required, catalog).data, null);
  for (const omission of [undefined, null, { note: '', stepChanges: [] }, { note: '说明', stepChanges: [] },
    { note: '说明', stepChanges: [], extra: true }]) {
    const value = structuredClone(valid);
    value.ingredients[1].omission = omission;
    assert.equal(validatePrivateRecipe(value, catalog).data, null);
  }
});

test('omission changes cannot retain the omitted ingredient, target other steps or duplicate edits', () => {
  const valid = optionalRecipe();
  const change = valid.ingredients[1].omission.stepChanges[0];
  for (const stepChanges of [[{ ...change, ingredientIds: ['egg', 'salt'] }], [{ ...change, ingredientIds: ['unknown'] }],
    [{ ...change, stepId: 'step_steam' }], [{ ...change, stepId: 'step_missing' }], [change, change],
    [{ ...change, text: '' }], [{ stepId: 'step_mix', action: 'skip', text: '多余字段' }]]) {
    const value = structuredClone(valid);
    value.ingredients[1].omission.stepChanges = stepChanges;
    assert.equal(validatePrivateRecipe(value, catalog).data, null);
  }
});

test('every step using an optional ingredient must have an omission adjustment', () => {
  const value = optionalRecipe();
  value.steps[1].ingredientIds = ['salt'];
  assert.match(validatePrivateRecipe(value, catalog).error, /逐一调整/);
});

test('omitting the sole optional ingredient cannot remove every cooking step', () => {
  const value = recipe({ ingredients: [ingredient('egg', { importance: 'optional', omission: {
    note: '略过。', stepChanges: [{ stepId: 'step_steam', action: 'skip' }],
  } })] });
  assert.match(validatePrivateRecipe(value, catalog).error, /至少需要保留一个制作步骤/);
});

test('generated recipe and step IDs use their stable local namespaces', () => {
  const ids = Array.from({ length: 100 }, createPrivateRecipeId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(isPrivateRecipeId));
  assert.match(createPrivateRecipeStepId(), /^step_[a-z0-9_]+$/);
  assert.equal(isPrivateRecipeId('built_in_recipe'), false);
  assert.equal(isPrivateRecipeId(null), false);
});
