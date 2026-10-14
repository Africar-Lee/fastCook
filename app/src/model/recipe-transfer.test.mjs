import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initialKitchen, validateKitchen } from '../storage/state.ts';
import { createPrivateRecipeId } from './private-recipes.ts';
import {
  createRecipePackage, decodeRecipePackage, decodeRecipeQr, encodeRecipePackage, encodeRecipeQr,
  MAX_RECIPE_PACKAGE_BYTES, MAX_RECIPE_QR_BYTES, prepareRecipeImport, RECIPE_QR_PREFIX,
} from './recipe-transfer.ts';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const recipe = (extra = {}) => ({
  id: 'local_transfer_egg', name: '家常煮蛋', course: 'meat', cookingMethod: 'boil', timeMinutes: 10,
  servings: 2, spicyLevel: 0, equipment: ['pot'],
  ingredients: [{ ingredientId: 'egg', quantity: { unit: 'piece', value: 2 }, importance: 'required', role: 'main', consumes: true }],
  steps: [{ id: 'step_boil', text: '将鸡蛋煮至熟透。', ingredientIds: ['egg'] }], ...extra,
});
const packageOf = (recipes = [recipe()], extra = {}) => ({
  format: 'fastcook-recipes', version: 1, datasetVersion: catalog.dataset_version, recipes, ...extra,
});
const stateWith = (recipes) => ({ ...initialKitchen(catalog), privateRecipes: recipes });
const renamed = (value, id) => ({ ...value, id, steps: value.steps.map((step, index) => ({ ...step, id: `step_renamed_${index}` })) });

function optionalRecipe() {
  return recipe({ equipment: ['pot', 'steamer'], ingredients: [...recipe().ingredients, {
    ingredientId: 'salt', quantity: { unit: 'to_taste' }, importance: 'optional', role: 'seasoning', consumes: false,
    omission: { note: '不放盐。', stepChanges: [{ stepId: 'step_salt', action: 'skip' }] },
  }], steps: [...recipe().steps, { id: 'step_salt', text: '放盐。', ingredientIds: ['salt'] }] });
}

function largeRecipe(index) {
  return recipe({ id: `local_long_${index}`, name: `长菜谱 ${index}`,
    steps: Array.from({ length: 30 }, (_, step) => ({ id: `step_${step}`, text: '烹'.repeat(1000), ingredientIds: ['egg'] })),
  });
}

test('a selected recipe package round trips as a standalone whitelist of recipe data', () => {
  const source = recipe();
  Object.defineProperty(source, 'apiKey', { value: 'private-key', enumerable: false });
  const result = createRecipePackage([source], catalog);
  assert.equal(result.error, null);
  assert.deepEqual(Object.keys(result.data), ['format', 'version', 'datasetVersion', 'recipes']);
  assert.notStrictEqual(result.data.recipes[0], source);
  const encoded = encodeRecipePackage(result.data, catalog);
  assert.equal(encoded.error, null);
  assert.equal(encoded.data.includes('private-key'), false);
  assert.equal(encoded.data.includes('apiKey'), false);
  assert.equal(encoded.data.includes('currentIds'), false);
  assert.deepEqual(decodeRecipePackage(encoded.data, catalog).data, result.data);
  assert.equal(Object.isFrozen(source), false);
});

test('unknown package fields and recipe fields are rejected instead of exported', () => {
  const secret = 'do-not-export-this';
  for (const value of [packageOf(undefined, { apiKey: secret }), packageOf(undefined, { kitchen: initialKitchen(catalog) }),
    packageOf([{ ...recipe(), apiKey: secret }]), packageOf([{ ...recipe(), steps: [{ ...recipe().steps[0], secret }] }])]) {
    const encoded = encodeRecipePackage(value, catalog);
    assert.equal(encoded.data, null);
    assert.equal(encoded.error.includes(secret), false);
    assert.equal(decodeRecipePackage(JSON.stringify(value), catalog).data, null);
  }
  assert.equal(createRecipePackage([{ ...recipe(), apiKey: secret }], catalog).data, null);
});

test('invalid package formats, versions and top-level shapes are rejected', () => {
  for (const value of [null, [], 'text', {}, packageOf(undefined, { format: 'fastcook-kitchen' }),
    packageOf(undefined, { format: 'external-recipes' }), packageOf(undefined, { version: 2 }),
    packageOf(undefined, { version: '1' }), packageOf(undefined, { datasetVersion: '' }),
    packageOf(undefined, { datasetVersion: '\n' }), packageOf(undefined, { datasetVersion: 'v'.repeat(129) }),
    { format: 'fastcook-recipes', version: 1, recipes: [recipe()] }]) {
    assert.equal(decodeRecipePackage(JSON.stringify(value), catalog).data, null);
    assert.equal(encodeRecipePackage(value, catalog).data, null);
  }
});

test('invalid JSON, non-string input and truncated files produce safe errors', () => {
  for (const raw of [null, 3, {}, '', '{', '{"recipes":', 'undefined', '<html>error</html>']) {
    const result = decodeRecipePackage(raw, catalog);
    assert.equal(result.data, null);
    assert.equal(typeof result.error, 'string');
  }
});

test('packages require between one and one hundred valid recipes', () => {
  for (const values of [[], null, {}, Array(101).fill(recipe()), [recipe(), recipe()]]) {
    assert.equal(createRecipePackage(values, catalog).data, null);
  }
  const valid = Array.from({ length: 100 }, (_, index) => recipe({ id: `local_pkg_${index}`, name: `煮蛋 ${index}` }));
  assert.equal(createRecipePackage(valid, catalog).data.recipes.length, 100);
});

test('package validation rejects unknown ingredients and invalid omission references', () => {
  const unknown = recipe({ ingredients: [{ ...recipe().ingredients[0], ingredientId: 'alien_ingredient' }] });
  const optional = optionalRecipe();
  optional.ingredients[1].omission.stepChanges[0].stepId = 'step_unknown';
  for (const value of [unknown, optional]) {
    assert.equal(createRecipePackage([value], catalog).data, null);
    assert.equal(decodeRecipePackage(JSON.stringify(packageOf([value])), catalog).data, null);
  }
});

test('different dataset versions remain compatible when all standard ingredient IDs are valid', () => {
  const pkg = packageOf([recipe()], { datasetVersion: 'older-compatible-dictionary' });
  const decoded = decodeRecipePackage(JSON.stringify(pkg), catalog);
  assert.equal(decoded.error, null);
  assert.equal(decoded.data.datasetVersion, 'older-compatible-dictionary');
  const imported = prepareRecipeImport(initialKitchen(catalog), catalog, decoded.data);
  assert.equal(imported.error, null);
  assert.equal(imported.data.state.datasetVersion, catalog.dataset_version);
  assert.equal(imported.data.added, 1);
});

test('the package limit measures UTF8 bytes and accepts exactly the boundary', () => {
  const raw = JSON.stringify(packageOf());
  const bytes = new TextEncoder().encode(raw).byteLength;
  assert.equal(decodeRecipePackage(raw + ' '.repeat(MAX_RECIPE_PACKAGE_BYTES - bytes), catalog).error, null);
  assert.match(decodeRecipePackage(raw + ' '.repeat(MAX_RECIPE_PACKAGE_BYTES - bytes + 1), catalog).error, /2 MiB/);
  const unicode = JSON.stringify({ padding: '汉'.repeat(Math.ceil(MAX_RECIPE_PACKAGE_BYTES / 3)) });
  assert.ok(unicode.length < MAX_RECIPE_PACKAGE_BYTES);
  assert.match(decodeRecipePackage(unicode, catalog).error, /2 MiB/);
});

test('oversized valid recipe content cannot be created or encoded as a package', () => {
  const records = Array.from({ length: 24 }, (_, index) => largeRecipe(index));
  assert.match(createRecipePackage(records, catalog).error, /2 MiB/);
  assert.match(encodeRecipePackage(packageOf(records), catalog).error, /2 MiB/);
});

test('import preserves existing kitchen state, basket entries and recipes', () => {
  const existing = recipe({ id: 'local_existing', name: '原有菜谱' });
  const state = { ...stateWith([existing]), currentIds: ['egg'], pantryIds: ['salt'], pantryConfigured: true,
    equipmentConfigured: true, equipment: ['pot'], mealRecipeIds: [existing.id], sharedIngredientIds: ['egg'], mealPeople: 4,
    updatedAt: '2026-10-14T00:00:00.000Z' };
  const before = structuredClone(state);
  const incoming = packageOf();
  const imported = prepareRecipeImport(state, catalog, incoming);
  assert.equal(imported.error, null);
  assert.deepEqual({ added: imported.data.added, skipped: imported.data.skipped, sameNameCount: imported.data.sameNameCount },
    { added: 1, skipped: 0, sameNameCount: 0 });
  assert.deepEqual(imported.data.state.privateRecipes[0], existing);
  for (const key of Object.keys(state).filter(key => key !== 'privateRecipes')) assert.deepEqual(imported.data.state[key], state[key]);
  assert.notEqual(imported.data.state.privateRecipes[1].id, incoming.recipes[0].id);
  assert.deepEqual(state, before);
  assert.equal(validateKitchen(imported.data.state, catalog).error, null);
});

test('reimporting equal content ignores both recipe IDs and step IDs', () => {
  const first = prepareRecipeImport(initialKitchen(catalog), catalog, packageOf());
  const second = prepareRecipeImport(first.data.state, catalog, packageOf([renamed(recipe(), 'local_other_device')]));
  assert.equal(second.error, null);
  assert.equal(second.data.added, 0);
  assert.equal(second.data.skipped, 1);
  assert.strictEqual(second.data.state, first.data.state);
});

test('duplicate detection normalizes ingredient and equipment order and remaps omission step IDs', () => {
  const existing = optionalRecipe();
  const incoming = structuredClone(existing);
  incoming.id = 'local_elsewhere';
  incoming.equipment.reverse();
  incoming.ingredients.reverse();
  incoming.steps[0].id = 'step_new_cook';
  incoming.steps[1].id = 'step_new_salt';
  incoming.ingredients[0].omission.stepChanges[0].stepId = 'step_new_salt';
  const result = prepareRecipeImport(stateWith([existing]), catalog, packageOf([incoming]));
  assert.equal(result.error, null);
  assert.equal(result.data.skipped, 1);
  assert.equal(result.data.added, 0);
});

test('changed step order is distinct content and a same-name recipe is saved separately', () => {
  const existing = optionalRecipe();
  const incoming = { ...existing, id: 'local_reordered', steps: [...existing.steps].reverse() };
  const result = prepareRecipeImport(stateWith([existing]), catalog, packageOf([incoming]));
  assert.equal(result.error, null);
  assert.equal(result.data.sameNameCount, 1);
  assert.equal(result.data.added, 1);
  assert.equal(result.data.state.privateRecipes.length, 2);
  assert.deepEqual(result.data.state.privateRecipes[0], existing);
});

test('a same-ID recipe with different content never overwrites the existing recipe', () => {
  const existing = recipe();
  const incoming = recipe({ timeMinutes: 15 });
  const result = prepareRecipeImport(stateWith([existing]), catalog, packageOf([incoming]));
  assert.equal(result.error, null);
  assert.equal(result.data.sameNameCount, 1);
  assert.equal(result.data.state.privateRecipes[0].timeMinutes, 10);
  assert.equal(result.data.state.privateRecipes[1].timeMinutes, 15);
  assert.notEqual(result.data.state.privateRecipes[1].id, existing.id);
});

test('duplicates within one package are skipped and same-name alternatives are counted once each', () => {
  const values = [recipe(), renamed(recipe(), 'local_duplicate'), recipe({ id: 'local_variant', timeMinutes: 15 })];
  const result = prepareRecipeImport(initialKitchen(catalog), catalog, packageOf(values));
  assert.equal(result.error, null);
  assert.deepEqual({ added: result.data.added, skipped: result.data.skipped, sameNameCount: result.data.sameNameCount },
    { added: 2, skipped: 1, sameNameCount: 1 });
});

test('generated ID collisions receive a unique suffix without overwriting records', (context) => {
  context.mock.method(Date, 'now', () => 123456789);
  context.mock.method(Math, 'random', () => 0.5);
  const collision = createPrivateRecipeId();
  const existing = recipe({ id: collision, name: '原有菜谱' });
  const result = prepareRecipeImport(stateWith([existing]), catalog, packageOf([
    recipe(), recipe({ id: 'local_second', name: '另一道菜' }),
  ]));
  assert.equal(result.error, null);
  assert.deepEqual(result.data.state.privateRecipes.map(item => item.id), [collision, `${collision}_1`, `${collision}_2`]);
});

test('capacity failures reject the entire batch after duplicate checks without changing state', () => {
  const records = Array.from({ length: 99 }, (_, index) => recipe({ id: `local_capacity_${index}`, name: `菜谱 ${index}` }));
  const state = stateWith(records);
  const before = structuredClone(state);
  const result = prepareRecipeImport(state, catalog, packageOf([
    renamed(records[0], 'local_existing_copy'), recipe(), recipe({ id: 'local_too_many', name: '第 101 道' }),
  ]));
  assert.match(result.error, /100 道/);
  assert.equal(result.data, null);
  assert.deepEqual(state, before);
});

test('a full collection can still import an entirely duplicate package as a no-op', () => {
  const records = Array.from({ length: 100 }, (_, index) => recipe({ id: `local_full_${index}`, name: `菜谱 ${index}` }));
  const state = stateWith(records);
  const result = prepareRecipeImport(state, catalog, packageOf([renamed(records[0], 'local_duplicate_full')]));
  assert.equal(result.error, null);
  assert.equal(result.data.skipped, 1);
  assert.strictEqual(result.data.state, state);
});

test('a batch that would exceed kitchen byte capacity is rejected atomically', () => {
  const state = stateWith(Array.from({ length: 15 }, (_, index) => largeRecipe(index)));
  assert.equal(validateKitchen(state, catalog).error, null);
  const before = JSON.stringify(state);
  const incoming = createRecipePackage(Array.from({ length: 10 }, (_, index) => largeRecipe(index + 15)), catalog);
  assert.equal(incoming.error, null);
  const result = prepareRecipeImport(state, catalog, incoming.data);
  assert.equal(result.data, null);
  assert.match(result.error, /2 MiB/);
  assert.equal(JSON.stringify(state), before);
});

test('malformed packages or invalid existing state leave all original records untouched', () => {
  const state = stateWith([recipe()]);
  const before = structuredClone(state);
  for (const pkg of [null, packageOf([], {}), packageOf([{ ...recipe(), name: '' }]), packageOf(undefined, { secret: 'private' })]) {
    assert.equal(prepareRecipeImport(state, catalog, pkg).data, null);
    assert.deepEqual(state, before);
  }
  const invalid = { ...state, currentIds: ['unknown'] };
  assert.match(prepareRecipeImport(invalid, catalog, packageOf()).error, /厨房记录/);
  assert.deepEqual(invalid.currentIds, ['unknown']);
});

test('a single short recipe round trips through its prefixed QR payload', () => {
  const encoded = encodeRecipeQr(packageOf(), catalog);
  assert.equal(encoded.error, null);
  assert.ok(encoded.data.startsWith(RECIPE_QR_PREFIX));
  const decoded = decodeRecipeQr(encoded.data, catalog);
  assert.equal(decoded.error, null);
  assert.deepEqual(decoded.data, packageOf());
});

test('QR payloads accept exactly 1800 UTF8 bytes and reject one additional byte', () => {
  const value = recipe({ steps: [{ ...recipe().steps[0], text: '煮'.repeat(200) }] });
  const original = `${RECIPE_QR_PREFIX}${encodeRecipePackage(packageOf([value]), catalog).data}`;
  const extraBytes = MAX_RECIPE_QR_BYTES - new TextEncoder().encode(original).byteLength;
  assert.ok(extraBytes > 0 && value.steps[0].text.length + extraBytes < 1000);
  value.steps[0].text += 'a'.repeat(extraBytes);
  const encoded = encodeRecipeQr(packageOf([value]), catalog);
  assert.equal(encoded.error, null);
  assert.equal(new TextEncoder().encode(encoded.data).byteLength, MAX_RECIPE_QR_BYTES);
  assert.ok(encoded.data.length < MAX_RECIPE_QR_BYTES);
  assert.equal(decodeRecipeQr(encoded.data, catalog).error, null);
  assert.match(decodeRecipeQr(`${encoded.data} `, catalog).error, /文件导入/);
  value.steps[0].text += 'b';
  assert.match(encodeRecipeQr(packageOf([value]), catalog).error, /文件分享/);
});

test('QR export and import reject multiple recipes and unsupported or foreign payloads', () => {
  const multiple = packageOf([recipe(), recipe({ id: 'local_other', name: '另一道菜' })]);
  assert.match(encodeRecipeQr(multiple, catalog).error, /只能分享一道/);
  assert.match(decodeRecipeQr(`${RECIPE_QR_PREFIX}${JSON.stringify(multiple)}`, catalog).error, /只能包含一道/);
  for (const raw of [null, {}, 'https://example.com/recipe', 'fastcook:recipe:2:{}', 'plain text', 'fastcook:recipe:1:{']) {
    assert.equal(decodeRecipeQr(raw, catalog).data, null);
  }
});
