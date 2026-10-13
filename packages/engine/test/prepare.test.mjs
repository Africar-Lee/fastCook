import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCatalog } from '../../../tools/data/load-catalog.mjs';
import { validateCatalog } from '../../../tools/data/validate-catalog.mjs';
import { prepareCatalog, rulesForRequirement } from '../src/prepare.ts';

const loaded = await loadCatalog();
assert.equal(loaded.error, null);
const catalog = loaded.data;
const development = { allowDraft: true };

function changedCatalog(change) {
  const copy = structuredClone(catalog);
  change(copy);
  return copy;
}

function assertRejected(change, code) {
  const result = prepareCatalog(changedCatalog(change), development);
  assert.equal(result.data, null);
  assert.equal(result.error.code, code);
  assert.ok(result.error.path);
  assert.ok(result.error.message);
}

test('should_prepare_validated_seed_data_only_when_draft_use_is_explicit', () => {
  assert.equal(validateCatalog(catalog).valid, true);
  assert.equal(prepareCatalog(catalog).error.code, 'catalog.review_required');
  const prepared = prepareCatalog(catalog, development);
  assert.equal(prepared.error, null);
  assert.equal(prepared.data.catalog.recipes.length, catalog.recipes.length);
});

test('should_reject_release_candidates_even_when_draft_use_is_enabled', () => {
  assertRejected((copy) => { copy.release_state = 'release_candidate'; }, 'catalog.review_required');
});

for (const collection of ['ingredients', 'recipes', 'substitution_rules']) {
  test(`should_reject_rejected_${collection}_even_when_draft_use_is_enabled`, () => {
    assertRejected((copy) => { copy[collection][0].review_state = 'rejected'; }, 'catalog.rejected');
  });
}

test('should_reject_published_data_with_pending_review', () => {
  assertRejected((copy) => { copy.release_state = 'published'; }, 'catalog.review_required');
});

test('should_detach_and_deeply_freeze_catalog_and_readonly_indexes', () => {
  const copy = structuredClone(catalog);
  const prepared = prepareCatalog(copy, development).data;
  const originalName = prepared.catalog.ingredients[0].names['zh-CN'];
  copy.ingredients[0].names['zh-CN'] = 'changed';
  assert.equal(prepared.catalog.ingredients[0].names['zh-CN'], originalName);
  assert.throws(() => { prepared.catalog.ingredients[0].names['zh-CN'] = 'changed'; }, TypeError);
  assert.equal(prepared.ingredients.set, undefined);
  assert.equal(prepared.ancestors.get('pork_tenderloin').add, undefined);
  assert.throws(() => prepared.rulesByTarget.get('aromatic_vinegar').push({}), TypeError);
});

test('should_compute_transitive_approved_ancestry_without_taxonomy_inference', () => {
  const copy = changedCatalog((item) => {
    item.ingredients.find((ingredient) => ingredient.ingredient_id === 'pork').matching_parent_ids = ['meat'];
  });
  const prepared = prepareCatalog(copy, development).data;
  assert.deepEqual([...prepared.ancestors.get('pork_tenderloin')].sort(), ['meat', 'pork']);
  assert.deepEqual([...prepared.ancestors.get('chicken_wing')], []);
});

test('should_reject_unknown_schema_versions', () => {
  assertRejected((copy) => { copy.schema_version = '999'; }, 'catalog.schema_version');
});

for (const [collection, field] of [['ingredients', 'ingredient_id'], ['dishes', 'dish_id'], ['recipes', 'recipe_id'], ['substitution_rules', 'rule_id']]) {
  test(`should_reject_duplicate_${field}`, () => {
    assertRejected((copy) => { copy[collection][1][field] = copy[collection][0][field]; }, 'catalog.duplicate_id');
  });
}

test('should_reject_dangling_matching_edges', () => {
  assertRejected((copy) => { copy.ingredients[0].matching_parent_ids = ['missing']; }, 'catalog.missing_reference');
});

test('should_reject_cyclic_matching_edges', () => {
  assertRejected((copy) => {
    copy.ingredients.find((ingredient) => ingredient.ingredient_id === 'pork').matching_parent_ids = ['pork_tenderloin'];
  }, 'catalog.matching_cycle');
});

test('should_reject_duplicate_matching_edges', () => {
  assertRejected((copy) => { copy.ingredients[0].matching_parent_ids = ['pork', 'pork']; }, 'catalog.duplicate_edge');
});

for (const field of ['dish_id', 'ingredient_id']) {
  test(`should_reject_dangling_recipe_${field}`, () => {
    assertRejected((copy) => {
      const target = field === 'dish_id' ? copy.recipes[0] : copy.recipes[0].requirements[0];
      target[field] = 'missing';
    }, 'catalog.missing_reference');
  });
}

test('should_reject_rules_bound_to_a_missing_ingredient', () => {
  assertRejected((copy) => { copy.substitution_rules[0].substitute_ingredient_id = 'missing'; }, 'catalog.missing_reference');
});

test('should_reject_global_rules_bound_to_a_recipe', () => {
  assertRejected((copy) => { copy.substitution_rules[0].recipe_id = 'shredded_potato'; }, 'catalog.rule_scope');
});

test('should_require_explicit_allow_for_recipe_scoped_rules', () => {
  assertRejected((copy) => {
    copy.recipes.find((recipe) => recipe.recipe_id === 'kung_pao_chicken').substitution_overrides = [];
  }, 'catalog.recipe_allow_missing');
});

test('should_apply_forbid_to_every_rule_with_the_same_directed_pair', () => {
  const copy = changedCatalog((item) => {
    const duplicate = structuredClone(item.substitution_rules.find((rule) => rule.scope === 'global'));
    duplicate.rule_id = 'sub_vinegar_second_method';
    duplicate.conditions.cooking_methods.push('pan_fry');
    item.substitution_rules.push(duplicate);
  });
  assert.equal(validateCatalog(copy).valid, true);
  const prepared = prepareCatalog(copy, development).data;
  const recipe = prepared.catalog.recipes.find((item) => item.recipe_id === 'vinegar_cabbage');
  const requirement = recipe.requirements.find((item) => item.ingredient_id === 'aromatic_vinegar');
  assert.deepEqual(rulesForRequirement(prepared, recipe, requirement), []);
});

test('should_activate_global_rules_and_keep_order_stable', () => {
  const copy = changedCatalog((item) => {
    const duplicate = structuredClone(item.substitution_rules.find((rule) => rule.scope === 'global'));
    duplicate.rule_id = 'sub_a_first';
    duplicate.conditions.cooking_methods.push('pan_fry');
    item.substitution_rules.push(duplicate);
  });
  const prepared = prepareCatalog(copy, development).data;
  const recipe = prepared.catalog.recipes.find((item) => item.recipe_id === 'shredded_potato');
  const requirement = recipe.requirements.find((item) => item.ingredient_id === 'aromatic_vinegar');
  assert.deepEqual(rulesForRequirement(prepared, recipe, requirement).map((rule) => rule.rule_id),
    ['sub_a_first', 'sub_rice_vinegar_for_aromatic_vinegar']);
});

for (const change of ['poor', 'method', 'step_policy']) {
  test(`should_not_activate_a_global_rule_with_unmet_${change}_authorization`, () => {
    const copy = changedCatalog((item) => {
      const rule = item.substitution_rules.find((candidate) => candidate.scope === 'global');
      if (change === 'poor') rule.level = 'poor';
      if (change === 'method') rule.conditions.cooking_methods = ['steam'];
      if (change === 'step_policy') rule.step_policy = 'recipe_step_changes_required';
    });
    const prepared = prepareCatalog(copy, development).data;
    const recipe = prepared.catalog.recipes.find((item) => item.recipe_id === 'shredded_potato');
    const requirement = recipe.requirements.find((item) => item.ingredient_id === 'aromatic_vinegar');
    assert.deepEqual(rulesForRequirement(prepared, recipe, requirement), []);
  });
}

test('should_reject_rules_requiring_unlisted_ingredients', () => {
  assertRejected((copy) => {
    copy.substitution_rules.find((rule) => rule.scope === 'global').conditions.requires_available_ingredient_ids = ['whole_seabass'];
  }, 'catalog.unlisted_condition');
});

test('should_require_confirmation_when_quantity_ratio_does_not_apply', () => {
  assertRejected((copy) => { delete copy.substitution_rules[0].quantity_ratio; }, 'catalog.quantity_confirmation');
});

test('should_reject_forbid_overrides_with_step_mutations', () => {
  assertRejected((copy) => {
    copy.recipes.find((recipe) => recipe.recipe_id === 'vinegar_cabbage').substitution_overrides[0].step_changes = [];
  }, 'catalog.forbid_steps');
});

test('should_reject_omission_edits_referencing_missing_steps', () => {
  assertRejected((copy) => {
    const requirement = copy.recipes[0].requirements.find((item) => item.omission);
    requirement.omission.step_changes = [{ step_id: 'missing', action: 'skip' }];
  }, 'catalog.missing_reference');
});

test('should_reject_duplicate_override_records', () => {
  assertRejected((copy) => {
    const recipe = copy.recipes.find((item) => item.recipe_id === 'vinegar_cabbage');
    recipe.substitution_overrides.push(structuredClone(recipe.substitution_overrides[0]));
  }, 'catalog.duplicate_override');
});

test('should_reject_over_budget_recipes_before_inventory_evaluation', () => {
  const result = prepareCatalog(catalog, { allowDraft: true, maxPlanCombinations: 1 });
  assert.equal(result.error.code, 'catalog.plan_budget');
  assert.match(result.error.path, /^\/recipes\//u);
});

for (const maximum of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 65537]) {
  test(`should_reject_invalid_combination_budget_${maximum}`, () => {
    const result = prepareCatalog(catalog, { allowDraft: true, maxPlanCombinations: maximum });
    assert.equal(result.error.code, 'catalog.invalid_budget');
  });
}
