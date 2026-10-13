import { entityTypes, fingerprint } from './catalog-fingerprints.mjs';
import { validateRecipeSteps, validateStepChanges } from './catalog-steps.mjs';

function uniqueIds(records, field, path, error) {
  const seen = new Set();
  records.forEach((record, index) => {
    if (seen.has(record[field])) error('id.duplicate', `${path}/${index}/${field}`, `ID ${record[field]} 重复。`);
    seen.add(record[field]);
  });
}

export function validateIds(context) {
  const { catalog, error } = context;
  for (const [, collection, field] of entityTypes) uniqueIds(catalog[collection], field, `/${collection}`, error);
  uniqueIds(catalog.reviews, 'review_id', '/reviews', error);
  catalog.recipes.forEach((recipe, index) => {
    uniqueIds(recipe.requirements, 'requirement_id', `/recipes/${index}/requirements`, error);
    uniqueIds(recipe.steps, 'step_id', `/recipes/${index}/steps`, error);
  });
}

const localizedFields = new Set(['names', 'name', 'variant', 'text', 'note', 'usage_note',
  'preparation', 'attribution', 'notes', 'evidence']);

function checkLocalized(value, path, fallbackLocales, error) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => checkLocalized(child, `${path}/${index}`, fallbackLocales, error));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    if (localizedFields.has(key) && typeof child === 'object') {
      if (!fallbackLocales.some(locale => child[locale]?.trim())) {
        error('locale.fallback_missing', childPath, `缺少回退语言 ${fallbackLocales.join(' 或 ')} 的非空文本。`);
      }
      for (const [locale, text] of Object.entries(child)) {
        if (!text.trim()) error('locale.blank_text', `${childPath}/${locale}`, '本地化文本不能只包含空白。');
      }
    } else checkLocalized(child, childPath, fallbackLocales, error);
  }
}

export function validateLocales({ catalog, error }) {
  for (const [key, value] of Object.entries(catalog)) {
    if (key === 'recipes') continue;
    if (key === 'notes') checkLocalized({ notes: value }, '', [catalog.default_locale], error);
    else checkLocalized(value, `/${key}`, [catalog.default_locale], error);
  }
  catalog.recipes.forEach((recipe, index) => checkLocalized(recipe, `/recipes/${index}`,
    [recipe.original_locale, catalog.default_locale], error));
}

function normalizedName(text) {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function validateAliases({ catalog, error }) {
  const lookup = new Map();
  function add(text, locale, ingredientId, resolution, path) {
    const normalized = normalizedName(text);
    if (!normalized) error('alias.blank', path, '原料名称或别名不能只包含空白。');
    const key = `${locale.toLowerCase()}/${normalized}`;
    const candidates = lookup.get(key) ?? [];
    candidates.push({ ingredientId, resolution, path });
    lookup.set(key, candidates);
  }
  catalog.ingredients.forEach((ingredient, index) => {
    for (const [locale, name] of Object.entries(ingredient.names)) {
      add(name, locale, ingredient.ingredient_id, 'automatic', `/ingredients/${index}/names/${locale}`);
    }
    for (const [locale, aliases] of Object.entries(ingredient.aliases)) {
      aliases.forEach((alias, aliasIndex) => add(alias.text, locale, ingredient.ingredient_id,
        alias.resolution, `/ingredients/${index}/aliases/${locale}/${aliasIndex}`));
    }
  });
  for (const candidates of lookup.values()) {
    if (new Set(candidates.map(candidate => candidate.ingredientId)).size < 2) continue;
    if (candidates.some(candidate => candidate.resolution === 'automatic')) {
      error('alias.ambiguous_automatic', candidates[0].path, '归一化名称指向多个原料，所有候选必须要求用户确认；标准名称不能重名。');
    }
  }
}

function checkGraph(context, field) {
  const { catalog, error, reference } = context;
  const edges = new Map(catalog.ingredients.map(ingredient => [ingredient.ingredient_id, []]));
  const indegree = new Map(catalog.ingredients.map(ingredient => [ingredient.ingredient_id, 0]));
  catalog.ingredients.forEach((ingredient, index) => {
    const parents = field === 'taxonomy_parent_id' ? [ingredient[field]].filter(Boolean) : ingredient[field];
    parents.forEach((parentId, parentIndex) => {
      const path = `/ingredients/${index}/${field}${field === 'matching_parent_ids' ? `/${parentIndex}` : ''}`;
      if (!reference('ingredient', parentId, path)) return;
      edges.get(ingredient.ingredient_id).push(parentId);
      indegree.set(parentId, indegree.get(parentId) + 1);
    });
  });
  const pending = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let processed = 0;
  while (pending.length > 0) {
    const id = pending.pop();
    processed += 1;
    for (const parentId of edges.get(id)) {
      indegree.set(parentId, indegree.get(parentId) - 1);
      if (indegree.get(parentId) === 0) pending.push(parentId);
    }
  }
  if (processed !== edges.size) error('graph.cycle', '/ingredients', `${field} 存在循环关系。`);
}

export function validateReferences(context) {
  const { catalog, index, reference } = context;
  for (const { entity, path } of index.values()) {
    (entity.source_ids ?? []).forEach((id, sourceIndex) => reference('source', id, `${path}/source_ids/${sourceIndex}`));
  }
  checkGraph(context, 'taxonomy_parent_id');
  checkGraph(context, 'matching_parent_ids');
  catalog.reviews.forEach((review, reviewIndex) =>
    reference(review.subject_type, review.subject_id, `/reviews/${reviewIndex}/subject_id`));
  catalog.pantry_templates.forEach((template, templateIndex) => template.ingredient_ids.forEach((id, ingredientIndex) => {
    const path = `/pantry_templates/${templateIndex}/ingredient_ids/${ingredientIndex}`;
    const ingredient = reference('ingredient', id, path);
    if (ingredient && (ingredient.implicit_staple || !ingredient.selectable)) {
      context.error('template.ineligible_ingredient', path, '调料柜模板只能包含可选择且非隐含常备的原料。');
    }
  }));
}

function validateConditions(rule, recipe, path, error) {
  const ingredients = new Set(recipe.requirements.map(requirement => requirement.ingredient_id));
  rule.conditions.requires_available_ingredient_ids.forEach((id, index) => {
    if (!ingredients.has(id)) error('rule.unlisted_condition', `${path}/conditions/requires_available_ingredient_ids/${index}`,
      `规则条件原料 ${id} 未在菜谱 ${recipe.recipe_id} 中列明用量和步骤。`);
  });
}

function ruleApplies(rule, recipe) {
  return rule.conditions.cooking_methods.length === 0 || rule.conditions.cooking_methods.includes(recipe.cooking_method);
}

function validateQuantityBinding(rule, requirement, path, error) {
  const ratioApplies = rule.quantity_ratio?.required_unit === requirement.quantity.unit;
  if (!ratioApplies && !rule.conditions.requires_confirmation) {
    error('rule.quantity_confirmation_required', path,
      `替代需求 ${requirement.requirement_id} 缺少适用 ${requirement.quantity.unit} 单位的用量比例，必须要求用户确认用量说明。`);
  }
}

function ruleSignature(rule) {
  const conditions = { ...rule.conditions,
    cooking_methods: [...rule.conditions.cooking_methods].sort(),
    requires_available_ingredient_ids: [...rule.conditions.requires_available_ingredient_ids].sort() };
  return fingerprint([rule.scope, rule.recipe_id ?? null, rule.required_ingredient_id,
    rule.substitute_ingredient_id, conditions]);
}

export function validateRules(context) {
  const { catalog, reference, error } = context;
  const signatures = new Set();
  catalog.substitution_rules.forEach((rule, index) => {
    const path = `/substitution_rules/${index}`;
    reference('ingredient', rule.required_ingredient_id, `${path}/required_ingredient_id`);
    reference('ingredient', rule.substitute_ingredient_id, `${path}/substitute_ingredient_id`);
    if (rule.required_ingredient_id === rule.substitute_ingredient_id) error('rule.same_endpoint', path, '替代规则的原料与替代品必须不同。');
    rule.conditions.requires_available_ingredient_ids.forEach((id, conditionIndex) =>
      reference('ingredient', id, `${path}/conditions/requires_available_ingredient_ids/${conditionIndex}`));
    const signature = ruleSignature(rule);
    if (signatures.has(signature)) error('rule.duplicate', path, '同一作用域、方向和条件的替代规则重复。');
    signatures.add(signature);
    if (rule.scope !== 'recipe') return;
    const recipe = reference('recipe', rule.recipe_id, `${path}/recipe_id`);
    if (!recipe) return;
    if (!recipe.substitution_overrides.some(override => override.rule_id === rule.rule_id && override.action === 'allow')) {
      error('rule.recipe_allow_missing', path, '菜谱级替代规则必须由所属菜谱的 allow 覆盖激活。');
    }
    if (!ruleApplies(rule, recipe)) error('rule.method_conflict', path, '菜谱烹饪方法不满足替代规则条件。');
    validateConditions(rule, recipe, path, error);
  });
}

function validateOverride(override, recipe, path, context, seen) {
  const { reference, error } = context;
  const requirement = recipe.requirements.find(item => item.requirement_id === override.requirement_id);
  if (!requirement) error('reference.missing_requirement', `${path}/requirement_id`, '替代覆盖引用了本菜谱以外或不存在的需求。');
  const rule = reference('substitution_rule', override.rule_id, `${path}/rule_id`);
  if (!rule || !requirement) return;
  if (rule.scope === 'recipe' && rule.recipe_id !== recipe.recipe_id) error('override.wrong_recipe', path, '菜谱级规则只能在所属菜谱中使用。');
  if (rule.required_ingredient_id !== requirement.ingredient_id) error('override.wrong_ingredient', path, '规则目标原料与所覆盖需求不一致。');
  const key = `${override.requirement_id}/${rule.required_ingredient_id}/${rule.substitute_ingredient_id}`;
  if (seen.has(key)) error('override.conflict', path, '同一需求及有向原料对有重复或矛盾覆盖，不能用另一个规则 ID 绕过 forbid。');
  seen.add(key);
  if (override.action !== 'allow') return;
  if (!ruleApplies(rule, recipe)) error('override.method_conflict', path, '显式允许的规则不适用于菜谱烹饪方法。');
  const rulePath = context.index.get(`substitution_rule/${rule.rule_id}`).path;
  validateConditions(rule, recipe, rulePath, error);
  validateQuantityBinding(rule, requirement, path, error);
  const needsChanges = rule.step_policy === 'recipe_step_changes_required';
  if (needsChanges !== (override.step_changes.length > 0)) error('override.step_policy', path, '步骤修改必须与规则 step_policy 一致，要求修改步骤时不得为空。');
  validateStepChanges(recipe, override.step_changes, `${path}/step_changes`, error, requirement.requirement_id);
}

function validateActiveRules(recipe, context) {
  const { catalog, error } = context;
  for (const rule of catalog.substitution_rules) {
    if (rule.scope !== 'global' || rule.level === 'poor' || !ruleApplies(rule, recipe)) continue;
    const active = recipe.requirements.filter(requirement => requirement.ingredient_id === rule.required_ingredient_id
      && !recipe.substitution_overrides.some(override => {
        const overridden = context.index.get(`substitution_rule/${override.rule_id}`)?.entity;
        return override.requirement_id === requirement.requirement_id && override.action === 'forbid'
          && overridden?.required_ingredient_id === rule.required_ingredient_id
          && overridden?.substitute_ingredient_id === rule.substitute_ingredient_id;
      }));
    if (active.length === 0) continue;
    const rulePath = context.index.get(`substitution_rule/${rule.rule_id}`).path;
    validateConditions(rule, recipe, rulePath, error);
    for (const requirement of active) validateQuantityBinding(rule, requirement, rulePath, error);
  }
}

export function validateRecipes(context) {
  const { catalog, reference, error } = context;
  catalog.recipes.forEach((recipe, index) => {
    const path = `/recipes/${index}`;
    reference('dish', recipe.dish_id, `${path}/dish_id`);
    recipe.requirements.forEach((requirement, requirementIndex) => {
      const requirementPath = `${path}/requirements/${requirementIndex}`;
      reference('ingredient', requirement.ingredient_id, `${requirementPath}/ingredient_id`);
      if (requirement.quantity.min > requirement.quantity.max) error('quantity.reversed_range', `${requirementPath}/quantity`, '用量下限不能大于上限。');
    });
    validateRecipeSteps(recipe, path, error);
    const seen = new Set();
    recipe.substitution_overrides.forEach((override, overrideIndex) =>
      validateOverride(override, recipe, `${path}/substitution_overrides/${overrideIndex}`, context, seen));
    validateActiveRules(recipe, context);
  });
}
