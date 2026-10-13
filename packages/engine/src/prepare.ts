import type {
  Catalog, EngineError, Ingredient, PreparedCatalog, Recipe, Requirement, Result,
  StepChange, SubstitutionRule,
} from './types.ts';

type PrepareOptions = Readonly<{ allowDraft?: boolean; maxPlanCombinations?: number }>;

function error(code: string, path: string, message: string): EngineError {
  return { code, path, message };
}

function cloneAndFreeze(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));
  if (value === null || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAndFreeze(child)])));
}

function immutableMap<Key, Value>(entries: Iterable<readonly [Key, Value]>): ReadonlyMap<Key, Value> {
  const map = new Map(entries);
  const view: ReadonlyMap<Key, Value> = {
    size: map.size,
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    [Symbol.iterator]: () => map[Symbol.iterator](),
    forEach: (callback, thisArg) => map.forEach((value, key) => callback.call(thisArg, value, key, view)),
  };
  return Object.freeze(view);
}

function immutableSet<Value>(values: Iterable<Value>): ReadonlySet<Value> {
  const set = new Set(values);
  const view: ReadonlySet<Value> = {
    size: set.size,
    has: (value) => set.has(value),
    keys: () => set.keys(),
    values: () => set.values(),
    entries: () => set.entries(),
    [Symbol.iterator]: () => set[Symbol.iterator](),
    forEach: (callback, thisArg) => set.forEach((value) => callback.call(thisArg, value, value, view)),
  };
  return Object.freeze(view);
}

function duplicateId(ids: readonly string[], path: string): EngineError | null {
  return new Set(ids).size === ids.length ? null : error('catalog.duplicate_id', path, '数据 ID 重复，请重新校验数据包。');
}

function reviewError(catalog: Catalog, allowDraft: boolean): EngineError | null {
  const entities = [...catalog.ingredients, ...catalog.recipes, ...catalog.substitution_rules];
  if (entities.some((entity) => entity.review_state === 'rejected')) {
    return error('catalog.rejected', '/', '数据包包含审核未通过的内容，请修正后重新构建。');
  }
  if (allowDraft && catalog.release_state === 'draft') return null;
  if (catalog.release_state !== 'published' || entities.some((entity) => entity.review_state !== 'reviewed')) {
    return error('catalog.review_required', '/', '推荐需要已发布且审核通过的数据包；开发草稿须显式开启 allowDraft。');
  }
  return null;
}

function validateIdentity(catalog: Catalog): EngineError | null {
  const collections: readonly [readonly string[], string][] = [
    [catalog.ingredients.map((item) => item.ingredient_id), '/ingredients'],
    [catalog.dishes.map((item) => item.dish_id), '/dishes'],
    [catalog.recipes.map((item) => item.recipe_id), '/recipes'],
    [catalog.substitution_rules.map((item) => item.rule_id), '/substitution_rules'],
  ];
  for (const [ids, path] of collections) {
    const duplicate = duplicateId(ids, path);
    if (duplicate) return duplicate;
  }
  return null;
}

function prepareAncestors(ingredients: ReadonlyMap<string, Ingredient>): Result<ReadonlyMap<string, ReadonlySet<string>>> {
  const ancestors = new Map<string, Set<string>>();
  const remaining = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const [id, ingredient] of ingredients) {
    ancestors.set(id, new Set());
    remaining.set(id, ingredient.matching_parent_ids.length);
    if (new Set(ingredient.matching_parent_ids).size !== ingredient.matching_parent_ids.length) {
      return { data: null, error: error('catalog.duplicate_edge', `/ingredients/${id}`, '原料匹配关系重复，请修正匹配图。') };
    }
    for (const parent of ingredient.matching_parent_ids) {
      if (!ingredients.has(parent)) return { data: null, error: error('catalog.missing_reference', `/ingredients/${id}`, `匹配上级 ${parent} 不存在。`) };
      const dependents = children.get(parent) ?? [];
      dependents.push(id);
      children.set(parent, dependents);
    }
  }
  const pending = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < pending.length; index += 1) {
    const parent = pending[index]!;
    for (const child of children.get(parent) ?? []) {
      ancestors.get(child)!.add(parent);
      for (const ancestor of ancestors.get(parent)!) ancestors.get(child)!.add(ancestor);
      remaining.set(child, remaining.get(child)! - 1);
      if (remaining.get(child) === 0) pending.push(child);
    }
  }
  if (pending.length !== ingredients.size) return { data: null, error: error('catalog.matching_cycle', '/ingredients', '原料匹配关系存在循环，请修正匹配图。') };
  return { data: immutableMap([...ancestors].map(([id, values]) => [id, immutableSet(values)])), error: null };
}

function validateRuleReferences(catalog: Catalog, ingredients: ReadonlyMap<string, Ingredient>): EngineError | null {
  const recipes = new Map(catalog.recipes.map((recipe) => [recipe.recipe_id, recipe]));
  for (const rule of catalog.substitution_rules) {
    const path = `/substitution_rules/${rule.rule_id}`;
    const ids = [rule.required_ingredient_id, rule.substitute_ingredient_id, ...rule.conditions.requires_available_ingredient_ids];
    if (ids.some((id) => !ingredients.has(id))) return error('catalog.missing_reference', path, '替代规则引用了不存在的原料。');
    if (rule.required_ingredient_id === rule.substitute_ingredient_id) return error('catalog.rule_endpoint', path, '替代规则的原料和替代品必须不同。');
    if (rule.scope === 'global' && rule.recipe_id !== undefined) return error('catalog.rule_scope', path, '全局替代规则不能绑定某道菜谱。');
    if (rule.scope !== 'global' && rule.scope !== 'recipe') return error('catalog.rule_scope', path, '替代规则作用域无效。');
    if (rule.scope !== 'recipe') continue;
    const recipe = rule.recipe_id ? recipes.get(rule.recipe_id) : undefined;
    if (!recipe) return error('catalog.missing_reference', path, '菜谱级替代规则缺少有效的所属菜谱。');
    if (!recipe.substitution_overrides.some((override) => override.rule_id === rule.rule_id && override.action === 'allow')) {
      return error('catalog.recipe_allow_missing', path, '菜谱级替代规则需要所属菜谱显式允许。');
    }
  }
  return null;
}

function validateChanges(changes: readonly StepChange[], recipe: Recipe, path: string): EngineError | null {
  const steps = new Set(recipe.steps.map((step) => step.step_id));
  const requirements = new Set(recipe.requirements.map((requirement) => requirement.requirement_id));
  for (const change of changes) {
    if (!steps.has(change.step_id)) return error('catalog.missing_reference', path, '步骤修改引用了不存在的步骤。');
    if (change.action === 'replace' && change.requirement_ids.some((id) => !requirements.has(id))) {
      return error('catalog.missing_reference', path, '步骤修改引用了本菜谱之外的配料需求。');
    }
  }
  return null;
}

function validateOverrides(recipe: Recipe, rules: ReadonlyMap<string, SubstitutionRule>): EngineError | null {
  const seen = new Set<string>();
  for (const override of recipe.substitution_overrides) {
    const path = `/recipes/${recipe.recipe_id}/substitution_overrides`;
    const requirement = recipe.requirements.find((item) => item.requirement_id === override.requirement_id);
    const rule = rules.get(override.rule_id);
    if (!requirement || !rule) return error('catalog.missing_reference', path, '替代覆盖引用了不存在的规则或配料需求。');
    if (rule.scope === 'recipe' && rule.recipe_id !== recipe.recipe_id) return error('catalog.rule_scope', path, '替代覆盖引用了其他菜谱的专用规则。');
    if (requirement.ingredient_id !== rule.required_ingredient_id) return error('catalog.rule_target', path, '替代规则目标与菜谱需求不一致。');
    if (override.action !== 'allow' && override.action !== 'forbid') return error('catalog.override_action', path, '替代覆盖的动作无效。');
    const key = `${override.requirement_id}/${override.rule_id}`;
    if (seen.has(key)) return error('catalog.duplicate_override', path, '同一需求和规则存在重复覆盖。');
    seen.add(key);
    if (override.action === 'forbid') {
      if (override.step_changes !== undefined) return error('catalog.forbid_steps', path, '禁止替代的规则不能修改烹饪步骤。');
      continue;
    }
    if ((rule.step_policy === 'recipe_step_changes_required') !== Boolean(override.step_changes?.length)) {
      return error('catalog.step_policy', path, '替代规则的步骤修改与 step_policy 不一致。');
    }
    if (rule.conditions.cooking_methods.length > 0 && !rule.conditions.cooking_methods.includes(recipe.cooking_method)) {
      return error('catalog.rule_method', path, '显式允许的替代规则不适用于菜谱烹饪方法。');
    }
    const changesError = validateChanges(override.step_changes ?? [], recipe, path);
    if (changesError) return changesError;
  }
  return null;
}

function validateRecipeReferences(catalog: Catalog, ingredients: ReadonlyMap<string, Ingredient>): EngineError | null {
  const dishes = new Set(catalog.dishes.map((dish) => dish.dish_id));
  const rules = new Map(catalog.substitution_rules.map((rule) => [rule.rule_id, rule]));
  for (const recipe of catalog.recipes) {
    const path = `/recipes/${recipe.recipe_id}`;
    if (!dishes.has(recipe.dish_id)) return error('catalog.missing_reference', path, '菜谱引用了不存在的菜品。');
    const duplicate = duplicateId(recipe.requirements.map((item) => item.requirement_id), `${path}/requirements`)
      ?? duplicateId(recipe.steps.map((item) => item.step_id), `${path}/steps`);
    if (duplicate) return duplicate;
    const requirementIds = new Set(recipe.requirements.map((item) => item.requirement_id));
    for (const requirement of recipe.requirements) {
      if (!ingredients.has(requirement.ingredient_id)) return error('catalog.missing_reference', path, '菜谱需求引用了不存在的原料。');
      if (requirement.importance !== 'required' && !requirement.omission) return error('catalog.omission_missing', path, '可省略配料缺少省略说明和步骤处理。');
      if (requirement.importance === 'required' && requirement.omission) return error('catalog.required_omission', path, '必要配料不能定义省略方案。');
      const changesError = validateChanges(requirement.omission?.step_changes ?? [], recipe, path);
      if (changesError) return changesError;
    }
    if (recipe.steps.some((step) => step.requirement_ids.some((id) => !requirementIds.has(id)))) return error('catalog.missing_reference', path, '烹饪步骤引用了不存在的配料需求。');
    const overrideError = validateOverrides(recipe, rules);
    if (overrideError) return overrideError;
  }
  return null;
}

export function rulesForRequirement(prepared: PreparedCatalog, recipe: Recipe, requirement: Requirement): readonly SubstitutionRule[] {
  const candidates = prepared.rulesByTarget.get(requirement.ingredient_id) ?? [];
  const overrides = recipe.substitution_overrides.filter((override) => override.requirement_id === requirement.requirement_id);
  const forbidden = new Set(overrides.filter((override) => override.action === 'forbid')
    .flatMap((override) => candidates.filter((rule) => rule.rule_id === override.rule_id).map((rule) => rule.substitute_ingredient_id)));
  return candidates.filter((rule) => {
    if (forbidden.has(rule.substitute_ingredient_id)) return false;
    if (rule.conditions.cooking_methods.length > 0 && !rule.conditions.cooking_methods.includes(recipe.cooking_method)) return false;
    if (rule.scope === 'recipe' && rule.recipe_id !== recipe.recipe_id) return false;
    const needsAllow = rule.scope === 'recipe' || rule.level === 'poor' || rule.step_policy === 'recipe_step_changes_required';
    return !needsAllow || overrides.some((override) => override.rule_id === rule.rule_id && override.action === 'allow');
  });
}

function validateActiveRule(rule: SubstitutionRule, recipe: Recipe, requirement: Requirement): EngineError | null {
  const path = `/recipes/${recipe.recipe_id}/requirements/${requirement.requirement_id}`;
  const listed = new Set(recipe.requirements.map((item) => item.ingredient_id));
  if (rule.conditions.requires_available_ingredient_ids.some((id) => !listed.has(id))) {
    return error('catalog.unlisted_condition', path, '替代条件含未在本菜谱列明用量的配料，请修正规则。');
  }
  if (rule.quantity_ratio?.required_unit !== requirement.quantity.unit && !rule.conditions.requires_confirmation) {
    return error('catalog.quantity_confirmation', path, '替代缺少适用单位的用量比例，必须要求确认用量说明。');
  }
  return null;
}

function validateCombinationBudget(prepared: PreparedCatalog, maximum: number): EngineError | null {
  const witnessCounts = new Map<string, number>();
  for (const [id, ancestors] of prepared.ancestors) {
    for (const target of [id, ...ancestors]) witnessCounts.set(target, (witnessCounts.get(target) ?? 0) + 1);
  }
  for (const recipe of prepared.catalog.recipes) {
    let combinations = 1;
    for (const requirement of recipe.requirements) {
      const rules = rulesForRequirement(prepared, recipe, requirement);
      for (const rule of rules) {
        const ruleError = validateActiveRule(rule, recipe, requirement);
        if (ruleError) return ruleError;
      }
      const directCount = witnessCounts.get(requirement.ingredient_id) ?? 1;
      const substituteCount = rules.reduce((count, rule) => count + (witnessCounts.get(rule.substitute_ingredient_id) ?? 1), 0);
      // Generic uncertainty occupies an absent direct witness slot; omission adds one alternative.
      combinations *= directCount + substituteCount + Number(requirement.importance !== 'required');
      if (combinations > maximum) return error('catalog.plan_budget', `/recipes/${recipe.recipe_id}`, `菜谱候选组合上界超过 ${maximum}，请拆分做法或简化替代规则。`);
    }
  }
  return null;
}

export function prepareCatalog(catalog: Catalog, options: PrepareOptions = {}): Result<PreparedCatalog> {
  const maximum = options.maxPlanCombinations ?? 4096;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 65536) return { data: null, error: error('catalog.invalid_budget', '/options/maxPlanCombinations', '组合预算须为 1 至 65536 的整数。') };
  if (catalog.schema_version !== '0.1.0') return { data: null, error: error('catalog.schema_version', '/schema_version', '数据协议版本不受支持，请使用 0.1.0 数据包。') };
  const identityError = validateIdentity(catalog) ?? reviewError(catalog, options.allowDraft === true);
  if (identityError) return { data: null, error: identityError };
  const copied = cloneAndFreeze(catalog) as Catalog;
  const ingredients = immutableMap(copied.ingredients.map((ingredient) => [ingredient.ingredient_id, ingredient] as const));
  const ancestry = prepareAncestors(ingredients);
  if (ancestry.error) return ancestry;
  const referenceError = validateRuleReferences(copied, ingredients) ?? validateRecipeReferences(copied, ingredients);
  if (referenceError) return { data: null, error: referenceError };
  const rules = new Map<string, SubstitutionRule[]>();
  for (const rule of [...copied.substitution_rules].sort((left, right) => left.rule_id < right.rule_id ? -1 : Number(left.rule_id > right.rule_id))) {
    const group = rules.get(rule.required_ingredient_id) ?? [];
    group.push(rule);
    rules.set(rule.required_ingredient_id, group);
  }
  const prepared = Object.freeze({ catalog: copied, ingredients, ancestors: ancestry.data,
    rulesByTarget: immutableMap([...rules].map(([id, group]) => [id, Object.freeze(group)] as const)) });
  const budgetError = validateCombinationBudget(prepared, maximum);
  return budgetError ? { data: null, error: budgetError } : { data: prepared, error: null };
}
