import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRecipeReport, MAX_REPORT_DESCRIPTION_LENGTH, reportCategoryLabels } from './recipe-report.ts';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const appVersion = '0.1.0';
const input = { category: 'ingredients', description: '鸡蛋的数量需要核对。' };
const report = (value = input) => createRecipeReport(catalog, 'tomato_egg', appVersion, value);

test('includes the selected recipe identity and application and dataset versions', () => {
  const recipe = catalog.recipes.find(item => item.recipe_id === 'howtocook_onion_egg');
  const result = createRecipeReport(catalog, recipe.recipe_id, appVersion, input);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, {
    schema_version: 1,
    app_version: appVersion,
    dataset_version: catalog.dataset_version,
    recipe: { recipe_id: recipe.recipe_id, dish_id: recipe.dish_id, name: recipe.name['zh-CN'], source_ids: recipe.source_ids },
    issue: input,
  });
  assert.notEqual(result.data.recipe.source_ids, recipe.source_ids);
});

test('trims surrounding whitespace and preserves Chinese text and internal line breaks', () => {
  const description = '第一步中的用量与用料表不同。\n请核对盐的克数。';
  const result = report({ category: 'steps', description: ` \n${description}\n ` });
  assert.equal(result.error, null);
  assert.equal(JSON.parse(JSON.stringify(result.data)).issue.description, description);
});

for (const category of Object.keys(reportCategoryLabels)) {
  test(`accepts the ${category} issue category`, () => {
    const result = report({ ...input, category });
    assert.equal(result.error, null);
    assert.equal(result.data.issue.category, category);
  });
}

test('accepts a description exactly at the length limit', () => {
  const result = report({ ...input, description: '盐'.repeat(MAX_REPORT_DESCRIPTION_LENGTH) });
  assert.equal(result.error, null);
  assert.equal(result.data.issue.description.length, MAX_REPORT_DESCRIPTION_LENGTH);
});

for (const [label, value] of [
  ['missing input', undefined], ['null input', null], ['array input', []], ['text input', '食材'],
  ['missing category', { description: input.description }],
  ['unknown category', { ...input, category: 'unknown' }],
  ['inherited category name', { ...input, category: 'toString' }],
  ['non-text category', { ...input, category: 1 }],
  ['missing description', { category: 'ingredients' }],
  ['non-text description', { ...input, description: 1 }],
  ['empty description', { ...input, description: '' }],
  ['whitespace description', { ...input, description: ' \t\n　' }],
  ['oversized description', { ...input, description: '盐'.repeat(MAX_REPORT_DESCRIPTION_LENGTH + 1) }],
]) {
  test(`rejects ${label} without creating a report`, () => {
    const result = createRecipeReport(catalog, 'tomato_egg', appVersion, value);
    assert.equal(result.data, null);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });
}

test('rejects an unknown or invalid recipe without reporting a different dish', () => {
  for (const recipeId of ['unknown_recipe', '', 'a'.repeat(129), null]) {
    const result = createRecipeReport(catalog, recipeId, appVersion, input);
    assert.equal(result.data, null);
    assert.match(result.error, /菜谱/);
  }
});

test('rejects missing or unbounded application version metadata', () => {
  for (const version of ['', '  ', 'a'.repeat(129), null]) {
    const result = createRecipeReport(catalog, 'tomato_egg', version, input);
    assert.equal(result.data, null);
    assert.match(result.error, /应用版本/);
  }
});

test('includes only explicit report fields and excludes attached kitchen data and metadata overrides', () => {
  const extra = {
    currentIds: ['private_current'], pantryIds: ['private_pantry'], equipment: ['private_equipment'],
    updatedAt: 'private_timestamp', app_version: 'private_override', recipe: { recipe_id: 'private_recipe' },
    source: { locator: 'private_location' },
  };
  extra.inventory = extra;
  const result = report({ ...input, ...extra });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, report().data);
  assert.equal(JSON.stringify(result.data).includes('private_'), false);
});

test('uses the available recipe name when the Chinese name is absent', () => {
  const translated = { ...catalog, recipes: catalog.recipes.map(recipe => recipe.recipe_id === 'tomato_egg'
    ? { ...recipe, name: { en: 'Tomato and eggs' } } : recipe) };
  const result = createRecipeReport(translated, 'tomato_egg', appVersion, input);
  assert.equal(result.error, null);
  assert.equal(result.data.recipe.name, 'Tomato and eggs');
});
