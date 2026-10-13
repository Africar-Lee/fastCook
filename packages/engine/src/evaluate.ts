import { optionsForRequirement } from './matching.ts';
import type { MatchOption } from './matching.ts';
import { buildPlan } from './plan.ts';
import type { ExecutionPlan } from './plan.ts';
import type { Equipment, ExecutionStep, InventorySnapshot, PreparedCatalog, Recipe, RecipeEvaluation, RequirementMatch, SubstitutionLevel, Tier } from './types.ts';

const tierOrder: Readonly<Record<Tier, number>> = { ready: 0, caveat: 1, needs_confirmation: 2, one_missing: 3, insufficient: 4 };

function distinctSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function determineTier(plan: ExecutionPlan, missingEquipment: readonly Equipment[], uncertainEquipment: readonly Equipment[]): Tier {
  if (!plan.valid || missingEquipment.length > 0) return 'insufficient';
  if (uncertainEquipment.length > 0 || plan.matches.some(match => !match.omitted && match.presence === 'uncertain')) return 'needs_confirmation';
  if (plan.matches.some(match => match.importance === 'required' && match.presence === 'missing')) return 'insufficient';
  if (plan.matches.some(match => match.importance === 'important' && (match.omitted || match.presence !== 'present')
    || !match.omitted && (match.substitution_level === 'acceptable' || match.substitution_level === 'poor'))) return 'caveat';
  return 'ready';
}

function substitutionCounts(matches: readonly RequirementMatch[]): Readonly<Record<SubstitutionLevel, number>> {
  const counts = { equivalent: 0, acceptable: 0, poor: 0 };
  for (const match of matches) {
    if (!match.omitted && match.substitution_level) counts[match.substitution_level] += 1;
  }
  return counts;
}

function usedInventory(recipe: Recipe, matches: readonly RequirementMatch[], inventory: InventorySnapshot, valid: boolean): { ids: readonly string[]; currentCount: number } {
  if (!valid) return { ids: [], currentCount: 0 };
  const consuming = new Set(recipe.requirements.filter(requirement => requirement.consumes).map(requirement => requirement.requirement_id));
  const ids = distinctSorted(matches.filter(match => consuming.has(match.requirement_id) && !match.omitted
    && match.presence === 'present' && match.inventory_item_id !== undefined).map(match => match.inventory_item_id!));
  const current = new Set(inventory.items.filter(item => item.location === 'current').map(item => item.item_id));
  return { ids, currentCount: ids.filter(id => current.has(id)).length };
}

function executionSteps(plan: ExecutionPlan): readonly ExecutionStep[] {
  const substitutions = new Map<string, ExecutionStep['substitutions'][number]>();
  for (const match of plan.matches) {
    if (match.omitted || match.presence !== 'present' || match.match_kind !== 'substitution'
      || !match.used_ingredient_id || !match.rule_id || !match.note) continue;
    substitutions.set(match.requirement_id, {
      requirement_id: match.requirement_id, original_ingredient_id: match.ingredient_id,
      used_ingredient_id: match.used_ingredient_id, rule_id: match.rule_id,
      ...(match.quantity === undefined ? {} : { recipe_quantity: match.quantity }), usage_note: match.note,
    });
  }
  return plan.steps.map(step => ({ ...step, substitutions: step.requirement_ids.flatMap(id => {
    const substitution = substitutions.get(id);
    return substitution ? [substitution] : [];
  }) }));
}

function summarize(recipe: Recipe, plan: ExecutionPlan, inventory: InventorySnapshot): RecipeEvaluation {
  const equipment = [...new Set(recipe.equipment_slots.map(slot => slot.equipment))].sort();
  const missingEquipment = equipment.filter(item => inventory.unavailableEquipment.has(item));
  const uncertainEquipment = equipment.filter(item => !inventory.availableEquipment.has(item) && !inventory.unavailableEquipment.has(item));
  const tier = determineTier(plan, missingEquipment, uncertainEquipment);
  const used = usedInventory(recipe, plan.matches, inventory, plan.valid);
  return {
    recipe_id: recipe.recipe_id, dish_id: recipe.dish_id, tier,
    requirements: plan.matches, steps: tier === 'ready' || tier === 'caveat' ? executionSteps(plan) : [], plan_valid: plan.valid,
    ...(plan.error === undefined ? {} : { plan_error: plan.error }),
    missing_required_ingredient_ids: distinctSorted(plan.matches.filter(match => match.importance === 'required'
      && match.presence === 'missing').map(match => match.ingredient_id)),
    uncertain_requirement_ids: distinctSorted(plan.matches.filter(match => match.presence === 'uncertain').map(match => match.requirement_id)),
    missing_equipment: missingEquipment, uncertain_equipment: uncertainEquipment,
    important_gap_count: plan.matches.filter(match => match.importance === 'important' && (match.omitted || match.presence !== 'present')).length,
    uncertain_required_count: plan.matches.filter(match => match.importance === 'required' && match.presence === 'uncertain').length,
    substitution_counts: substitutionCounts(plan.matches), used_inventory_item_ids: used.ids,
    current_ingredient_count: used.currentCount, time_minutes: recipe.time_minutes, buy_ingredient_ids: [],
  };
}

function comparePlans(left: RecipeEvaluation, right: RecipeEvaluation): number {
  if (left.plan_valid !== right.plan_valid) return left.plan_valid ? -1 : 1;
  const leftValues = [tierOrder[left.tier], left.important_gap_count, left.uncertain_required_count,
    left.substitution_counts.poor, left.substitution_counts.acceptable, left.substitution_counts.equivalent,
    left.requirements.filter(match => match.match_kind === 'approved_descendant').length, -left.current_ingredient_count];
  const rightValues = [tierOrder[right.tier], right.important_gap_count, right.uncertain_required_count,
    right.substitution_counts.poor, right.substitution_counts.acceptable, right.substitution_counts.equivalent,
    right.requirements.filter(match => match.match_kind === 'approved_descendant').length, -right.current_ingredient_count];
  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] !== rightValues[index]) return leftValues[index]! - rightValues[index]!;
  }
  const key = (evaluation: RecipeEvaluation) => JSON.stringify(evaluation.requirements.map(match => [match.requirement_id,
    match.omitted, match.rule_id ?? '', match.inventory_item_id ?? '']));
  return key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;
}

export function evaluateRecipe(prepared: PreparedCatalog, recipe: Recipe, inventory: InventorySnapshot,
  confirmations: ReadonlySet<string>): RecipeEvaluation {
  const choices = recipe.requirements.map(requirement => optionsForRequirement(prepared, recipe, requirement, inventory, confirmations));
  let best: RecipeEvaluation | undefined;
  const visit = (index: number, options: readonly MatchOption[]): void => {
    if (index === choices.length) {
      const evaluation = summarize(recipe, buildPlan(prepared, recipe, options), inventory);
      if (!best || comparePlans(evaluation, best) < 0) best = evaluation;
      return;
    }
    for (const option of choices[index]!) visit(index + 1, [...options, option]);
  };
  visit(0, []);
  return best!;
}
