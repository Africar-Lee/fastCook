import { fingerprint } from './catalog-fingerprints.mjs';

function validateRequirementRefs(requirementIds, knownRequirements, path, error) {
  requirementIds.forEach((id, index) => {
    if (!knownRequirements.has(id)) error('reference.missing_requirement', `${path}/requirement_ids/${index}`, `步骤引用了不存在的需求 ${id}。`);
  });
}

function validateExecution(recipe, steps, path, error, omittedId) {
  if (steps.length === 0) {
    error('steps.empty_plan', path, '应用步骤修改后必须保留可执行步骤。');
    return;
  }
  const used = new Set(steps.flatMap(step => step.requirement_ids));
  for (const requirement of recipe.requirements) {
    if (requirement.requirement_id === omittedId) continue;
    if (!used.has(requirement.requirement_id)) error('steps.unused_requirement', path, `需求 ${requirement.requirement_id} 没有被任何执行步骤使用。`);
  }
  if (omittedId && used.has(omittedId)) error('omission.still_used', path, `省略 ${omittedId} 后步骤仍引用该需求。`);
}

function applyChanges(recipe, changes) {
  const byId = new Map(changes.map(change => [change.step_id, change]));
  return recipe.steps.flatMap(step => {
    const change = byId.get(step.step_id);
    if (!change) return [step];
    if (change.action === 'skip') return [];
    return [{ step_id: step.step_id, text: change.text, requirement_ids: change.requirement_ids }];
  });
}

export function validateStepChanges(recipe, changes, path, error, targetId, omittedId) {
  const steps = new Map(recipe.steps.map(step => [step.step_id, step]));
  const requirements = new Set(recipe.requirements.map(requirement => requirement.requirement_id));
  const seen = new Set();
  let touchesTarget = false;
  changes.forEach((change, index) => {
    const changePath = `${path}/${index}`;
    const original = steps.get(change.step_id);
    if (!original) error('reference.missing_step', `${changePath}/step_id`, '步骤修改必须引用所属菜谱中存在的步骤。');
    if (seen.has(change.step_id)) error('steps.duplicate_change', changePath, '同一组修改不能重复操作一个步骤。');
    seen.add(change.step_id);
    if (original?.requirement_ids.includes(targetId)) touchesTarget = true;
    if (change.action !== 'replace') return;
    validateRequirementRefs(change.requirement_ids, requirements, changePath, error);
    if (original && fingerprint([original.text, original.requirement_ids]) === fingerprint([change.text, change.requirement_ids])) {
      error('steps.noop_change', changePath, '替换后的步骤内容与用料均未改变。');
    }
  });
  if (changes.length === 0) return;
  if (!touchesTarget) error('steps.unbound_change', path, '步骤修改没有作用于使用目标原料的步骤。');
  validateExecution(recipe, applyChanges(recipe, changes), path, error, omittedId);
}

function validateCombinedChanges(recipe, path, error) {
  const groups = recipe.requirements.filter(requirement => requirement.omission?.step_changes.length)
    .map(requirement => ({ targetId: requirement.requirement_id, changes: requirement.omission.step_changes }));
  groups.push(...recipe.substitution_overrides.filter(override => override.action === 'allow')
    .map(override => ({ targetId: override.requirement_id, changes: override.step_changes })));
  const changesByStep = new Map();
  for (const group of groups) {
    for (const change of group.changes) {
      const previous = changesByStep.get(change.step_id) ?? [];
      if (previous.some(other => other.targetId !== group.targetId && fingerprint(other.change) !== fingerprint(change))) {
        error('steps.conflicting_changes', path, `独立需求同时调整 ${change.step_id} 时会产生互相冲突的步骤修改。`);
      }
      previous.push({ targetId: group.targetId, change });
      changesByStep.set(change.step_id, previous);
    }
  }
  const omissions = recipe.requirements.filter(requirement => requirement.omission?.step_changes.length);
  if (omissions.length < 2) return;
  const remaining = applyChanges(recipe, omissions.flatMap(requirement => requirement.omission.step_changes));
  if (remaining.length === 0) error('steps.empty_plan', path, '同时省略可选原料后不能清空全部步骤。');
}

export function validateRecipeSteps(recipe, path, error) {
  const requirements = new Set(recipe.requirements.map(requirement => requirement.requirement_id));
  recipe.steps.forEach((step, index) => validateRequirementRefs(step.requirement_ids,
    requirements, `${path}/steps/${index}`, error));
  validateExecution(recipe, recipe.steps, `${path}/steps`, error);
  recipe.requirements.forEach((requirement, index) => {
    if (!requirement.omission) return;
    validateStepChanges(recipe, requirement.omission.step_changes,
      `${path}/requirements/${index}/omission/step_changes`, error,
      requirement.requirement_id, requirement.requirement_id);
  });
  validateCombinedChanges(recipe, path, error);
}
