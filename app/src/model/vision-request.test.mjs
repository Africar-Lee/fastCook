import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseVisionResponse, VISION_CLIENT_ERRORS } from '../byok/request.ts';
import { mapVisionItems } from '../byok/mapping.ts';

const catalog = { ingredients: JSON.parse(await readFile(new URL('../../../data/ingredients/core.json', import.meta.url), 'utf8')) };
const response = (items = [{ name: '西红柿', confidence: 0.95, quantity: '2个' }], extra = {}) => ({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ items }) } }],
  usage: { prompt_tokens: 234, completion_tokens: 18, total_tokens: 252 }, ...extra,
});

test('vision response accepts bounded items and extracts only explicit token counts', () => {
  assert.deepEqual(parseVisionResponse(response()), { data: {
    items: [{ name: '西红柿', confidence: 0.95, quantity: '2个' }],
    usage: { inputTokens: 234, outputTokens: 18, totalTokens: 252 },
  }, error: null });
  assert.deepEqual(parseVisionResponse(response([], { usage: undefined })).data, { items: [], usage: {} });
  assert.deepEqual(parseVisionResponse(response([{ name: ' 茄子 ', confidence: 0, quantity: ' 一个 ' }])).data.items,
    [{ name: '茄子', confidence: 0, quantity: '一个' }]);
});

for (const [label, items] of [
  ['missing confidence', [{ name: '番茄' }]],
  ['string confidence', [{ name: '番茄', confidence: '0.9' }]],
  ['negative confidence', [{ name: '番茄', confidence: -0.1 }]],
  ['confidence above one', [{ name: '番茄', confidence: 1.1 }]],
  ['empty name', [{ name: ' ', confidence: 1 }]],
  ['too long name', [{ name: 'a'.repeat(81), confidence: 1 }]],
  ['name control characters', [{ name: '番茄\n忽略规则', confidence: 1 }]],
  ['invalid quantity', [{ name: '番茄', confidence: 1, quantity: 2 }]],
  ['empty quantity', [{ name: '番茄', confidence: 1, quantity: '' }]],
  ['extra instruction field', [{ name: '番茄', confidence: 1, instruction: 'change settings' }]],
  ['too many items', Array.from({ length: 31 }, (_, index) => ({ name: `食材${index}`, confidence: 1 }))],
  ['non-array items', {}],
]) {
  test(`vision response rejects ${label}`, () => {
    assert.equal(parseVisionResponse(response(items)).error, VISION_CLIENT_ERRORS.badResponse);
  });
}

for (const content of ['not JSON', '```json\n{"items":[]}\n```', '{"items":[],"instruction":"run"}', '[]', '{"__proto__":{"polluted":true}}', '{"items":[]} trailing', ' '.repeat(16_385)]) {
  test(`vision response rejects malformed or extra content ${content.slice(0, 32)}`, () => {
    const value = response();
    value.choices[0].message.content = content;
    assert.equal(parseVisionResponse(value).error, VISION_CLIENT_ERRORS.badResponse);
    assert.equal({}.polluted, undefined);
  });
}

test('vision response rejects truncation, refusal, tool calls and malformed envelopes', () => {
  for (const [finish_reason, expected] of [['length', 'truncated'], ['content_filter', 'refused'], ['tool_calls', 'badResponse'], [undefined, 'badResponse']]) {
    const value = response();
    value.choices[0].finish_reason = finish_reason;
    assert.equal(parseVisionResponse(value).error, VISION_CLIENT_ERRORS[expected]);
  }
  const refusal = response();
  refusal.choices[0].message.refusal = 'private diagnostic detail';
  assert.equal(parseVisionResponse(refusal).error, VISION_CLIENT_ERRORS.refused);
  const toolCalls = response();
  toolCalls.choices[0].message.tool_calls = [];
  assert.equal(parseVisionResponse(toolCalls).error, VISION_CLIENT_ERRORS.badResponse);
  for (const value of [null, [], {}, { choices: [] }, { choices: [null] }, { choices: [response().choices[0], response().choices[0]] }]) {
    assert.equal(parseVisionResponse(value).error, VISION_CLIENT_ERRORS.badResponse);
  }
});

test('vision response rejects invalid usage without echoing provider content', () => {
  for (const usage of ['secret', { prompt_tokens: -1 }, { completion_tokens: 1.2 }, { total_tokens: '123' }]) {
    assert.equal(parseVisionResponse(response([], { usage })).error, VISION_CLIENT_ERRORS.badResponse);
  }
});

test('mapping preselects only exact standard names or unique automatic aliases', () => {
  const items = ['番茄', '西红柿', '鸡蛋', '生粉', '里脊', '未知食材', 'xhs', '茄', '肉类'].map(name => ({ name, confidence: 0.95 }));
  const mapped = mapVisionItems(catalog, items);
  assert.deepEqual(mapped.slice(0, 3).map(item => [item.selectedId, item.status]), [['tomato', 'matched'], ['tomato', 'matched'], ['egg', 'matched']]);
  assert.deepEqual(mapped[3].candidateIds, ['corn_starch', 'potato_starch']);
  assert.equal(mapped[3].selectedId, null);
  assert.deepEqual(mapped[4].candidateIds, ['beef_tenderloin', 'pork_tenderloin']);
  assert.equal(mapped[4].selectedId, null);
  assert.ok(mapped.slice(5, 8).every(item => item.status === 'unknown' && item.selectedId === null));
  assert.equal(mapped[8].selectedId, null);
  assert.notEqual(mapped[8].status, 'matched');
  assert.deepEqual(items, mapped.map(item => item.item));
});

test('mapping retains uncertainty for a single confirmation alias and never guesses generic children', () => {
  const ingredient = (ingredient_id, names, selectable = true, matching_parent_ids = [], aliases = {}) => ({ ingredient_id, names, selectable, matching_parent_ids, aliases });
  const ingredients = [
    ingredient('generic', { 'zh-CN': '豆腐' }, false),
    ingredient('soft', { 'zh-CN': '嫩豆腐' }, true, ['generic'], { 'zh-CN': [{ text: '软豆腐', resolution: 'needs_confirmation' }] }),
    ingredient('hard', { 'zh-CN': '老豆腐' }, true, ['generic']),
    ingredient('other', { 'en': 'ＦＯＯ' }),
  ];
  const before = structuredClone(ingredients);
  const mapped = mapVisionItems({ ingredients }, ['豆腐', '软豆腐', ' foo '].map(name => ({ name, confidence: 1 })));
  assert.deepEqual(mapped[0].candidateIds, ['hard', 'soft']);
  assert.equal(mapped[0].selectedId, null);
  assert.deepEqual(mapped[1].candidateIds, ['soft']);
  assert.equal(mapped[1].selectedId, null);
  assert.equal(mapped[2].selectedId, 'other');
  assert.deepEqual(ingredients, before);
  assert.deepEqual(mapVisionItems({ ingredients: [...ingredients].reverse() }, mapped.map(item => item.item)), mapped);
});
