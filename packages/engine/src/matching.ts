import { confirmationKey } from './inventory.ts';
import { rulesForRequirement } from './prepare.ts';
import type { InventoryItem, InventorySnapshot, LocalizedText, PreparedCatalog, Quantity, Recipe, Requirement, RequirementMatch, StepChange, SubstitutionRule } from './types.ts';

export type MatchOption = Readonly<{
  match: RequirementMatch;
  changes: readonly StepChange[];
  rule?: SubstitutionRule;
}>;

export function satisfies(prepared: PreparedCatalog, actual: string, required: string): boolean {
  return actual === required || prepared.ancestors.get(actual)?.has(required) === true;
}

function isUnavailable(prepared: PreparedCatalog, inventory: InventorySnapshot, ingredientId: string): boolean {
  return inventory.unavailable.has(ingredientId)
    || [...(prepared.ancestors.get(ingredientId) ?? [])].some(id => inventory.unavailable.has(id));
}

export function witnesses(prepared: PreparedCatalog, inventory: InventorySnapshot, ingredientId: string): readonly InventoryItem[] {
  if (isUnavailable(prepared, inventory, ingredientId)) return [];
  return inventory.items.filter(item => satisfies(prepared, item.ingredient_id, ingredientId));
}

function genericWitness(prepared: PreparedCatalog, inventory: InventorySnapshot, ingredientId: string): InventoryItem | undefined {
  if (isUnavailable(prepared, inventory, ingredientId)) return undefined;
  return inventory.items.find(item => item.ingredient_id !== ingredientId
    && satisfies(prepared, ingredientId, item.ingredient_id));
}

function baseMatch(requirement: Requirement): RequirementMatch {
  return {
    requirement_id: requirement.requirement_id,
    ingredient_id: requirement.ingredient_id,
    importance: requirement.importance,
    presence: 'missing', match_kind: 'none', omitted: false,
    reason_code: 'required_missing', reason_params: { ingredient_id: requirement.ingredient_id },
  };
}

function directOption(requirement: Requirement, item: InventoryItem): MatchOption {
  const kind = item.location === 'implicit' ? 'implicit'
    : item.ingredient_id === requirement.ingredient_id ? 'exact' : 'approved_descendant';
  return {
    changes: [],
    match: {
      ...baseMatch(requirement), presence: 'present', match_kind: kind,
      inventory_item_id: item.item_id, used_ingredient_id: item.ingredient_id,
      quantity: requirement.quantity,
      reason_code: kind === 'implicit' ? 'implicit_staple' : `${kind}_match`,
      reason_params: { ingredient_id: requirement.ingredient_id, used_ingredient_id: item.ingredient_id },
    },
  };
}

function hasText(text: LocalizedText): boolean {
  return Object.values(text).some(value => value.trim().length > 0);
}

function substituteQuantity(requirement: Requirement, rule: SubstitutionRule): Quantity | undefined {
  const ratio = rule.quantity_ratio;
  const quantity = requirement.quantity;
  if (!ratio || ratio.required_unit !== quantity.unit || quantity.unit === 'to_taste') return undefined;
  const converted: { unit: string; value?: number; min?: number; max?: number; spoon_standard?: string } = {
    unit: ratio.substitute_unit,
  };
  if (quantity.value !== undefined) converted.value = quantity.value * ratio.factor;
  if (quantity.min !== undefined) converted.min = quantity.min * ratio.factor;
  if (quantity.max !== undefined) converted.max = quantity.max * ratio.factor;
  if (ratio.substitute_unit === 'tbsp' || ratio.substitute_unit === 'tsp') converted.spoon_standard = 'metric_15ml_5ml';
  return converted;
}

function conditionPresence(prepared: PreparedCatalog, rule: SubstitutionRule, inventory: InventorySnapshot): 'present' | 'missing' | 'uncertain' {
  let uncertain = false;
  for (const ingredientId of rule.conditions.requires_available_ingredient_ids) {
    if (witnesses(prepared, inventory, ingredientId).length > 0) continue;
    if (!genericWitness(prepared, inventory, ingredientId)) return 'missing';
    uncertain = true;
  }
  return uncertain ? 'uncertain' : 'present';
}

function substitutionOptions(prepared: PreparedCatalog, recipe: Recipe, requirement: Requirement,
  inventory: InventorySnapshot, confirmations: ReadonlySet<string>): MatchOption[] {
  const options: MatchOption[] = [];
  for (const rule of rulesForRequirement(prepared, recipe, requirement)) {
    if (rule.conditions.cooking_methods.length > 0 && !rule.conditions.cooking_methods.includes(recipe.cooking_method)) continue;
    if (!hasText(rule.usage_note)) continue;
    if (requirement.importance === 'optional' && rule.level !== 'equivalent') continue;
    const conditions = conditionPresence(prepared, rule, inventory);
    if (conditions === 'missing') continue;
    const quantity = substituteQuantity(requirement, rule);
    const needsConfirmation = rule.conditions.requires_confirmation || quantity === undefined;
    const key = confirmationKey(prepared, recipe.recipe_id, rule.rule_id, inventory);
    const confirmed = !needsConfirmation || confirmations.has(key);
    const override = recipe.substitution_overrides.find(value => value.requirement_id === requirement.requirement_id
      && value.rule_id === rule.rule_id && value.action === 'allow');
    const changes = override?.step_changes ?? [];
    if (rule.step_policy === 'recipe_step_changes_required' && changes.length === 0) continue;
    const definite = witnesses(prepared, inventory, rule.substitute_ingredient_id);
    const generic = definite.length === 0 ? genericWitness(prepared, inventory, rule.substitute_ingredient_id) : undefined;
    for (const item of generic ? [generic] : definite) {
      const presence = generic || conditions === 'uncertain' || !confirmed ? 'uncertain' : 'present';
      if (presence === 'uncertain' && requirement.importance !== 'required') continue;
      options.push({ rule, changes, match: {
        ...baseMatch(requirement), presence, match_kind: 'substitution',
        inventory_item_id: item.item_id, used_ingredient_id: item.ingredient_id,
        rule_id: rule.rule_id, substitution_level: rule.level,
        ...(quantity === undefined ? {} : { quantity }), note: rule.usage_note,
        ...(needsConfirmation && !confirmed ? { confirmation_key: key } : {}),
        reason_code: generic ? 'substitute_requires_identity_confirmation'
          : conditions === 'uncertain' ? 'substitution_condition_uncertain'
          : confirmed ? 'substitution_applied' : 'substitution_requires_confirmation',
        reason_params: { ingredient_id: requirement.ingredient_id, used_ingredient_id: item.ingredient_id,
          substitute_ingredient_id: rule.substitute_ingredient_id,
          rule_id: rule.rule_id, condition_ingredient_ids: rule.conditions.requires_available_ingredient_ids },
      } });
    }
  }
  return options;
}

function fallbackOption(prepared: PreparedCatalog, requirement: Requirement, inventory: InventorySnapshot,
  omit = requirement.importance !== 'required'): MatchOption {
  const generic = genericWitness(prepared, inventory, requirement.ingredient_id);
  const missing = baseMatch(requirement);
  const available = witnesses(prepared, inventory, requirement.ingredient_id)[0];
  const match: RequirementMatch = available ? directOption(requirement, available).match : generic ? {
    ...missing, presence: 'uncertain', match_kind: 'generic',
    inventory_item_id: generic.item_id, used_ingredient_id: generic.ingredient_id,
    reason_code: 'generic_requires_confirmation',
    reason_params: { ingredient_id: requirement.ingredient_id, selected_ingredient_id: generic.ingredient_id },
  } : missing;
  if (!omit) return { match, changes: [] };
  return {
    changes: requirement.omission?.step_changes ?? [],
    match: { ...match, omitted: true, note: requirement.omission?.note,
      reason_code: `${requirement.importance}_omitted` },
  };
}

export function optionsForRequirement(prepared: PreparedCatalog, recipe: Recipe, requirement: Requirement,
  inventory: InventorySnapshot, confirmations: ReadonlySet<string>): readonly MatchOption[] {
  const direct = witnesses(prepared, inventory, requirement.ingredient_id).map(item => directOption(requirement, item));
  const substitutions = substitutionOptions(prepared, recipe, requirement, inventory, confirmations);
  const options = [...direct, ...substitutions];
  const generic = direct.length === 0 && genericWitness(prepared, inventory, requirement.ingredient_id);
  if (requirement.importance !== 'required') {
    options.push(fallbackOption(prepared, requirement, inventory));
    if (generic) options.push(fallbackOption(prepared, requirement, inventory, false));
  } else if (options.length === 0 || generic && !options.some(option => option.match.presence === 'present')) {
    options.push(fallbackOption(prepared, requirement, inventory));
  }
  return options;
}
