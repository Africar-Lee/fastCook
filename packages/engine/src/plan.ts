import { satisfies } from './matching.ts';
import type { MatchOption } from './matching.ts';
import type { EngineError, PreparedCatalog, Recipe, RequirementMatch, Step, StepChange } from './types.ts';

export type ExecutionPlan = Readonly<{ valid: boolean; steps: readonly Step[]; matches: readonly RequirementMatch[]; error?: EngineError }>;

function changeKey(change: StepChange): string {
  if (change.action === 'skip') return 'skip';
  return JSON.stringify([Object.entries(change.text).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    [...change.requirement_ids].sort()]);
}

function combineChanges(options: readonly MatchOption[]): ReadonlyMap<string, StepChange> | undefined {
  const changes = new Map<string, StepChange>();
  for (const option of options) {
    for (const change of option.changes) {
      const previous = changes.get(change.step_id);
      if (previous && changeKey(previous) !== changeKey(change)) return undefined;
      changes.set(change.step_id, change);
    }
  }
  return changes;
}

function applyChanges(recipe: Recipe, changes: ReadonlyMap<string, StepChange>): readonly Step[] | undefined {
  const stepIds = new Set(recipe.steps.map(step => step.step_id));
  if ([...changes.keys()].some(id => !stepIds.has(id))) return undefined;
  return recipe.steps.flatMap(step => {
    const change = changes.get(step.step_id);
    if (!change) return [step];
    return change.action === 'skip' ? []
      : [{ step_id: step.step_id, text: change.text, requirement_ids: change.requirement_ids }];
  });
}

function excludeConditionalOmissions(recipe: Recipe, steps: readonly Step[], changes: ReadonlyMap<string, StepChange>,
  options: readonly MatchOption[]): readonly Step[] {
  const conditional = new Set(recipe.requirements.filter(requirement => requirement.omission?.step_changes.length === 0)
    .map(requirement => requirement.requirement_id));
  const omitted = new Set(options.filter(option => option.match.omitted && conditional.has(option.match.requirement_id))
    .map(option => option.match.requirement_id));
  // The authored condition applies to original wording, not replacement text from another rule.
  return steps.map(step => changes.has(step.step_id) ? step : { ...step,
    requirement_ids: step.requirement_ids.filter(id => !omitted.has(id)) });
}

function validReferences(recipe: Recipe, steps: readonly Step[], options: readonly MatchOption[]): boolean {
  if (steps.length === 0) return false;
  const used = new Set(steps.flatMap(step => step.requirement_ids));
  const known = new Set(recipe.requirements.map(requirement => requirement.requirement_id));
  if ([...used].some(id => !known.has(id))) return false;
  return options.every(option => used.has(option.match.requirement_id) !== option.match.omitted);
}

function conditionStatus(prepared: PreparedCatalog, ingredientId: string, matches: readonly RequirementMatch[]): 'present' | 'uncertain' | 'missing' {
  const direct = matches.filter(match => !match.omitted && match.match_kind !== 'substitution'
    && match.used_ingredient_id !== undefined && match.presence !== 'missing');
  if (direct.some(match => match.presence === 'present' && satisfies(prepared, match.used_ingredient_id!, ingredientId))) return 'present';
  if (direct.some(match => satisfies(prepared, ingredientId, match.used_ingredient_id!))) return 'uncertain';
  return 'missing';
}

function validateConditions(prepared: PreparedCatalog, options: readonly MatchOption[]): readonly RequirementMatch[] | undefined {
  const matches = options.map(option => option.match);
  const conditionIds = new Set(options.flatMap(option => option.rule?.conditions.requires_available_ingredient_ids ?? []));
  if (matches.some(match => match.importance !== 'required' && !match.omitted && match.presence === 'uncertain'
    && !conditionIds.has(match.ingredient_id))) return undefined;
  const result: RequirementMatch[] = [];
  for (const option of options) {
    const statuses = option.rule?.conditions.requires_available_ingredient_ids
      .map(id => conditionStatus(prepared, id, matches)) ?? [];
    if (statuses.includes('missing')) return undefined;
    if (statuses.includes('uncertain') && option.match.importance !== 'required') return undefined;
    result.push(statuses.includes('uncertain') ? {
      ...option.match, presence: 'uncertain', reason_code: 'substitution_condition_uncertain',
    } : option.match);
  }
  return result;
}

export function buildPlan(prepared: PreparedCatalog, recipe: Recipe, options: readonly MatchOption[]): ExecutionPlan {
  const invalid = (code: string, message: string): ExecutionPlan => ({
    valid: false, steps: [], matches: options.map(option => option.match),
    error: { code, path: `/recipes/${recipe.recipe_id}`, message: `菜谱 ${recipe.recipe_id} ${message}` },
  });
  const changes = combineChanges(options);
  if (!changes) return invalid('plan.conflicting_changes', '的省略与替代方案修改了同一步骤且内容冲突，请改用原配料或其他已审核方案。');
  const changedSteps = applyChanges(recipe, changes);
  if (!changedSteps) return invalid('plan.invalid_steps', '的执行方案引用了不存在的步骤，请检查数据包中的步骤修改。');
  const steps = excludeConditionalOmissions(recipe, changedSteps, changes, options);
  if (!validReferences(recipe, steps, options)) return invalid('plan.invalid_steps', '修改后的步骤为空或与实际采用的配料不一致，请检查省略与替代方案。');
  const matches = validateConditions(prepared, options);
  return matches ? { valid: true, steps, matches }
    : invalid('plan.unsatisfied_conditions', '的替代条件缺少实际采用且已确认的配料支持，请确认条件原料或改用其他方案。');
}
