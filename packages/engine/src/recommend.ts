import { evaluateRecipe } from './evaluate.ts';
import { addPurchase, compareIds } from './inventory.ts';
import { rulesForRequirement } from './prepare.ts';
import type { EngineInput, InventorySnapshot, PreparedCatalog, PurchaseSuggestion, Recipe, RecipeEvaluation, Recommendations, Tier } from './types.ts';

const tierOrder: Readonly<Record<Tier, number>> = { ready: 0, caveat: 1, needs_confirmation: 2, one_missing: 3, insufficient: 4 };

export function isFeasible(result: RecipeEvaluation): boolean {
  return result.tier === 'ready' || result.tier === 'caveat';
}

export function compareEvaluations(left: RecipeEvaluation, right: RecipeEvaluation): number {
  return tierOrder[left.tier] - tierOrder[right.tier]
    || left.important_gap_count - right.important_gap_count
    || left.uncertain_required_count - right.uncertain_required_count
    || left.substitution_counts.poor - right.substitution_counts.poor
    || left.substitution_counts.acceptable - right.substitution_counts.acceptable
    || left.substitution_counts.equivalent - right.substitution_counts.equivalent
    || right.current_ingredient_count - left.current_ingredient_count
    || left.time_minutes - right.time_minutes
    || compareIds(left.dish_id, right.dish_id)
    || compareIds(left.recipe_id, right.recipe_id);
}

function fitsFilters(recipe: Recipe, filters: EngineInput['filters']): boolean {
  return (filters?.max_time_minutes === undefined || recipe.time_minutes <= filters.max_time_minutes)
    && (filters?.max_spicy_level === undefined || recipe.spicy_level <= filters.max_spicy_level)
    && (filters?.courses === undefined || filters.courses.includes(recipe.course));
}

function recipesByIngredientTarget(prepared: PreparedCatalog, recipes: readonly Recipe[]): ReadonlyMap<string, ReadonlySet<Recipe>> {
  const targets = new Map<string, Set<Recipe>>();
  const add = (ingredientId: string, recipe: Recipe) => {
    const affected = targets.get(ingredientId) ?? new Set<Recipe>();
    affected.add(recipe);
    targets.set(ingredientId, affected);
  };
  for (const recipe of recipes) {
    for (const requirement of recipe.requirements) {
      add(requirement.ingredient_id, recipe);
      for (const rule of rulesForRequirement(prepared, recipe, requirement)) {
        add(rule.substitute_ingredient_id, recipe);
        for (const id of rule.conditions.requires_available_ingredient_ids) add(id, recipe);
      }
    }
  }
  return targets;
}

function purchaseCandidates(prepared: PreparedCatalog, recipes: readonly Recipe[], inventory: InventorySnapshot): ReadonlyMap<string, readonly Recipe[]> {
  const targets = recipesByIngredientTarget(prepared, recipes);
  const owned = new Set(inventory.items.map((item) => item.ingredient_id));
  const candidates = new Map<string, readonly Recipe[]>();
  const ingredientIds = [...prepared.ingredients.keys()].sort(compareIds);
  for (const ingredientId of ingredientIds) {
    if (!prepared.ingredients.get(ingredientId)!.selectable || owned.has(ingredientId)) continue;
    const affected = new Set<Recipe>();
    for (const target of [ingredientId, ...(prepared.ancestors.get(ingredientId) ?? [])]) {
      for (const recipe of targets.get(target) ?? []) affected.add(recipe);
    }
    if (affected.size > 0) candidates.set(ingredientId, [...affected]);
  }
  return candidates;
}

function groupDishes(results: readonly RecipeEvaluation[]): RecipeEvaluation[] {
  const dishes = new Map<string, RecipeEvaluation>();
  for (const result of results) {
    const previous = dishes.get(result.dish_id);
    if (!previous || compareEvaluations(result, previous) < 0) dishes.set(result.dish_id, result);
  }
  return [...dishes.values()].sort(compareEvaluations);
}

function evaluatePurchases(prepared: PreparedCatalog, recipes: readonly Recipe[], baseline: readonly RecipeEvaluation[], inventory: InventorySnapshot, confirmations: ReadonlySet<string>) {
  const feasibleDishes = new Set(baseline.filter(isFeasible).map((result) => result.dish_id));
  const incomplete = recipes.filter((_, index) => !isFeasible(baseline[index]!));
  const additions = new Map<string, string[]>();
  const purchases: PurchaseSuggestion[] = [];
  for (const [ingredientId, affectedRecipes] of purchaseCandidates(prepared, incomplete, inventory)) {
    const nextInventory = addPurchase(prepared, inventory, ingredientId);
    const newDishes = new Set<string>();
    for (const recipe of affectedRecipes) {
      const result = evaluateRecipe(prepared, recipe, nextInventory, confirmations);
      if (!isFeasible(result)) continue;
      additions.set(recipe.recipe_id, [...(additions.get(recipe.recipe_id) ?? []), ingredientId]);
      if (!feasibleDishes.has(recipe.dish_id)) newDishes.add(recipe.dish_id);
    }
    if (newDishes.size) purchases.push({ ingredient_id: ingredientId, dish_ids: [...newDishes].sort(compareIds), new_dish_count: newDishes.size });
  }
  purchases.sort((left, right) => right.new_dish_count - left.new_dish_count || compareIds(left.ingredient_id, right.ingredient_id));
  return { additions, purchases };
}

function classifyMissing(result: RecipeEvaluation, buyIds: readonly string[]): RecipeEvaluation {
  const tier = result.tier === 'insufficient' && result.plan_valid && result.missing_equipment.length === 0
    && result.uncertain_equipment.length === 0 && result.uncertain_required_count === 0 && buyIds.length > 0 ? 'one_missing' : result.tier;
  return { ...result, tier, buy_ingredient_ids: buyIds };
}

export function recommend(prepared: PreparedCatalog, input: EngineInput, inventory: InventorySnapshot): Recommendations {
  const recipes = prepared.catalog.recipes.filter((recipe) => fitsFilters(recipe, input.filters));
  const confirmations = new Set(input.confirmations ?? []);
  // 基准完整扫描；购买模拟按原料依赖重算受影响做法，保留全部允许的方案组合。
  const baseline = recipes.map((recipe) => evaluateRecipe(prepared, recipe, inventory, confirmations));
  const { additions, purchases } = evaluatePurchases(prepared, recipes, baseline, inventory, confirmations);
  const results = baseline.map((result) => classifyMissing(result, additions.get(result.recipe_id) ?? []));
  return {
    dataset_version: prepared.catalog.dataset_version, inventory_signature: inventory.signature,
    data_status: prepared.catalog.release_state, quantity_scope: 'ingredient_kinds_only',
    dishes: groupDishes(results), purchases,
  };
}
