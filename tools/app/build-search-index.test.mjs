import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildIngredientSearchTerms } from './build-search-index.mjs';
import { normalizeIngredientQuery } from '../../app/src/model/ingredient-search.ts';

const ingredients = JSON.parse(await readFile(new URL('../../data/ingredients/core.json', import.meta.url), 'utf8'));
const byId = new Map(ingredients.map((ingredient) => [ingredient.ingredient_id, ingredient]));

test('includes every standard name and alias without resolving ambiguous aliases', () => {
  for (const ingredient of ingredients) {
    const terms = buildIngredientSearchTerms(ingredient);
    const names = [...Object.values(ingredient.names), ...Object.values(ingredient.aliases).flat().map((alias) => alias.text)];
    for (const name of names) assert.ok(terms.includes(normalizeIngredientQuery(name)), `${ingredient.ingredient_id}: ${name}`);
  }
  for (const id of ['corn_starch', 'potato_starch']) {
    const terms = buildIngredientSearchTerms(byId.get(id));
    for (const term of ['生粉', 'shengfen', 'sf']) assert.ok(terms.includes(term), `${id}: ${term}`);
  }
});

test('generates correct full pinyin and initials for ingredient names and aliases', () => {
  const expected = {
    tomato: ['番茄', 'fanqie', 'fq', '西红柿', 'xihongshi', 'xhs'],
    egg: ['鸡蛋', 'jidan', 'jd'],
    potato: ['土豆', 'tudou', 'td', '马铃薯', 'malingshu', 'mls'],
    eggplant: ['茄子', 'qiezi', 'qz'],
    pork_tenderloin: ['猪里脊', 'zhuliji', 'zlj', '里脊肉', 'lijirou', 'ljr', '里脊', 'liji', 'lj'],
    beef_tenderloin: ['牛里脊', 'niuliji', 'nlj', '里脊肉', 'lijirou', 'ljr', '里脊', 'liji', 'lj'],
  };
  for (const [id, terms] of Object.entries(expected)) {
    assert.deepEqual(buildIngredientSearchTerms(byId.get(id)), terms.sort());
  }
});

test('normalizes and deduplicates terms in deterministic order without changing source data', () => {
  const source = {
    names: { 'zh-CN': '西红柿', en: ' ＴＯＭＡＴＯ ' },
    aliases: { 'zh-CN': [{ text: '西红柿', resolution: 'automatic' }, { text: '西 红 柿', resolution: 'automatic' }] },
  };
  const before = structuredClone(source);
  const first = buildIngredientSearchTerms(source);
  const reversed = { names: Object.fromEntries(Object.entries(source.names).reverse()), aliases: { 'zh-CN': [...source.aliases['zh-CN']].reverse() } };
  assert.deepEqual(buildIngredientSearchTerms(reversed), first);
  assert.deepEqual(buildIngredientSearchTerms(source), first);
  assert.deepEqual(first, [...new Set(first)].sort());
  assert.ok(first.includes('tomato'));
  assert.ok(first.includes('xihongshi'));
  assert.ok(first.includes('xhs'));
  assert.deepEqual(source, before);
});
