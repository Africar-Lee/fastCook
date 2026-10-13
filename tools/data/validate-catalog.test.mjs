import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateCatalog, fingerprint, reviewFingerprint } from './validate-catalog.mjs';
import { entityTypes } from './catalog-fingerprints.mjs';

const example = JSON.parse(readFileSync(new URL('../../docs/design/minimal-catalog.example.json', import.meta.url), 'utf8'));
const fixture = () => structuredClone(example);
const codes = result => result.errors.map(error => error.code);

function expectError(catalog, code, options) {
  const result = validateCatalog(catalog, options);
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes(code), JSON.stringify(result.errors));
  assert.ok(result.errors.every(error => error.path.startsWith('/') && error.message.length > 0));
  return result;
}

function addRule(catalog, updates = {}) {
  catalog.ingredients.push({ ...structuredClone(catalog.ingredients[0]), ingredient_id: 'tomato_alternative',
    names: { 'zh-CN': '替代测试原料' }, aliases: {} });
  const rule = { rule_id: 'tomato_replacement', scope: 'recipe', recipe_id: catalog.recipes[0].recipe_id,
    required_ingredient_id: 'tomato', substitute_ingredient_id: 'tomato_alternative', level: 'acceptable',
    conditions: { cooking_methods: ['stir_fry'], requires_available_ingredient_ids: [], requires_confirmation: true },
    usage_note: { 'zh-CN': '仅用于数据校验测试的替代说明。' }, step_policy: 'ingredient_replacement_only',
    source_ids: ['editorial_example'], review_state: 'pending_review', ...updates };
  if (rule.scope === 'global') delete rule.recipe_id;
  catalog.substitution_rules.push(rule);
  catalog.recipes[0].substitution_overrides.push({ requirement_id: 'req_tomato', rule_id: rule.rule_id,
    action: 'allow', note: { 'zh-CN': '仅用于校验测试。' }, step_changes: [] });
  return rule;
}

function reviewedFixture() {
  const catalog = fixture();
  for (const [, collection] of entityTypes) {
    for (const entity of catalog[collection]) if ('review_state' in entity) entity.review_state = 'reviewed';
  }
  catalog.sources[0].provenance.kind = 'original';
  catalog.sources[0].license = { state: 'verified', identifier: 'test-only',
    evidence_locator: 'fixtures/test-license.txt', evidence_sha256: 'a'.repeat(64) };
  let reviewIndex = 0;
  for (const [type, collection, idField] of entityTypes) {
    const checks = type === 'source' ? ['structural', 'license']
      : ['structural', 'semantic', ...(['recipe', 'substitution_rule'].includes(type) ? ['cooking'] : [])];
    for (const entity of catalog[collection]) {
      for (const check of checks) catalog.reviews.push({ review_id: `review_${reviewIndex++}`, subject_type: type,
        subject_id: entity[idField], ...reviewFingerprint(catalog, type, entity[idField]), hash_format: 'sha256_rfc8785',
        check, outcome: 'approved', reviewer: '校验测试夹具', reviewed_at: '2026-01-01T00:00:00Z',
        evidence: { 'zh-CN': '合成审核，仅用于自动化测试。' } });
    }
  }
  return catalog;
}

test('accepts the complete draft example without claiming publication', () => {
  assert.deepEqual(validateCatalog(fixture()), { valid: true, errors: [] });
});

test('returns structural errors for null, partial objects, and unexpected properties', () => {
  for (const input of [null, {}, [], { ...fixture(), unexpected: true }]) {
    const result = validateCatalog(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.every(error => error.code.startsWith('schema.')));
  }
});

test('rejects non-finite quantities and unrecognized quantity shapes', () => {
  for (const quantity of [{ value: NaN, unit: 'g' }, { value: 3, min: 1, max: 4, unit: 'g' }]) {
    const catalog = fixture();
    catalog.recipes[0].requirements[0].quantity = quantity;
    assert.equal(validateCatalog(catalog).valid, false);
  }
});

test('rejects duplicate entity IDs and recipe-local requirement or step IDs', () => {
  for (const mutate of [catalog => catalog.ingredients.push(structuredClone(catalog.ingredients[0])),
    catalog => catalog.recipes[0].requirements.push(structuredClone(catalog.recipes[0].requirements[0])),
    catalog => catalog.recipes[0].steps.push(structuredClone(catalog.recipes[0].steps[0]))]) {
    const catalog = fixture();
    mutate(catalog);
    expectError(catalog, 'id.duplicate');
  }
});

test('rejects missing dish, source, ingredient, and template references', () => {
  for (const mutate of [catalog => { catalog.recipes[0].dish_id = 'missing'; },
    catalog => { catalog.ingredients[0].source_ids = ['missing']; },
    catalog => { catalog.recipes[0].requirements[0].ingredient_id = 'missing'; },
    catalog => { catalog.pantry_templates[0].ingredient_ids = ['missing']; }]) {
    const catalog = fixture();
    mutate(catalog);
    expectError(catalog, 'reference.missing_entity');
  }
});

test('rejects taxonomy and matching cycles including self loops', () => {
  for (const field of ['taxonomy_parent_id', 'matching_parent_ids']) {
    const catalog = fixture();
    catalog.ingredients[0][field] = field === 'taxonomy_parent_id' ? 'egg' : ['egg'];
    catalog.ingredients[1][field] = field === 'taxonomy_parent_id' ? 'tomato' : ['tomato'];
    expectError(catalog, 'graph.cycle');
    catalog.ingredients[0][field] = field === 'taxonomy_parent_id' ? 'tomato' : ['tomato'];
    expectError(catalog, 'graph.cycle');
  }
});

test('accepts an acyclic matching graph without inferring taxonomy matches', () => {
  const catalog = fixture();
  catalog.ingredients[0].matching_parent_ids = ['egg'];
  catalog.ingredients[1].taxonomy_parent_id = 'tomato';
  assert.equal(validateCatalog(catalog).valid, true);
});

test('rejects unavailable locale fallback and blank translations', () => {
  const catalog = fixture();
  catalog.ingredients[0].names = { en: 'Tomato' };
  expectError(catalog, 'locale.fallback_missing');
  catalog.ingredients[0].names = { 'zh-CN': '   ' };
  expectError(catalog, 'locale.blank_text');
});

test('allows recipe text to fall back to the original locale', () => {
  const catalog = fixture();
  catalog.recipes[0].original_locale = 'en';
  catalog.recipes[0].name = { en: 'Tomato and egg' };
  assert.equal(validateCatalog(catalog).valid, true);
});

test('rejects reversed quantity ranges and accepts equal endpoints', () => {
  const catalog = fixture();
  catalog.recipes[0].requirements[0].quantity = { min: 20, max: 10, unit: 'g' };
  expectError(catalog, 'quantity.reversed_range');
  catalog.recipes[0].requirements[0].quantity.max = 20;
  assert.equal(validateCatalog(catalog).valid, true);
});

test('normalizes compatibility characters, whitespace, and case for alias collisions', () => {
  const catalog = fixture();
  catalog.ingredients[0].aliases.en = [{ text: ' ＳＯＹ   sauce ', resolution: 'automatic' }];
  catalog.ingredients[1].aliases.en = [{ text: 'soy sauce', resolution: 'needs_confirmation' }];
  expectError(catalog, 'alias.ambiguous_automatic');
  catalog.ingredients[0].aliases.en[0].resolution = 'needs_confirmation';
  assert.equal(validateCatalog(catalog).valid, true);
});

test('rejects duplicate canonical names and canonical-name alias collisions', () => {
  const catalog = fixture();
  catalog.ingredients[1].names['zh-CN'] = '番茄';
  expectError(catalog, 'alias.ambiguous_automatic');
  catalog.ingredients[1].names['zh-CN'] = '鸡蛋';
  catalog.ingredients[1].aliases['zh-CN'] = [{ text: '番茄', resolution: 'needs_confirmation' }];
  expectError(catalog, 'alias.ambiguous_automatic');
});

test('rejects implicit staples and navigation nodes in pantry templates', () => {
  const catalog = fixture();
  catalog.pantry_templates[0].ingredient_ids = ['salt'];
  expectError(catalog, 'template.ineligible_ingredient');
  catalog.pantry_templates[0].ingredient_ids = ['sugar'];
  catalog.ingredients.find(ingredient => ingredient.ingredient_id === 'sugar').selectable = false;
  expectError(catalog, 'template.ineligible_ingredient');
});

test('rejects missing step requirements and requirements unused by all steps', () => {
  const catalog = fixture();
  catalog.recipes[0].steps[0].requirement_ids.push('missing');
  expectError(catalog, 'reference.missing_requirement');
  catalog.recipes[0].steps[0].requirement_ids.pop();
  for (const step of catalog.recipes[0].steps) step.requirement_ids = step.requirement_ids.filter(id => id !== 'req_salt');
  expectError(catalog, 'steps.unused_requirement');
});

test('rejects omission references outside the recipe and duplicate step modifications', () => {
  const catalog = fixture();
  const omission = catalog.recipes[0].requirements[4].omission;
  omission.step_changes[0].step_id = 'missing';
  expectError(catalog, 'reference.missing_step');
  omission.step_changes[0].step_id = 'step_add_sugar';
  omission.step_changes.push(structuredClone(omission.step_changes[0]));
  expectError(catalog, 'steps.duplicate_change');
});

test('rejects omission plans that leave the omitted requirement in an executable step', () => {
  const catalog = fixture();
  catalog.recipes[0].steps[4].requirement_ids.push('req_sugar');
  expectError(catalog, 'omission.still_used');
});

test('rejects changes that remove all execution steps or strand another ingredient', () => {
  const catalog = fixture();
  catalog.recipes[0].requirements[4].omission.step_changes = catalog.recipes[0].steps.map(step => ({ step_id: step.step_id, action: 'skip' }));
  expectError(catalog, 'steps.empty_plan');
  catalog.recipes[0].requirements[4].omission.step_changes = [
    { step_id: 'step_add_sugar', action: 'skip' }, { step_id: 'step_finish', action: 'skip' },
  ];
  expectError(catalog, 'steps.unused_requirement');
});

test('accepts a bound ingredient-only substitution and rejects missing or equal endpoints', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  assert.equal(validateCatalog(catalog).valid, true);
  rule.substitute_ingredient_id = 'missing';
  expectError(catalog, 'reference.missing_entity');
  rule.substitute_ingredient_id = 'tomato';
  expectError(catalog, 'rule.same_endpoint');
});

test('requires recipe rules to be activated by their owning recipe', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  catalog.recipes[0].substitution_overrides = [];
  expectError(catalog, 'rule.recipe_allow_missing');
  rule.recipe_id = 'missing';
  expectError(catalog, 'reference.missing_entity');
});

test('rejects overrides that target the wrong requirement ingredient or recipe', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  catalog.recipes[0].substitution_overrides[0].requirement_id = 'req_egg';
  expectError(catalog, 'override.wrong_ingredient');
  catalog.recipes.push({ ...structuredClone(catalog.recipes[0]), recipe_id: 'other_recipe' });
  rule.recipe_id = 'other_recipe';
  expectError(catalog, 'override.wrong_recipe');
});

test('rejects duplicate and contradictory overrides even with distinct rule IDs', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  catalog.substitution_rules.push({ ...structuredClone(rule), rule_id: 'second_rule',
    conditions: { ...rule.conditions, requires_confirmation: false } });
  catalog.recipes[0].substitution_overrides.push({ requirement_id: 'req_tomato', rule_id: 'second_rule',
    action: 'forbid', note: { 'zh-CN': '拒绝测试' } });
  expectError(catalog, 'override.conflict');
});

test('rejects duplicate directed rules with the same scope and conditions', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  catalog.substitution_rules.push({ ...structuredClone(rule), rule_id: 'second_rule' });
  expectError(catalog, 'rule.duplicate');
});

test('detects duplicate rules when condition sets use different array orders', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  rule.conditions.cooking_methods = ['stir_fry', 'boil'];
  rule.conditions.requires_available_ingredient_ids = ['egg', 'salt'];
  const duplicate = { ...structuredClone(rule), rule_id: 'same_conditions' };
  duplicate.conditions.cooking_methods.reverse();
  duplicate.conditions.requires_available_ingredient_ids.reverse();
  catalog.substitution_rules.push(duplicate);
  expectError(catalog, 'rule.duplicate');
});

test('requires confirmation when replacement quantities have no applicable conversion', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  rule.conditions.requires_confirmation = false;
  expectError(catalog, 'rule.quantity_confirmation_required');
  rule.quantity_ratio = { required_unit: 'ml', substitute_unit: 'g', factor: 1 };
  expectError(catalog, 'rule.quantity_confirmation_required');
  rule.quantity_ratio.required_unit = 'g';
  assert.equal(validateCatalog(catalog).valid, true);
  rule.quantity_ratio.required_unit = 'ml';
  rule.conditions.requires_confirmation = true;
  assert.equal(validateCatalog(catalog).valid, true);
});

test('checks quantity conversion per applicable recipe for a global rule', () => {
  const catalog = fixture();
  const rule = addRule(catalog, { scope: 'global' });
  rule.conditions.requires_confirmation = false;
  rule.quantity_ratio = { required_unit: 'g', substitute_unit: 'g', factor: 1 };
  catalog.recipes[0].substitution_overrides = [];
  catalog.recipes.push({ ...structuredClone(catalog.recipes[0]), recipe_id: 'piece_recipe' });
  catalog.recipes[1].requirements[0].quantity = { value: 2, unit: 'piece' };
  expectError(catalog, 'rule.quantity_confirmation_required');
  rule.conditions.requires_confirmation = true;
  assert.equal(validateCatalog(catalog).valid, true);
});

test('does not let an active rule introduce an unlisted condition ingredient', () => {
  const catalog = fixture();
  const rule = addRule(catalog);
  rule.conditions.requires_available_ingredient_ids = ['tomato_alternative'];
  expectError(catalog, 'rule.unlisted_condition');
  rule.conditions.requires_available_ingredient_ids = ['egg'];
  assert.equal(validateCatalog(catalog).valid, true);
});

test('validates active global rule conditions while leaving poor rules inactive without allow', () => {
  const catalog = fixture();
  const rule = addRule(catalog, { scope: 'global', level: 'poor' });
  rule.conditions.requires_available_ingredient_ids = ['tomato_alternative'];
  const allow = catalog.recipes[0].substitution_overrides.pop();
  assert.equal(validateCatalog(catalog).valid, true);
  catalog.recipes[0].substitution_overrides.push(allow);
  expectError(catalog, 'rule.unlisted_condition');
  catalog.recipes[0].substitution_overrides = [];
  rule.level = 'acceptable';
  expectError(catalog, 'rule.unlisted_condition');
});

test('honors forbid when deciding which global rule conditions are applicable', () => {
  const catalog = fixture();
  const rule = addRule(catalog, { scope: 'global' });
  rule.conditions.requires_available_ingredient_ids = ['tomato_alternative'];
  catalog.recipes[0].substitution_overrides = [{ requirement_id: 'req_tomato', rule_id: rule.rule_id,
    action: 'forbid', note: { 'zh-CN': '此做法禁止使用。' } }];
  assert.equal(validateCatalog(catalog).valid, true);
});

test('requires nonempty bound edits for a step-changing substitution', () => {
  const catalog = fixture();
  addRule(catalog, { step_policy: 'recipe_step_changes_required' });
  expectError(catalog, 'override.step_policy');
  const override = catalog.recipes[0].substitution_overrides[0];
  override.step_changes = [{ step_id: 'step_prepare', action: 'replace',
    text: { 'zh-CN': '将替代原料切块，打散鸡蛋。' }, requirement_ids: ['req_tomato', 'req_egg'] }];
  assert.equal(validateCatalog(catalog).valid, true);
  override.step_changes[0].step_id = 'step_add_sugar';
  expectError(catalog, 'steps.unbound_change');
});

test('rejects no-op edits and conflicting edits from independent requirements', () => {
  const catalog = fixture();
  addRule(catalog, { step_policy: 'recipe_step_changes_required' });
  const override = catalog.recipes[0].substitution_overrides[0];
  override.step_changes = [{ ...structuredClone(catalog.recipes[0].steps[0]), action: 'replace' }];
  expectError(catalog, 'steps.noop_change');
  override.step_changes = [{ step_id: 'step_add_sugar', action: 'replace',
    text: { 'zh-CN': '替代操作' }, requirement_ids: ['req_sugar'] }];
  expectError(catalog, 'steps.conflicting_changes');
});

test('rejects review records referencing nonexistent subjects and invalid dates', () => {
  const catalog = reviewedFixture();
  catalog.reviews[0].subject_id = 'missing';
  expectError(catalog, 'reference.missing_entity');
  catalog.reviews[0].reviewed_at = '2026-02-30T00:00:00Z';
  expectError(catalog, 'schema.format');
});

test('canonical fingerprints are stable across object-key order and entity array order', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
  const catalog = fixture();
  const first = reviewFingerprint(catalog, 'recipe', catalog.recipes[0].recipe_id);
  catalog.ingredients.reverse();
  assert.deepEqual(reviewFingerprint(catalog, 'recipe', catalog.recipes[0].recipe_id), first);
  assert.equal(reviewFingerprint(catalog, 'recipe', 'missing'), null);
});

test('recipe dependency hashes change for modified sources and matching descendants', () => {
  const catalog = fixture();
  const first = reviewFingerprint(catalog, 'recipe', catalog.recipes[0].recipe_id);
  catalog.sources[0].revision.identifier = 'changed';
  const second = reviewFingerprint(catalog, 'recipe', catalog.recipes[0].recipe_id);
  assert.equal(first.subject_sha256, second.subject_sha256);
  assert.notEqual(first.dependency_sha256, second.dependency_sha256);
  const descendant = { ...structuredClone(catalog.ingredients[0]), ingredient_id: 'small_tomato',
    names: { 'zh-CN': '测试小番茄' }, aliases: {}, matching_parent_ids: ['tomato'] };
  catalog.ingredients.push(descendant);
  assert.notEqual(second.dependency_sha256,
    reviewFingerprint(catalog, 'recipe', catalog.recipes[0].recipe_id).dependency_sha256);
});

test('recipe dependency hashes include applicable global rules even without overrides', () => {
  const catalog = fixture();
  addRule(catalog, { scope: 'global' });
  catalog.recipes[0].substitution_overrides = [];
  const first = reviewFingerprint(catalog, 'recipe', catalog.recipes[0].recipe_id);
  catalog.substitution_rules[0].usage_note['zh-CN'] = '修改替代操作';
  const second = reviewFingerprint(catalog, 'recipe', catalog.recipes[0].recipe_id);
  assert.equal(first.subject_sha256, second.subject_sha256);
  assert.notEqual(first.dependency_sha256, second.dependency_sha256);
});

test('does not accept a draft or changed root state as proof of publication eligibility', () => {
  const catalog = fixture();
  expectError(catalog, 'release.entity_unreviewed', { release: true });
  for (const state of ['release_candidate', 'published']) {
    catalog.release_state = state;
    expectError(catalog, 'release.review_missing_or_rejected');
  }
});

test('requires genuine evidence-package verification even when all declared reviews match', () => {
  const catalog = reviewedFixture();
  const result = expectError(catalog, 'release.evidence_unverified', { release: true });
  assert.deepEqual(codes(result), ['release.evidence_unverified']);
});

test('rejects stale content and dependency review hashes', () => {
  for (const field of ['subject_sha256', 'dependency_sha256']) {
    const catalog = reviewedFixture();
    catalog.reviews[0][field] = '0'.repeat(64);
    expectError(catalog, 'release.review_stale', { release: true });
  }
});

test('retains historical reviews without invalidating a newer current approval', () => {
  const catalog = reviewedFixture();
  catalog.reviews.push({ ...catalog.reviews[0], review_id: 'historic_review',
    subject_sha256: '0'.repeat(64), outcome: 'rejected', reviewed_at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(codes(validateCatalog(catalog, { release: true })), ['release.evidence_unverified']);
});

test('a current rejection overrides an older approval and cannot tie-break into approval', () => {
  for (const reviewedAt of ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z']) {
    const catalog = reviewedFixture();
    catalog.reviews.push({ ...catalog.reviews[0], review_id: 'rejected_review',
      outcome: 'rejected', reviewed_at: reviewedAt });
    expectError(catalog, 'release.review_missing_or_rejected', { release: true });
  }
});

test('requires a pinned upstream snapshot before publication', () => {
  const catalog = reviewedFixture();
  catalog.sources[0].provenance.kind = 'upstream';
  expectError(catalog, 'release.snapshot_missing', { release: true });
});
