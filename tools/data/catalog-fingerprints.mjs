import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

export const entityTypes = [
  ['ingredient', 'ingredients', 'ingredient_id'],
  ['dish', 'dishes', 'dish_id'],
  ['recipe', 'recipes', 'recipe_id'],
  ['substitution_rule', 'substitution_rules', 'rule_id'],
  ['pantry_template', 'pantry_templates', 'template_id'],
  ['source', 'sources', 'source_id'],
];

export function fingerprint(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export function indexEntities(catalog) {
  return new Map(entityTypes.flatMap(([type, collection, idField]) =>
    catalog[collection].map((entity, index) => [
      `${type}/${entity[idField]}`,
      { subject_type: type, subject_id: entity[idField], entity, path: `/${collection}/${index}` },
    ])));
}

function ingredientDependencies(ingredient, catalog) {
  const relatives = catalog.ingredients.filter(candidate =>
    candidate.matching_parent_ids.includes(ingredient.ingredient_id));
  const identifiers = [ingredient.taxonomy_parent_id, ...ingredient.matching_parent_ids,
    ...relatives.map(candidate => candidate.ingredient_id)];
  return identifiers.filter(Boolean).map(id => `ingredient/${id}`);
}

function recipeDependencies(recipe, catalog) {
  const requirements = new Set(recipe.requirements.map(requirement => requirement.ingredient_id));
  const rules = catalog.substitution_rules.filter(rule =>
    (rule.scope === 'global' && requirements.has(rule.required_ingredient_id))
    || rule.recipe_id === recipe.recipe_id);
  return [`dish/${recipe.dish_id}`,
    ...recipe.requirements.map(requirement => `ingredient/${requirement.ingredient_id}`),
    ...rules.map(rule => `substitution_rule/${rule.rule_id}`),
    ...recipe.substitution_overrides.map(override => `substitution_rule/${override.rule_id}`)];
}

function dependencies(record, catalog) {
  const { entity, subject_type: type } = record;
  const result = (entity.source_ids ?? []).map(id => `source/${id}`);
  if (type === 'ingredient') result.push(...ingredientDependencies(entity, catalog));
  if (type === 'recipe') result.push(...recipeDependencies(entity, catalog));
  if (type === 'pantry_template') {
    result.push(...entity.ingredient_ids.map(id => `ingredient/${id}`));
  }
  if (type === 'substitution_rule') {
    result.push(...[entity.required_ingredient_id, entity.substitute_ingredient_id,
      ...entity.conditions.requires_available_ingredient_ids].map(id => `ingredient/${id}`));
    if (entity.recipe_id) result.push(`recipe/${entity.recipe_id}`);
  }
  return result;
}

export function reviewFingerprint(catalog, subjectType, subjectId, index = indexEntities(catalog)) {
  const key = `${subjectType}/${subjectId}`;
  const subject = index.get(key);
  if (!subject) return null;
  const visited = new Set([key]);
  const pending = dependencies(subject, catalog);
  const records = [];
  while (pending.length > 0) {
    const dependencyKey = pending.pop();
    if (visited.has(dependencyKey)) continue;
    visited.add(dependencyKey);
    const record = index.get(dependencyKey);
    if (!record) continue;
    records.push({ subject_type: record.subject_type, subject_id: record.subject_id, entity: record.entity });
    pending.push(...dependencies(record, catalog));
  }
  records.sort((left, right) => {
    const leftKey = `${left.subject_type}/${left.subject_id}`;
    const rightKey = `${right.subject_type}/${right.subject_id}`;
    return leftKey < rightKey ? -1 : Number(leftKey > rightKey);
  });
  return { subject_sha256: fingerprint(subject.entity), dependency_sha256: fingerprint(records) };
}
