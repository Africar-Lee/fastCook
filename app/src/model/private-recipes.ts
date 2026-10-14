import { t } from '../i18n/core.ts';
import { createEngine } from '../../../packages/engine/src/index.ts';
import type { CookingMethod, Course, Equipment, Importance, Quantity, Requirement, StepChange } from '../../../packages/engine/src/types';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import type { AppCatalog, AppRecipe } from './types';

export type PrivateRecipeStepChange = Readonly<{ stepId: string; action: 'skip' }>
  | Readonly<{ stepId: string; action: 'replace'; text: string; ingredientIds: readonly string[] }>;
export type PrivateRecipeIngredient = Readonly<{
  ingredientId: string;
  quantity: Quantity;
  importance: Importance;
  role: Requirement['role'];
  consumes: boolean;
  omission?: Readonly<{ note: string; stepChanges: readonly PrivateRecipeStepChange[] }>;
}>;
export type PrivateRecipeStep = Readonly<{ id: string; text: string; ingredientIds: readonly string[] }>;
export type PrivateRecipe = Readonly<{
  id: string;
  name: string;
  course: Course;
  cookingMethod: CookingMethod;
  timeMinutes: number;
  servings: number;
  spicyLevel: number;
  equipment: readonly Equipment[];
  ingredients: readonly PrivateRecipeIngredient[];
  steps: readonly PrivateRecipeStep[];
}>;

export const MAX_PRIVATE_RECIPES = 100;
const MAX_RECIPE_ITEMS = 30;
const COURSES: readonly Course[] = ['meat', 'veg', 'soup', 'staple', 'cold'];
const METHODS: readonly CookingMethod[] = ['stir_fry', 'pan_fry', 'deep_fry', 'boil', 'steam', 'braise', 'roast', 'cold_mix', 'mixed'];
const EQUIPMENT: readonly Equipment[] = ['wok', 'frying_pan', 'pot', 'steamer', 'oven', 'air_fryer', 'rice_cooker', 'microwave', 'pressure_cooker', 'electric_steamer'];
const IMPORTANCE: readonly Importance[] = ['required', 'important', 'optional'];
const ROLES: readonly Requirement['role'][] = ['main', 'secondary', 'seasoning', 'garnish'];
const RECIPE_FIELDS = ['id', 'name', 'course', 'cookingMethod', 'timeMinutes', 'servings', 'spicyLevel', 'equipment', 'ingredients', 'steps'];
const BURNER_EQUIPMENT = new Set<Equipment>(['wok', 'frying_pan', 'pot', 'steamer']);
const validatedCollections = new WeakMap<AppCatalog, WeakSet<readonly PrivateRecipe[]>>();

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function boundedText(value: unknown, maximum: number, multiline = false): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
}

function member<Value extends string>(value: unknown, values: readonly Value[]): value is Value {
  return typeof value === 'string' && values.includes(value as Value);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function identifiers(value: unknown, known: ReadonlySet<string>, maximum = MAX_RECIPE_ITEMS): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(id => typeof id === 'string' && known.has(id))
    && new Set(value).size === value.length;
}

function localIdentifier(value: unknown, prefix: 'local_' | 'step_'): value is string {
  return typeof value === 'string' && value.length <= 100 && value.startsWith(prefix)
    && /^[a-zA-Z0-9_-]+$/.test(value.slice(prefix.length));
}

function validateQuantity(value: unknown): StorageResult<Quantity> {
  if (!record(value, ['unit'], ['value', 'min', 'max', 'spoon_standard'])
    || !member(value.unit, ['g', 'ml', 'piece', 'to_taste', 'tbsp', 'tsp'])) return failure(t('原料用量格式无效，请重新填写。'));
  if (value.unit === 'to_taste') return Object.keys(value).length === 1
    ? success({ unit: 'to_taste' }) : failure(t('适量不需要填写数字或量匙标准。'));
  const spoon = value.unit === 'tbsp' || value.unit === 'tsp';
  if (spoon ? value.spoon_standard !== 'metric_15ml_5ml' : Object.hasOwn(value, 'spoon_standard')) {
    return failure(t('量匙须使用大匙 15 毫升、小匙 5 毫升的标准。'));
  }
  const amount = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number) && number > 0 && number <= 100_000;
  const exact = amount(value.value) && !Object.hasOwn(value, 'min') && !Object.hasOwn(value, 'max');
  const range = !Object.hasOwn(value, 'value') && amount(value.min) && amount(value.max) && value.min <= value.max;
  if (!exact && !range) return failure(t('用量须为大于 0 且不超过 100000 的数字，或从小到大的范围。'));
  return success({ unit: value.unit, ...(exact ? { value: value.value as number } : { min: value.min as number, max: value.max as number }),
    ...(spoon ? { spoon_standard: 'metric_15ml_5ml' } : {}) });
}

function validateSteps(value: unknown, ingredientIds: ReadonlySet<string>): StorageResult<readonly PrivateRecipeStep[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPE_ITEMS) return failure(t('请填写 1 至 30 个制作步骤。'));
  const steps: PrivateRecipeStep[] = [];
  for (const step of value) {
    if (!record(step, ['id', 'text', 'ingredientIds']) || !localIdentifier(step.id, 'step_')
      || !boundedText(step.text, 1000, true) || !identifiers(step.ingredientIds, ingredientIds)) {
      return failure(t('步骤格式或原料引用无效，请填写步骤正文并重新选择所用原料。'));
    }
    steps.push({ id: step.id, text: step.text.trim(), ingredientIds: [...step.ingredientIds] });
  }
  if (new Set(steps.map(step => step.id)).size !== steps.length) return failure(t('制作步骤编号重复，请重新添加该步骤。'));
  const used = new Set(steps.flatMap(step => step.ingredientIds));
  if ([...ingredientIds].some(id => !used.has(id))) return failure(t('每种原料都需要关联至少一个制作步骤。'));
  return success(steps);
}

function validateChange(value: unknown, steps: readonly PrivateRecipeStep[], ids: ReadonlySet<string>, omittedId: string): StorageResult<PrivateRecipeStepChange> {
  if (!record(value, ['stepId', 'action'], ['text', 'ingredientIds']) || typeof value.stepId !== 'string'
    || !steps.some(step => step.id === value.stepId && step.ingredientIds.includes(omittedId))) {
    return failure(t('省略调整须对应使用该原料的制作步骤。'));
  }
  if (value.action === 'skip' && Object.keys(value).length === 2) return success({ stepId: value.stepId, action: 'skip' });
  if (value.action !== 'replace' || !boundedText(value.text, 1000, true)
    || !identifiers(value.ingredientIds, ids) || value.ingredientIds.includes(omittedId)) {
    return failure(t('省略后的步骤需要有效正文和原料，且不能继续使用被省略的原料。'));
  }
  return success({ stepId: value.stepId, action: 'replace', text: value.text.trim(), ingredientIds: [...value.ingredientIds] });
}

function validateOmission(value: unknown, steps: readonly PrivateRecipeStep[], ids: ReadonlySet<string>, omittedId: string): StorageResult<NonNullable<PrivateRecipeIngredient['omission']>> {
  if (!record(value, ['note', 'stepChanges']) || !boundedText(value.note, 500, true)
    || !Array.isArray(value.stepChanges) || value.stepChanges.length === 0 || value.stepChanges.length > MAX_RECIPE_ITEMS) {
    return failure(t('可省略原料需要填写省略说明及对应的步骤调整。'));
  }
  const changes: PrivateRecipeStepChange[] = [];
  for (const item of value.stepChanges) {
    const validated = validateChange(item, steps, ids, omittedId);
    if (validated.error !== null) return validated;
    changes.push(validated.data);
  }
  const changed = new Set(changes.map(change => change.stepId));
  if (changed.size !== changes.length || steps.some(step => step.ingredientIds.includes(omittedId) && !changed.has(step.id))) {
    return failure(t('省略方案须逐一调整使用该原料的步骤，每个步骤只能调整一次。'));
  }
  return success({ note: value.note.trim(), stepChanges: changes });
}

function validateIngredients(value: readonly unknown[], steps: readonly PrivateRecipeStep[], ids: ReadonlySet<string>): StorageResult<readonly PrivateRecipeIngredient[]> {
  const ingredients: PrivateRecipeIngredient[] = [];
  for (const item of value) {
    if (!record(item, ['ingredientId', 'quantity', 'importance', 'role', 'consumes'], ['omission'])
      || typeof item.ingredientId !== 'string' || !member(item.importance, IMPORTANCE) || !member(item.role, ROLES) || typeof item.consumes !== 'boolean') {
      return failure(t('原料设置无效，请检查必要性、用途和用量。'));
    }
    const quantity = validateQuantity(item.quantity);
    if (quantity.error !== null) return quantity;
    if (item.importance === 'required' && Object.hasOwn(item, 'omission')) return failure(t('必需原料不能设置省略方案。'));
    const omission = item.importance === 'required' ? null : validateOmission(item.omission, steps, ids, item.ingredientId);
    if (omission && omission.error !== null) return omission;
    ingredients.push({ ingredientId: item.ingredientId, quantity: quantity.data, importance: item.importance,
      role: item.role, consumes: item.consumes, ...(omission?.data ? { omission: omission.data } : {}) });
  }
  return success(ingredients);
}

function readPrivateRecipe(value: unknown, catalog: AppCatalog): StorageResult<PrivateRecipe> {
  if (!record(value, RECIPE_FIELDS) || !localIdentifier(value.id, 'local_') || !boundedText(value.name, 80)
    || !member(value.course, COURSES) || !member(value.cookingMethod, METHODS)
    || !integer(value.timeMinutes, 1, 1440) || !integer(value.servings, 1, 20) || !integer(value.spicyLevel, 0, 3)
    || !identifiers(value.equipment, new Set(EQUIPMENT), EQUIPMENT.length)) {
    return failure(t('菜谱基本信息无效，请检查名称、分类、时间、份数和厨具。'));
  }
  if (catalog.recipes.some(recipe => recipe.recipe_id === value.id) || catalog.dishes.some(dish => dish.dish_id === value.id)) {
    return failure(t('菜谱编号与已有菜谱重复，请重新创建菜谱。'));
  }
  if (!Array.isArray(value.ingredients) || value.ingredients.length === 0 || value.ingredients.length > MAX_RECIPE_ITEMS) return failure(t('请添加 1 至 30 种原料。'));
  const known = new Set(catalog.ingredients.filter(ingredient => ingredient.selectable).map(ingredient => ingredient.ingredient_id));
  const ids: unknown[] = value.ingredients.map(item => item !== null && typeof item === 'object' ? item.ingredientId : undefined);
  if (!identifiers(ids, known)) return failure(t('菜谱含未知、不可选择或重复的原料，请重新选择。'));
  const steps = validateSteps(value.steps, new Set(ids));
  if (steps.error !== null) return steps;
  const ingredients = validateIngredients(value.ingredients, steps.data, new Set(ids));
  if (ingredients.error !== null) return ingredients;
  return success({ id: value.id, name: value.name.trim(), course: value.course, cookingMethod: value.cookingMethod,
    timeMinutes: value.timeMinutes, servings: value.servings, spicyLevel: value.spicyLevel, equipment: [...value.equipment] as Equipment[],
    ingredients: ingredients.data, steps: steps.data });
}

function changeKey(change: PrivateRecipeStepChange): string {
  return change.action === 'skip' ? 'skip' : JSON.stringify([change.text, [...change.ingredientIds].sort()]);
}

function omissionPlanError(recipe: PrivateRecipe, omitted: readonly PrivateRecipeIngredient[]): string | null {
  const changes = new Map<string, PrivateRecipeStepChange>();
  for (const ingredient of omitted) {
    for (const change of ingredient.omission!.stepChanges) {
      const previous = changes.get(change.stepId);
      if (previous && changeKey(previous) !== changeKey(change)) return t('多个省略方案修改了同一步骤，请统一步骤调整或将这些原料设为必需。');
      changes.set(change.stepId, change);
    }
  }
  const steps = recipe.steps.flatMap(step => {
    const change = changes.get(step.id);
    return change?.action === 'skip' ? [] : [change?.action === 'replace' ? change : step];
  });
  if (steps.length === 0) return t('省略原料后至少需要保留一个制作步骤。');
  const used = new Set(steps.flatMap(step => step.ingredientIds));
  const omittedIds = new Set(omitted.map(ingredient => ingredient.ingredientId));
  if (recipe.ingredients.some(ingredient => used.has(ingredient.ingredientId) === omittedIds.has(ingredient.ingredientId))) {
    return t('省略后的步骤与实际原料不一致，请保留其他原料的步骤并移除被省略的原料。');
  }
  return null;
}

function validateOmissionPlans(recipe: PrivateRecipe): string | null {
  const optional = recipe.ingredients.filter(ingredient => ingredient.importance !== 'required');
  if (optional.length > 12) return t('可省略原料过多，请保留最多 12 种可省略原料。');
  // The engine permits at most 4096 plans; check every omission combination within that bound.
  for (let mask = 1; mask < 2 ** optional.length; mask += 1) {
    const omitted = optional.filter((_, index) => (mask & (1 << index)) !== 0);
    const error = omissionPlanError(recipe, omitted);
    if (error) return error;
  }
  return null;
}

function requirementId(ingredientId: string): string {
  return `req_${ingredientId}`;
}

function engineStepChange(change: PrivateRecipeStepChange): StepChange {
  return change.action === 'skip' ? { step_id: change.stepId, action: 'skip' }
    : { step_id: change.stepId, action: 'replace', text: { 'zh-CN': change.text }, requirement_ids: change.ingredientIds.map(requirementId) };
}

function appRecipe(recipe: PrivateRecipe, catalog: AppCatalog): AppRecipe {
  return {
    recipe_id: recipe.id, dish_id: recipe.id, name: { 'zh-CN': recipe.name }, course: recipe.course,
    cooking_method: recipe.cookingMethod, time_minutes: recipe.timeMinutes, servings: recipe.servings,
    spicy_level: recipe.spicyLevel, variant: { 'zh-CN': '我的做法' }, source_ids: [], review_state: 'pending_review',
    equipment_slots: recipe.equipment.map(equipment => ({ equipment, minutes: recipe.timeMinutes, burner_slots: Number(BURNER_EQUIPMENT.has(equipment)) })),
    requirements: recipe.ingredients.map(ingredient => ({
      requirement_id: requirementId(ingredient.ingredientId), ingredient_id: ingredient.ingredientId,
      importance: ingredient.importance, role: ingredient.role, consumes: ingredient.consumes, quantity: { ...ingredient.quantity },
      ...(ingredient.omission ? { omission: { note: { 'zh-CN': ingredient.omission.note }, step_changes: ingredient.omission.stepChanges.map(engineStepChange) } } : {}),
    })),
    steps: recipe.steps.map(step => ({ step_id: step.id, text: { 'zh-CN': step.text }, requirement_ids: step.ingredientIds.map(requirementId) })),
    substitution_overrides: recipe.ingredients.flatMap(ingredient => catalog.substitution_rules
      .filter(rule => rule.scope === 'global' && rule.required_ingredient_id === ingredient.ingredientId)
      .map(rule => ({ requirement_id: requirementId(ingredient.ingredientId), rule_id: rule.rule_id,
        action: 'forbid' as const, note: { 'zh-CN': '按我的菜谱所列原料制作。' } }))),
  };
}

export function mergePrivateRecipes(catalog: AppCatalog, recipes: readonly PrivateRecipe[]): AppCatalog {
  if (recipes.length === 0) return catalog;
  return { ...catalog, release_state: 'draft', dishes: [...catalog.dishes, ...recipes.map(recipe => ({ dish_id: recipe.id }))],
    recipes: [...catalog.recipes, ...recipes.map(recipe => appRecipe(recipe, catalog))] };
}

function freezeRecord<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRecord(child);
    Object.freeze(value);
  }
  return value;
}

function rememberRecipes(recipes: PrivateRecipe[], catalog: AppCatalog): readonly PrivateRecipe[] {
  const frozen = freezeRecord(recipes);
  const known = validatedCollections.get(catalog) ?? new WeakSet<readonly PrivateRecipe[]>();
  known.add(frozen);
  validatedCollections.set(catalog, known);
  return frozen;
}

export function validatePrivateRecipes(value: unknown, catalog: AppCatalog): StorageResult<readonly PrivateRecipe[]> {
  if (!Array.isArray(value) || value.length > MAX_PRIVATE_RECIPES) return failure(t('我的菜谱格式无效，最多可保存 100 道菜谱。'));
  if (validatedCollections.get(catalog)?.has(value)) return success(value);
  if (value.length === 0) return success(rememberRecipes([], catalog));
  const recipes: PrivateRecipe[] = [];
  for (const item of value) {
    const recipe = readPrivateRecipe(item, catalog);
    if (recipe.error !== null) return recipe;
    const omissionError = validateOmissionPlans(recipe.data);
    if (omissionError) return failure(omissionError);
    recipes.push(recipe.data);
  }
  if (new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) return failure(t('我的菜谱编号重复，请检查菜谱记录。'));
  const engine = createEngine(mergePrivateRecipes(catalog, recipes), { allowDraft: true });
  if (engine.error !== null) return failure(t('菜谱无法参与推荐，请检查原料和省略方案。{error}', { error: t(engine.error.message) }));
  return success(rememberRecipes(recipes, catalog));
}

export function validatePrivateRecipe(value: unknown, catalog: AppCatalog): StorageResult<PrivateRecipe> {
  const result = validatePrivateRecipes([value], catalog);
  return result.error !== null ? failure(result.error) : success(result.data[0]!);
}

function createId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function createPrivateRecipeId(): string {
  return createId('local_');
}

export function createPrivateRecipeStepId(): string {
  return createId('step_');
}

export function isPrivateRecipeId(value: unknown): value is string {
  return localIdentifier(value, 'local_');
}
