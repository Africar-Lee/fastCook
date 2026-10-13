import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIngredientSearchTerms } from '../../../tools/app/build-search-index.mjs';
import { createIngredientSearchIndex, normalizeIngredientQuery, searchIngredients } from './ingredient-search.ts';

const source = JSON.parse(await readFile(new URL('../../../data/ingredients/core.json', import.meta.url), 'utf8'));
const ingredients = source.map((ingredient) => ({ ...ingredient, search_terms: buildIngredientSearchTerms(ingredient) }));
const index = createIngredientSearchIndex(ingredients);
const ids = (matches) => matches.map((ingredient) => ingredient.ingredient_id);

for (const [query, expected] of [
  ['xhs', ['tomato']],
  ['jd', ['egg']],
  ['xihongshi', ['tomato']],
  ['番茄', ['tomato']],
  ['西红柿', ['tomato']],
  ['malingshu', ['potato', 'potato_starch']],
  ['qiezi', ['eggplant']],
  ['qz', ['eggplant']],
]) {
  test(`finds ingredients using ${query}`, () => {
    assert.deepEqual(ids(searchIngredients(index, query)), expected);
  });
}

for (const query of ['生粉', 'shengfen', 'sf']) {
  test(`retains both starch candidates for ${query}`, () => {
    assert.deepEqual(ids(searchIngredients(index, query)), ['corn_starch', 'potato_starch']);
  });
}

for (const query of ['里脊', 'liji']) {
  test(`retains both tenderloin candidates for ${query}`, () => {
    const matches = ids(searchIngredients(index, query));
    assert.deepEqual(matches.slice(0, 2), ['beef_tenderloin', 'pork_tenderloin']);
    assert.equal(matches.filter((id) => id.endsWith('tenderloin')).length, 2);
  });
}

test('preserves all candidates when initials overlap with other ingredients', () => {
  assert.deepEqual(ids(searchIngredients(index, 'lj')), ['beef_tenderloin', 'cooking_wine', 'pork_tenderloin', 'dried_chili']);
});

test('normalizes case, full-width text and whitespace before searching', () => {
  assert.equal(normalizeIngredientQuery(' ＸＩ ＨＯＮＧ\tＳＨＩ\n'), 'xihongshi');
  for (const query of ['XHS', ' ｘ ｈ ｓ ', '西 红 柿', '\tXi Hong Shi\n']) {
    assert.deepEqual(ids(searchIngredients(index, query)), ['tomato']);
  }
});

test('returns every selectable ingredient for empty queries in fixed ID order', () => {
  const expected = ingredients.filter((ingredient) => ingredient.selectable).map((ingredient) => ingredient.ingredient_id).sort();
  assert.deepEqual(ids(searchIngredients(index, '')), expected);
  assert.deepEqual(ids(searchIngredients(index, ' \t ')), expected);
  assert.ok(!expected.includes('meat'));
});

test('returns no matches when query or selected category has no candidates', () => {
  assert.deepEqual(searchIngredients(index, 'not-an-ingredient'), []);
  assert.deepEqual(searchIngredients(index, '', 'unknown'), []);
  assert.deepEqual(searchIngredients(index, 'xhs', 'meat'), []);
});

test('intersects category filters with queries and keeps category-name search', () => {
  assert.deepEqual(ids(searchIngredients(index, 'xhs', 'vegetable')), ['tomato']);
  const vegetables = ingredients.filter((ingredient) => ingredient.selectable && ingredient.category === 'vegetable').map((ingredient) => ingredient.ingredient_id).sort();
  assert.deepEqual(ids(searchIngredients(index, '', 'vegetable')), vegetables);
  assert.deepEqual(ids(searchIngredients(index, '蔬菜')), vegetables);
  assert.deepEqual(searchIngredients(index, '蔬菜', 'meat'), []);
});

test('ranks exact matches before prefixes and substrings, with stable ID ties', () => {
  const base = ingredients[0];
  const custom = createIngredientSearchIndex([
    { ...base, ingredient_id: 'a_substring', selectable: true, search_terms: ['xxabcdyy'] },
    { ...base, ingredient_id: 'y_prefix', selectable: true, search_terms: ['abcdef'] },
    { ...base, ingredient_id: 'z_exact', selectable: true, search_terms: ['abcd'] },
    { ...base, ingredient_id: 'b_prefix', selectable: true, search_terms: ['abcdzz'] },
    { ...base, ingredient_id: 'excluded', selectable: false, search_terms: ['abcd'] },
  ]);
  assert.deepEqual(ids(searchIngredients(custom, 'abcd')), ['z_exact', 'b_prefix', 'y_prefix', 'a_substring']);
});

test('produces the same order regardless of catalog order and leaves inputs unchanged', () => {
  const before = structuredClone(ingredients);
  const reversed = [...ingredients].reverse();
  const reversedIndex = createIngredientSearchIndex(reversed);
  for (const query of ['', 'liji', 'shengfen', '粉', 'j']) {
    assert.deepEqual(ids(searchIngredients(reversedIndex, query)), ids(searchIngredients(index, query)));
  }
  assert.deepEqual(ingredients, before);
  assert.deepEqual(reversed, [...before].reverse());
});
