import { compareIds } from './inventory.ts';
import { compareEvaluations, isFeasible } from './recommend.ts';
import type { Catalog, Course, Equipment, Recipe, RecipeEvaluation, Result, Tier } from './types.ts';

export type MealPattern = Readonly<{ id: string; courses: readonly Course[] }>;
export type MealConflict = Readonly<{ ingredient_id: string; recipe_ids: readonly string[] }>;
export type MealOptions = Readonly<{
  people: number;
  burnerCount: number;
  currentIngredientIds: readonly string[];
  sharedIngredientIds?: readonly string[];
  fixedRecipeIds?: readonly string[];
}>;
export type MealPlan = Readonly<{
  id: string;
  pattern: MealPattern;
  recipe_ids: readonly string[];
  estimated_minutes: number;
  method_count: number;
  current_ingredient_count: number;
  caveat_count: number;
}>;
type MealEntry = Readonly<{ recipe: Recipe; evaluation: RecipeEvaluation; consumed: readonly string[] }>;
type MealCourse = Exclude<Course, 'cold'>;

const tierOrder: Readonly<Record<Tier, number>> = { ready: 0, caveat: 1, needs_confirmation: 2, one_missing: 3, insufficient: 4 };
const candidateLimit = 15;
const planLimit = 3;
const validInteger = (value: number, maximum: number) => Number.isInteger(value) && value >= 1 && value <= maximum;
const mealCourse = (course: Course): MealCourse => course === 'cold' ? 'veg' : course;

export function defaultMealPatterns(people: number): readonly MealPattern[] {
  if (!validInteger(people, 12)) return [];
  if (people <= 2) return [
    { id: 'meat_veg', courses: ['meat', 'veg'] },
    { id: 'meat_soup', courses: ['meat', 'soup'] },
    { id: 'veg_soup', courses: ['veg', 'soup'] },
  ];
  if (people <= 4) return [
    { id: 'two_dishes_soup', courses: ['meat', 'veg', 'soup'] },
    { id: 'three_dishes_soup', courses: ['meat', 'veg', 'veg', 'soup'] },
    { id: 'two_meat_veg_soup', courses: ['meat', 'meat', 'veg', 'soup'] },
  ];
  return [{ id: 'four_dishes_soup', courses: ['meat', 'meat', 'veg', 'veg', 'soup'] }];
}

export function consumedIngredientIds(recipe: Recipe, evaluation: RecipeEvaluation): readonly string[] {
  if (recipe.recipe_id !== evaluation.recipe_id) return [];
  const consumedRequirements = new Set(recipe.requirements.filter(item => item.consumes).map(item => item.requirement_id));
  return [...new Set(evaluation.requirements.filter(match => consumedRequirements.has(match.requirement_id)
    && !match.omitted && match.presence !== 'missing' && match.used_ingredient_id !== undefined)
    .map(match => match.used_ingredient_id!))].sort(compareIds);
}

function entriesFor(catalog: Catalog, evaluations: readonly RecipeEvaluation[]): MealEntry[] {
  const recipes = new Map(catalog.recipes.map(recipe => [recipe.recipe_id, recipe]));
  return evaluations.flatMap(evaluation => {
    const recipe = recipes.get(evaluation.recipe_id);
    return recipe && recipe.dish_id === evaluation.dish_id
      ? [{ recipe, evaluation, consumed: consumedIngredientIds(recipe, evaluation) }] : [];
  });
}

export function findMealConflicts(catalog: Catalog, evaluations: readonly RecipeEvaluation[],
  sharedIngredientIds: readonly string[] = []): readonly MealConflict[] {
  const shared = new Set(sharedIngredientIds);
  const owners = new Map<string, Set<string>>();
  for (const entry of entriesFor(catalog, evaluations)) {
    for (const ingredientId of entry.consumed) {
      if (shared.has(ingredientId)) continue;
      const recipes = owners.get(ingredientId) ?? new Set<string>();
      recipes.add(entry.recipe.recipe_id);
      owners.set(ingredientId, recipes);
    }
  }
  return [...owners].filter(([, recipes]) => recipes.size > 1)
    .sort(([left], [right]) => compareIds(left, right))
    .map(([ingredient_id, recipes]) => ({ ingredient_id, recipe_ids: [...recipes].sort(compareIds) }));
}

function remainingCourses(pattern: MealPattern, selected: readonly MealEntry[]): readonly Course[] | null {
  const remaining = [...pattern.courses];
  for (const entry of selected) {
    const position = remaining.indexOf(mealCourse(entry.recipe.course));
    if (position === -1) return null;
    remaining.splice(position, 1);
  }
  return remaining;
}

export function rankMealCandidates(catalog: Catalog, candidates: readonly RecipeEvaluation[], selected: readonly RecipeEvaluation[],
  options: Readonly<{ people: number; sharedIngredientIds?: readonly string[] }>): readonly RecipeEvaluation[] {
  const selectedEntries = entriesFor(catalog, selected);
  const shared = new Set(options.sharedIngredientIds ?? []);
  const missingCourses = new Set(defaultMealPatterns(options.people)
    .flatMap(pattern => remainingCourses(pattern, selectedEntries) ?? []));
  const scores = new Map(entriesFor(catalog, candidates).map(entry => {
    const occupied = new Set(selectedEntries.filter(item => item.recipe.dish_id !== entry.recipe.dish_id)
      .flatMap(item => item.consumed));
    return [entry.recipe.recipe_id, {
      conflicts: entry.consumed.some(id => occupied.has(id) && !shared.has(id)),
      needed: missingCourses.has(mealCourse(entry.recipe.course)),
    }];
  }));
  return [...candidates].sort((left, right) => {
    const leftScore = scores.get(left.recipe_id);
    const rightScore = scores.get(right.recipe_id);
    return tierOrder[left.tier] - tierOrder[right.tier]
      || Number(leftScore?.conflicts ?? false) - Number(rightScore?.conflicts ?? false)
      || Number(rightScore?.needed ?? false) - Number(leftScore?.needed ?? false)
      || compareEvaluations(left, right);
  });
}

function estimateRecipes(recipes: readonly Recipe[], burnerCount: number): number | null {
  if (!validInteger(burnerCount, 6)) return null;
  let longest = 0;
  let burnerMinutes = 0;
  const equipmentMinutes = new Map<Equipment, number>();
  for (const recipe of recipes) {
    longest = Math.max(longest, recipe.time_minutes);
    for (const slot of recipe.equipment_slots) {
      if (slot.burner_slots > burnerCount) return null;
      burnerMinutes += slot.minutes * slot.burner_slots;
      equipmentMinutes.set(slot.equipment, (equipmentMinutes.get(slot.equipment) ?? 0) + slot.minutes);
    }
  }
  // 每类厨具按一件计；用资源负荷估时，不推断菜谱未提供的步骤并行关系。
  return Math.ceil(Math.max(longest, burnerMinutes / burnerCount, 0, ...equipmentMinutes.values()));
}

export function estimateMealMinutes(catalog: Catalog, recipeIds: readonly string[], burnerCount: number): number | null {
  const ids = new Set(recipeIds);
  const recipes = catalog.recipes.filter(recipe => ids.has(recipe.recipe_id));
  return recipes.length === ids.size ? estimateRecipes(recipes, burnerCount) : null;
}

function optionError(options: MealOptions, catalog: Catalog): Result<never> | null {
  if (!validInteger(options.people, 12)) return {
    data: null, error: { code: 'meal.invalid_people', path: '/people', message: '配餐人数须为 1 到 12 的整数。' },
  };
  if (!validInteger(options.burnerCount, 6)) return {
    data: null, error: { code: 'meal.invalid_burners', path: '/burnerCount', message: '灶眼数须为 1 到 6 的整数。' },
  };
  const ingredients = new Set(catalog.ingredients.map(item => item.ingredient_id));
  for (const [path, ids] of [['currentIngredientIds', options.currentIngredientIds],
    ['sharedIngredientIds', options.sharedIngredientIds ?? []]] as const) {
    if (ids.some(id => !ingredients.has(id))) return {
      data: null, error: { code: 'meal.unknown_ingredient', path: `/${path}`, message: '配餐食材不在原料字典中，请重新选择。' },
    };
  }
  return null;
}

function uniqueDishes(entries: readonly MealEntry[]): MealEntry[] {
  const used = new Set<string>();
  return [...entries].sort((left, right) => compareEvaluations(left.evaluation, right.evaluation)).filter(entry => {
    if (used.has(entry.recipe.dish_id)) return false;
    used.add(entry.recipe.dish_id);
    return true;
  });
}

function makePlan(pattern: MealPattern, entries: readonly MealEntry[], options: MealOptions): MealPlan {
  const recipeIds = entries.map(entry => entry.recipe.recipe_id).sort(compareIds);
  const current = new Set(options.currentIngredientIds);
  return {
    id: recipeIds.join('+'), pattern, recipe_ids: recipeIds,
    estimated_minutes: estimateRecipes(entries.map(entry => entry.recipe), options.burnerCount)!,
    method_count: new Set(entries.map(entry => entry.recipe.cooking_method)).size,
    current_ingredient_count: new Set(entries.flatMap(entry => entry.consumed).filter(id => current.has(id))).size,
    caveat_count: entries.filter(entry => entry.evaluation.tier === 'caveat').length,
  };
}

function comparePlans(left: MealPlan, right: MealPlan): number {
  const courseCount = (plan: MealPlan) => new Set(plan.pattern.courses.map(mealCourse)).size;
  return left.caveat_count - right.caveat_count
    || courseCount(right) - courseCount(left)
    || left.estimated_minutes - right.estimated_minutes
    || right.method_count - left.method_count
    || right.current_ingredient_count - left.current_ingredient_count
    || compareIds(left.id, right.id);
}

type SearchContext = Readonly<{
  pattern: MealPattern;
  courses: readonly Course[];
  pools: ReadonlyMap<MealCourse, readonly MealEntry[]>;
  shared: ReadonlySet<string>;
  options: MealOptions;
  best: MealPlan[];
}>;

function retainPlan(context: SearchContext, entries: readonly MealEntry[]): void {
  const plan = makePlan(context.pattern, entries, context.options);
  if (context.best.some(previous => previous.id === plan.id)) return;
  context.best.push(plan);
  context.best.sort(comparePlans);
  if (context.best.length > planLimit) context.best.pop();
}

function searchPlans(context: SearchContext, entries: readonly MealEntry[], depth = 0, startIndex = 0): void {
  if (depth === context.courses.length) return retainPlan(context, entries);
  const caveats = entries.filter(entry => entry.evaluation.tier === 'caveat').length;
  if (context.best.length === planLimit && caveats > context.best[planLimit - 1]!.caveat_count) return;
  const course = mealCourse(context.courses[depth]!);
  const pool = context.pools.get(course) ?? [];
  const dishIds = new Set(entries.map(entry => entry.recipe.dish_id));
  const occupied = new Set(entries.flatMap(entry => entry.consumed));
  for (let index = startIndex; index < pool.length; index += 1) {
    const candidate = pool[index]!;
    if (dishIds.has(candidate.recipe.dish_id)
      || candidate.consumed.some(id => occupied.has(id) && !context.shared.has(id))) continue;
    const nextIndex = context.courses[depth + 1] === context.courses[depth] ? index + 1 : 0;
    searchPlans(context, [...entries, candidate], depth + 1, nextIndex);
  }
}

export function generateMealPlans(catalog: Catalog, evaluations: readonly RecipeEvaluation[], options: MealOptions): Result<readonly MealPlan[]> {
  const invalid = optionError(options, catalog);
  if (invalid) return invalid;
  const entries = entriesFor(catalog, evaluations).filter(entry => isFeasible(entry.evaluation)
    && entry.evaluation.plan_valid && entry.evaluation.missing_equipment.length === 0
    && entry.evaluation.uncertain_equipment.length === 0
    && estimateRecipes([entry.recipe], options.burnerCount) !== null);
  const fixedIds = new Set(options.fixedRecipeIds ?? []);
  if ([...fixedIds].some(id => !entries.some(entry => entry.recipe.recipe_id === id))) return {
    data: null, error: { code: 'meal.invalid_fixed_recipe', path: '/fixedRecipeIds', message: '已选菜肴无法制作，请先补齐食材或移出菜篮。' },
  };
  const fixed = uniqueDishes(entries.filter(entry => fixedIds.has(entry.recipe.recipe_id)));
  if (findMealConflicts(catalog, fixed.map(entry => entry.evaluation), options.sharedIngredientIds).length > 0) return { data: [], error: null };
  const pools = new Map<MealCourse, MealEntry[]>();
  for (const entry of uniqueDishes(entries)) {
    const course = mealCourse(entry.recipe.course);
    const pool = pools.get(course) ?? [];
    if (pool.length < candidateLimit) pool.push(entry);
    pools.set(course, pool);
  }
  const best: MealPlan[] = [];
  const shared = new Set(options.sharedIngredientIds ?? []);
  // 每类限 15 道，同类菜只枚举组合；五道菜最多 C(15, 2)^2 * 15 组，冲突在展开前剪枝。
  for (const pattern of defaultMealPatterns(options.people)) {
    const courses = remainingCourses(pattern, fixed);
    if (courses) searchPlans({ pattern, courses, pools, shared, options, best }, fixed);
  }
  return { data: best, error: null };
}
