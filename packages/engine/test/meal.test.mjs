import assert from 'node:assert/strict';
import test from 'node:test';
import { consumedIngredientIds, createEngine, defaultMealPatterns, estimateMealMinutes,
  findMealConflicts, generateMealPlans, rankMealCandidates } from '../src/index.ts';

const text = value => ({ 'zh-CN': value });
const requirement = (id, options = {}) => ({ requirement_id: `req_${id}`, ingredient_id: id,
  importance: 'required', role: 'main', consumes: true, quantity: { value: 10, unit: 'g' }, ...options });
const recipe = (id, course, ingredients = [id], extras = {}) => ({ recipe_id: id, dish_id: id,
  name: text(id), course, cooking_method: 'stir_fry', time_minutes: 10, spicy_level: 0,
  equipment_slots: [], requirements: ingredients.map(id => requirement(id)), steps: ingredients.map(id => ({
    step_id: `step_${id}`, text: text(`使用 ${id}`), requirement_ids: [`req_${id}`],
  })), substitution_overrides: [], review_state: 'pending_review', ...extras });
const evaluation = (item, extras = {}) => ({ recipe_id: item.recipe_id, dish_id: item.dish_id, tier: 'ready',
  requirements: item.requirements.map(requirement => ({ requirement_id: requirement.requirement_id,
    ingredient_id: requirement.ingredient_id, importance: requirement.importance, presence: 'present',
    match_kind: 'exact', omitted: false, used_ingredient_id: requirement.ingredient_id,
    reason_code: 'exact_match', reason_params: {} })), steps: [], plan_valid: true,
  missing_required_ingredient_ids: [], uncertain_requirement_ids: [], missing_equipment: [], uncertain_equipment: [],
  important_gap_count: 0, uncertain_required_count: 0, substitution_counts: { equivalent: 0, acceptable: 0, poor: 0 },
  used_inventory_item_ids: [], current_ingredient_count: item.requirements.length, time_minutes: item.time_minutes,
  buy_ingredient_ids: [], ...extras });
const catalogFor = recipes => ({ schema_version: '0.1.0', dataset_version: 'meal-test', release_state: 'draft',
  default_locale: 'zh-CN', ingredients: [...new Set(recipes.flatMap(item => item.requirements.map(value => value.ingredient_id)))].map(id => ({
    ingredient_id: id, names: text(id), aliases: {}, selectable: true, matching_parent_ids: [], implicit_staple: false,
    review_state: 'pending_review',
  })), dishes: [...new Set(recipes.map(item => item.dish_id))].map(dish_id => ({ dish_id })), recipes, substitution_rules: [] });
const optionsFor = (catalog, extras = {}) => ({ people: 2, burnerCount: 2,
  currentIngredientIds: catalog.ingredients.map(item => item.ingredient_id), ...extras });
function plansFor(recipes, options = {}, evaluations = recipes.map(item => evaluation(item))) {
  const catalog = catalogFor(recipes);
  const result = generateMealPlans(catalog, evaluations, optionsFor(catalog, options));
  assert.equal(result.error, null);
  return result.data;
}
const equipment = (name, minutes = 10, burners = 1) => [{ equipment: name, minutes, burner_slots: burners }];

test('should choose complete meal sizes and reject invalid people counts', () => {
  assert.ok(defaultMealPatterns(1).every(pattern => pattern.courses.length === 2));
  assert.deepEqual(new Set(defaultMealPatterns(3).map(pattern => pattern.courses.length)), new Set([3, 4]));
  assert.equal(defaultMealPatterns(12)[0].courses.length, 5);
  for (const people of [0, 13, 2.5, NaN, Infinity]) assert.deepEqual(defaultMealPatterns(people), []);
});

test('should allocate the actual substitution once and exclude omitted ingredients and seasonings', () => {
  const item = recipe('dish', 'veg', ['original', 'salt', 'garnish']);
  item.requirements[1].consumes = false;
  item.requirements.push(requirement('original', { requirement_id: 'req_second' }));
  const result = evaluation(item);
  result.requirements[0].used_ingredient_id = 'replacement';
  result.requirements[0].match_kind = 'substitution';
  result.requirements[2].omitted = true;
  result.requirements[3].used_ingredient_id = 'replacement';
  assert.deepEqual(consumedIngredientIds(item, result), ['replacement']);
  assert.deepEqual(consumedIngredientIds(item, { ...result, recipe_id: 'other' }), []);
});

test('should report every conflicting recipe and keep sharing exemptions local to each call', () => {
  const recipes = [recipe('a', 'meat', ['egg', 'onion']), recipe('b', 'veg', ['egg', 'onion']), recipe('c', 'soup', ['egg'])];
  const catalog = catalogFor(recipes);
  const evaluations = recipes.map(item => evaluation(item));
  const conflicts = [{ ingredient_id: 'egg', recipe_ids: ['a', 'b', 'c'] }, { ingredient_id: 'onion', recipe_ids: ['a', 'b'] }];
  assert.deepEqual(findMealConflicts(catalog, [...evaluations, evaluations[0]]), conflicts);
  assert.deepEqual(findMealConflicts(catalog, evaluations, ['egg']), [conflicts[1]]);
  assert.deepEqual(findMealConflicts(catalog, evaluations), conflicts);
});

test('should conservatively reserve unconfirmed actual ingredients in a manual basket', () => {
  const recipes = [recipe('a', 'meat', ['egg']), recipe('b', 'veg', ['egg'])];
  const evaluations = recipes.map(item => evaluation(item));
  evaluations[1].tier = 'needs_confirmation';
  evaluations[1].requirements[0].presence = 'uncertain';
  assert.equal(findMealConflicts(catalogFor(recipes), evaluations).length, 1);
});

test('should rank within tiers by conflicts then missing course without mutating recommendations', () => {
  const recipes = [recipe('selected', 'meat', ['egg']), recipe('conflict', 'veg', ['egg']),
    recipe('other_meat', 'meat'), recipe('needed_veg', 'veg'), recipe('caveat', 'veg')];
  const catalog = catalogFor(recipes);
  const evaluations = recipes.map(item => evaluation(item));
  evaluations[4].tier = 'caveat';
  const candidates = evaluations.slice(1);
  const before = structuredClone(candidates);
  assert.deepEqual(rankMealCandidates(catalog, candidates, [evaluations[0]], { people: 2 }).map(item => item.recipe_id),
    ['needed_veg', 'other_meat', 'conflict', 'caveat']);
  assert.deepEqual(candidates, before);
  assert.equal(rankMealCandidates(catalog, candidates, [evaluations[0]], { people: 2, sharedIngredientIds: ['egg'] })[0].recipe_id, 'conflict');
});

test('should return at most three complete deterministic combinations regardless of input order', () => {
  const recipes = [recipe('meat', 'meat'), ...['a', 'b', 'c', 'd'].map(id => recipe(id, 'veg'))];
  const first = plansFor(recipes);
  assert.equal(first.length, 3);
  assert.deepEqual(first.map(plan => plan.recipe_ids), [['a', 'meat'], ['b', 'meat'], ['c', 'meat']]);
  assert.deepEqual(plansFor([...recipes].reverse()), first);
  assert.ok(first.every(plan => plan.recipe_ids.length === plan.pattern.courses.length));
});

test('should not pretend a missing category or uncertain recipe completes a meal', () => {
  assert.deepEqual(plansFor([recipe('a', 'veg'), recipe('b', 'veg')]), []);
  const recipes = [recipe('meat', 'meat'), recipe('veg', 'veg'), recipe('soup', 'soup')];
  for (const tier of ['needs_confirmation', 'one_missing', 'insufficient']) {
    const evaluations = recipes.map(item => evaluation(item));
    evaluations[2].tier = tier;
    assert.deepEqual(plansFor(recipes, { people: 3 }, evaluations), []);
  }
  const invalid = recipes.map(item => evaluation(item));
  invalid[2].plan_valid = false;
  assert.deepEqual(plansFor(recipes, { people: 3 }, invalid), []);
});

test('should filter conflicts before filling a plan and allow only explicit shared ingredients', () => {
  const recipes = [recipe('meat', 'meat', ['egg']), recipe('veg', 'veg', ['egg']), recipe('soup', 'soup', ['water'])];
  assert.deepEqual(plansFor(recipes, { people: 3 }), []);
  assert.equal(plansFor(recipes, { people: 3, sharedIngredientIds: ['egg'] }).length, 1);
  assert.deepEqual(plansFor(recipes, { people: 3 }), []);
});

test('should detect a replacement colliding with an ingredient used directly by another dish', () => {
  const recipes = [recipe('meat', 'meat', ['original']), recipe('veg', 'veg', ['replacement'])];
  const evaluations = recipes.map(item => evaluation(item));
  evaluations[0].requirements[0].used_ingredient_id = 'replacement';
  evaluations[0].requirements[0].match_kind = 'substitution';
  assert.deepEqual(plansFor(recipes, {}, evaluations), []);
  const shared = plansFor(recipes, { sharedIngredientIds: ['replacement'] }, evaluations);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].current_ingredient_count, 1);
});

test('should let cold dishes fill vegetable slots without requiring a staple', () => {
  const recipes = [recipe('meat', 'meat'), recipe('cold', 'cold'), recipe('rice', 'staple')];
  const plans = plansFor(recipes);
  assert.deepEqual(plans[0].recipe_ids, ['cold', 'meat']);
  assert.equal(plans.some(plan => plan.recipe_ids.includes('rice')), false);
});

test('should deduplicate variants and preserve a fixed variant outside the top fifteen', () => {
  const meat = recipe('fixed_meat', 'meat', ['meat'], { time_minutes: 50 });
  const recipes = [meat, recipe('fast_meat', 'meat', ['meat'], { dish_id: 'fixed_meat' }),
    ...Array.from({ length: 16 }, (_, index) => recipe(`meat_${index}`, 'meat')), recipe('veg', 'veg')];
  const plans = plansFor(recipes, { fixedRecipeIds: ['fixed_meat'] });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].recipe_ids, ['fixed_meat', 'veg']);
  assert.equal(plansFor(recipes).some(plan => plan.recipe_ids.includes('fixed_meat')), false);
  const duplicateFixed = plansFor(recipes, { fixedRecipeIds: ['fixed_meat', 'fixed_meat'] });
  assert.deepEqual(duplicateFixed, plans);
});

test('should estimate resource contention for shared cookware and limited burners', () => {
  const recipes = [recipe('wok', 'meat', [], { time_minutes: 12, equipment_slots: equipment('wok') }),
    recipe('soup', 'soup', [], { time_minutes: 12, equipment_slots: equipment('pot') }),
    recipe('other_wok', 'veg', [], { time_minutes: 12, equipment_slots: equipment('wok') }),
    recipe('oven', 'veg', [], { time_minutes: 12, equipment_slots: equipment('oven', 12, 0) })];
  const catalog = catalogFor(recipes);
  assert.equal(estimateMealMinutes(catalog, ['wok', 'soup'], 1), 20);
  assert.equal(estimateMealMinutes(catalog, ['wok', 'soup'], 2), 12);
  assert.equal(estimateMealMinutes(catalog, ['wok', 'other_wok'], 2), 20);
  assert.equal(estimateMealMinutes(catalog, ['wok', 'oven'], 1), 12);
  assert.equal(estimateMealMinutes(catalog, ['wok', 'wok'], 1), 12);
  assert.equal(estimateMealMinutes(catalog, [], 1), 0);
  assert.equal(estimateMealMinutes(catalog, ['unknown'], 2), null);
  assert.equal(estimateMealMinutes(catalog, ['wok'], 0), null);
});

test('should reject a recipe requiring more simultaneous burners than the user has', () => {
  const recipes = [recipe('meat', 'meat', ['meat'], { equipment_slots: equipment('wok', 10, 2) }), recipe('veg', 'veg')];
  assert.equal(estimateMealMinutes(catalogFor(recipes), ['meat'], 1), null);
  assert.deepEqual(plansFor(recipes, { burnerCount: 1 }), []);
  assert.equal(plansFor(recipes, { burnerCount: 2 }).length, 1);
});

test('should prioritize ready meals before quicker meals with caveats', () => {
  const recipes = [recipe('meat', 'meat'), recipe('quick', 'veg'), recipe('slow', 'veg', ['slow'], { time_minutes: 30 })];
  const evaluations = recipes.map(item => evaluation(item));
  evaluations[1].tier = 'caveat';
  const plans = plansFor(recipes, {}, evaluations);
  assert.deepEqual(plans.map(plan => plan.caveat_count), [0, 1]);
  assert.deepEqual(plans[0].recipe_ids, ['meat', 'slow']);
});

test('should rank cookware parallelism then method variety then current ingredient use', () => {
  const recipes = [recipe('meat', 'meat', ['meat'], { equipment_slots: equipment('wok') }),
    recipe('stir', 'veg', ['stir'], { equipment_slots: equipment('wok') }),
    recipe('boil', 'veg', ['boil'], { cooking_method: 'boil', equipment_slots: equipment('pot') }),
    recipe('rich', 'veg', ['rich', 'extra'], { cooking_method: 'boil', equipment_slots: equipment('pot') })];
  assert.deepEqual(plansFor(recipes).map(plan => plan.recipe_ids.find(id => id !== 'meat')), ['rich', 'boil', 'stir']);
  const sameTime = recipes.map(item => ({ ...item, equipment_slots: [] }));
  assert.deepEqual(plansFor(sameTime).map(plan => plan.recipe_ids.find(id => id !== 'meat')), ['rich', 'boil', 'stir']);
});

test('should enforce top-fifteen candidate limits and generate complete five-dish plans', () => {
  const recipes = ['meat', 'veg', 'soup'].flatMap(course => Array.from({ length: 16 }, (_, index) =>
    recipe(`${course}_${String(index).padStart(2, '0')}`, course)));
  const plans = plansFor(recipes, { people: 5 });
  assert.equal(plans.length, 3);
  for (const plan of plans) {
    assert.equal(plan.recipe_ids.length, 5);
    assert.equal(plan.recipe_ids.some(id => id.endsWith('_15')), false);
    assert.equal(new Set(plan.recipe_ids).size, 5);
  }
  assert.deepEqual(plansFor([...recipes].reverse(), { people: 5 }), plans);
});

test('should return actionable errors for invalid settings, unknown ingredients and unusable fixed recipes', () => {
  const recipes = [recipe('meat', 'meat'), recipe('veg', 'veg')];
  const catalog = catalogFor(recipes);
  const evaluations = recipes.map(item => evaluation(item));
  for (const [override, code] of [[{ people: 0 }, 'meal.invalid_people'], [{ people: 13 }, 'meal.invalid_people'],
    [{ burnerCount: 0 }, 'meal.invalid_burners'], [{ burnerCount: 7 }, 'meal.invalid_burners'],
    [{ burnerCount: 1.5 }, 'meal.invalid_burners'], [{ currentIngredientIds: ['unknown'] }, 'meal.unknown_ingredient'],
    [{ sharedIngredientIds: ['unknown'] }, 'meal.unknown_ingredient'], [{ fixedRecipeIds: ['unknown'] }, 'meal.invalid_fixed_recipe']]) {
    const result = generateMealPlans(catalog, evaluations, optionsFor(catalog, override));
    assert.equal(result.data, null);
    assert.equal(result.error.code, code);
  }
});

test('should evaluate a selected variant independently of recommendation grouping and filters', () => {
  const recipes = [recipe('fast', 'meat', ['meat']), recipe('slow', 'meat', ['meat'], { dish_id: 'fast', time_minutes: 30 })];
  const created = createEngine(catalogFor(recipes), { allowDraft: true });
  assert.equal(created.error, null);
  const input = { inventory: { items: [{ item_id: 'stock', ingredient_id: 'meat', location: 'current' }] } };
  const recommended = created.data.recommend(input);
  assert.equal(recommended.error, null);
  assert.deepEqual(recommended.data.dishes.map(item => item.recipe_id), ['fast']);
  const selected = created.data.evaluateRecipe('slow', { ...input, filters: { courses: ['veg'], max_time_minutes: 15 } });
  assert.equal(selected.error, null);
  assert.equal(selected.data.recipe_id, 'slow');
  assert.equal(selected.data.tier, 'ready');
  const missing = created.data.evaluateRecipe('slow', { inventory: { items: [] } });
  assert.equal(missing.data.tier, 'one_missing');
  assert.deepEqual(missing.data.missing_required_ingredient_ids, ['meat']);
  assert.deepEqual(missing.data.buy_ingredient_ids, ['meat']);
});

test('should validate selected-recipe inputs and reject unknown recipe identities', () => {
  const engine = createEngine(catalogFor([recipe('dish', 'meat')]), { allowDraft: true }).data;
  for (const id of ['missing', null, {}, 12]) {
    const result = engine.evaluateRecipe(id, { inventory: { items: [] } });
    assert.equal(result.data, null);
    assert.equal(result.error.code, 'input.unknown_recipe');
  }
  assert.equal(engine.evaluateRecipe('dish', null).error.code, 'input.invalid');
  assert.equal(engine.evaluateRecipe('dish', { inventory: { items: [{ item_id: 'x', ingredient_id: 'unknown', location: 'current' }] } }).error.code,
    'input.invalid');
});
