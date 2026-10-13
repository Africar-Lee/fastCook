const sourceIds = ['stage1_editorial_draft'];
const text = value => ({ 'zh-CN': value });

function requirement(ingredientId, options = {}) {
  const requirementId = options.id ?? `req_${ingredientId}`;
  const importance = options.importance ?? 'required';
  return {
    requirement_id: requirementId,
    ingredient_id: ingredientId,
    role: options.role ?? 'main',
    importance,
    consumes: options.consumes ?? true,
    quantity: { value: 10, unit: options.unit ?? 'g' },
    ...(importance === 'required' ? {} : {
      omission: { note: text('省略此原料。'), step_changes: [{ step_id: `step_${requirementId}`, action: 'skip' }] },
    }),
  };
}

function recipe(requirements, options = {}) {
  return {
    recipe_id: options.id ?? 'fixture_recipe',
    dish_id: options.dish ?? 'fixture_dish',
    name: text('算法测试用菜谱'),
    variant: text('测试结构，不用于烹饪'),
    original_locale: 'zh-CN',
    course: options.course ?? 'veg',
    cooking_method: options.method ?? 'stir_fry',
    servings: 1,
    time_minutes: options.time ?? 10,
    spicy_level: options.spicy ?? 0,
    equipment_slots: options.equipment ?? [],
    requirements,
    steps: requirements.map(item => ({
      step_id: `step_${item.requirement_id}`,
      text: text(`使用测试原料 ${item.ingredient_id}。`),
      requirement_ids: [item.requirement_id],
    })),
    substitution_overrides: options.overrides ?? [],
    source_ids: sourceIds,
    review_state: 'pending_review',
  };
}

function rule(target, substitute, options = {}) {
  return {
    rule_id: options.id ?? 'fixture_substitute',
    scope: options.recipe ? 'recipe' : 'global',
    ...(options.recipe ? { recipe_id: options.recipe } : {}),
    required_ingredient_id: target,
    substitute_ingredient_id: substitute,
    level: options.level ?? 'acceptable',
    conditions: {
      cooking_methods: options.methods ?? ['stir_fry'],
      requires_available_ingredient_ids: options.requires ?? [],
      requires_confirmation: options.confirmation ?? false,
    },
    ...(options.noRatio ? {} : { quantity_ratio: { required_unit: 'g', substitute_unit: 'g', factor: options.factor ?? 1 } }),
    usage_note: text('测试替代说明，需要按显示用量核对。'),
    step_policy: options.changes ? 'recipe_step_changes_required' : 'ingredient_replacement_only',
    source_ids: sourceIds,
    review_state: 'pending_review',
  };
}

function allow(requirementId = 'req_corn_starch', ruleId = 'fixture_substitute', changes = []) {
  return { requirement_id: requirementId, rule_id: ruleId, action: 'allow', note: text('允许测试替代。'), step_changes: changes };
}

function ingredientFixture(name) {
  if (name.startsWith('single_')) return { recipes: [recipe([requirement(name.slice(7))])] };
  if (name === 'alias_normalization') return { recipes: [recipe([requirement('tomato')])] };
  if (name === 'reverse') return { recipes: [recipe([requirement('potato_starch')])],
    rules: [rule('corn_starch', 'potato_starch')] };
  if (name === 'duplicate_requirements') return { recipes: [recipe([
    requirement('corn_starch', { id: 'req_batter' }), requirement('corn_starch', { id: 'req_sauce' }),
  ])], rules: [rule('corn_starch', 'potato_starch')] };
  if (name === 'current_coverage') return { recipes: [recipe([
    requirement('tomato'), requirement('tomato', { id: 'req_tomato_again' }),
    requirement('salt', { consumes: false }),
  ])] };
  if (name === 'pantry_only') return { recipes: [recipe([requirement('sugar', { consumes: false })])] };
  if (name === 'important' || name === 'optional' || name === 'important_generic') {
    return { recipes: [recipe([requirement('tomato'), requirement(name === 'important_generic' ? 'light_soy_sauce' : 'corn_starch', {
      importance: name === 'optional' ? 'optional' : 'important',
    })])], rules: name === 'important_generic' ? [] : [rule('corn_starch', 'potato_starch')] };
  }
}

function substitutionFixture(name) {
  const starch = () => recipe([requirement('corn_starch')]);
  if (['equivalent', 'acceptable', 'poor', 'poor_allowed', 'confirm', 'confirm_no_ratio', 'confirm_other_requirement', 'wrong_method', 'range_quantity'].includes(name)) {
    const target = starch();
    if (name === 'confirm_other_requirement') {
      const additional = requirement('tomato');
      target.requirements.push(additional);
      target.steps.push(...recipe([additional]).steps);
    }
    if (name === 'poor_allowed') target.substitution_overrides = [allow()];
    if (name === 'range_quantity') target.requirements[0].quantity = { min: 5, max: 10, unit: 'g' };
    return { recipes: [target], rules: [rule('corn_starch', 'potato_starch', {
      level: name === 'equivalent' ? 'equivalent' : name.startsWith('poor') ? 'poor' : 'acceptable',
      confirmation: name.startsWith('confirm'),
      noRatio: name === 'confirm_no_ratio',
      methods: name === 'wrong_method' ? ['steam'] : ['stir_fry'],
      factor: name === 'range_quantity' ? 2 : 1,
    })] };
  }
  if (name === 'chained') return { recipes: [starch()], rules: [
    rule('corn_starch', 'potato_starch'), rule('potato_starch', 'sugar', { id: 'fixture_second_hop' }),
  ] };
  if (name === 'forbidden_pair') {
    const target = starch();
    target.substitution_overrides = [{ requirement_id: 'req_corn_starch', rule_id: 'fixture_forbidden', action: 'forbid', note: text('禁止这对原料替代。') }];
    return { recipes: [target], rules: [rule('corn_starch', 'potato_starch', { id: 'fixture_forbidden' }),
      rule('corn_starch', 'potato_starch', { methods: [], id: 'fixture_alternate_id' })] };
  }
  if (name === 'alternative_rule') return { recipes: [starch()], rules: [
    rule('corn_starch', 'potato_starch', { id: 'fixture_a_confirmation', confirmation: true }),
    rule('corn_starch', 'sugar', { id: 'fixture_b_definite' }),
  ] };
  if (name === 'generic_with_definite_substitute') return { recipes: [recipe([requirement('chicken_breast')])],
    rules: [rule('chicken_breast', 'chicken_thigh')] };
}

function conditionFixture(name) {
  if (!name.startsWith('condition')) return;
  const condition = name === 'condition_omitted' ? 'sugar' : 'light_soy_sauce';
  return { recipes: [recipe([requirement('corn_starch'), requirement(condition, { importance: 'important' })])],
    rules: [rule('corn_starch', 'potato_starch', { requires: [condition] }),
      ...(name === 'condition_substituted' ? [rule('light_soy_sauce', 'dark_soy_sauce', { id: 'fixture_condition_substitute' })] : [])] };
}

function aggregationFixture(name) {
  if (name === 'variants' || name === 'variant_tie' || name === 'purchase_aggregation') {
    const time = name === 'variant_tie' ? 10 : 20;
    return { recipes: [
      recipe([requirement('tomato')], { id: 'fixture_a', dish: 'dish_a', time, spicy: 2 }),
      recipe([requirement('egg')], { id: 'fixture_b', dish: 'dish_a', time: 10, course: 'soup' }),
      ...(name === 'purchase_aggregation' ? [recipe([requirement('egg')], { id: 'fixture_c', dish: 'dish_b' })] : []),
    ] };
  }
  if (name === 'ranking') return { recipes: [
    recipe([requirement('tomato')], { id: 'fixture_a', dish: 'dish_a', time: 5 }),
    recipe([requirement('egg'), requirement('tomato')], { id: 'fixture_b', dish: 'dish_b', time: 20 }),
    recipe([requirement('sugar')], { id: 'fixture_c', dish: 'dish_c', time: 1 }),
  ] };
  if (name === 'ranking_tiers') return { recipes: [
    recipe([requirement('tomato'), requirement('garlic', { importance: 'important' })], { id: 'fixture_a', dish: 'dish_a', time: 1 }),
    recipe([requirement('egg')], { id: 'fixture_b', dish: 'dish_b', time: 20 }),
  ] };
  if (name === 'ranking_important_gaps') return { recipes: [
    recipe([requirement('tomato'), requirement('garlic', { importance: 'important' }), requirement('corn_starch', { importance: 'important' })], { id: 'fixture_a', dish: 'dish_a', time: 1 }),
    recipe([requirement('egg'), requirement('garlic', { importance: 'important' })], { id: 'fixture_b', dish: 'dish_b', time: 20 }),
  ] };
}

function conflictingFixture(name) {
  if (name !== 'conflicting_steps') return;
  const target = recipe([requirement('corn_starch'), requirement('tomato')]);
  target.steps = [{ step_id: 'step_both', text: text('同时使用两种原料。'), requirement_ids: ['req_corn_starch', 'req_tomato'] }];
  target.substitution_overrides = [
    allow('req_corn_starch', 'fixture_substitute', [{ step_id: 'step_both', action: 'replace', text: text('第一种步骤改写。'), requirement_ids: ['req_corn_starch', 'req_tomato'] }]),
    allow('req_tomato', 'fixture_other', [{ step_id: 'step_both', action: 'replace', text: text('第二种冲突改写。'), requirement_ids: ['req_corn_starch', 'req_tomato'] }]),
  ];
  return { recipes: [target], rules: [rule('corn_starch', 'potato_starch', { recipe: 'fixture_recipe', changes: true }),
    rule('tomato', 'egg', { id: 'fixture_other', recipe: 'fixture_recipe', changes: true })] };
}

function makeFixture(name) {
  for (const factory of [ingredientFixture, substitutionFixture, conditionFixture, aggregationFixture, conflictingFixture]) {
    const fixture = factory(name);
    if (fixture) return fixture;
  }
  throw new Error(`Unknown golden fixture: ${name}`);
}

export function fixtureCatalog(base, name) {
  const catalog = structuredClone(base);
  if (!name) return catalog;
  const fixture = makeFixture(name);
  catalog.dataset_version = `${base.dataset_version}-golden-${name}`;
  catalog.recipes = fixture.recipes;
  catalog.dishes = [...new Set(fixture.recipes.map(item => item.dish_id))]
    .map(dishId => ({ dish_id: dishId, names: text('算法测试用菜肴') }));
  catalog.substitution_rules = fixture.rules ?? [];
  if (name === 'alias_normalization') {
    catalog.ingredients.find(item => item.ingredient_id === 'tomato').aliases.en = [
      { text: 'Test Tomato', resolution: 'automatic' },
    ];
  }
  return catalog;
}

export function goldenInput(scenario) {
  const input = {
    inventory: {
      items: [
        ...(scenario.current ?? []).map((id, index) => ({ item_id: `current_${index}_${id}`, ingredient_id: id, location: 'current' })),
        ...(scenario.pantry ?? []).map((id, index) => ({ item_id: `pantry_${index}_${id}`, ingredient_id: id, location: 'pantry' })),
      ],
      ...(scenario.unavailable ? { unavailable_ingredient_ids: scenario.unavailable } : {}),
      ...(scenario.implicit === undefined ? {} : { use_implicit_staples: scenario.implicit }),
      ...(scenario.equipment === null ? {} : { equipment: scenario.equipment ?? {
        available: ['wok', 'frying_pan', 'pot', 'steamer'], unavailable: [],
      } }),
    },
    ...(scenario.filters ? { filters: scenario.filters } : {}),
  };
  return input;
}
