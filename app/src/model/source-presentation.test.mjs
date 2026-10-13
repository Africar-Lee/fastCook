import assert from 'node:assert/strict';
import test from 'node:test';
import { safeSourceUrl, sourceLinks } from './source-presentation.ts';

const original = 'https://github.com/Anduin2017/HowToCook/blob/abc123/dishes/西红柿炒鸡蛋.md';
const license = 'https://raw.githubusercontent.com/Anduin2017/HowToCook/abc123/LICENSE';

test('accepts HTTPS recipe and license URLs on the allowed hosts', () => {
  assert.equal(safeSourceUrl(original), new URL(original).href);
  assert.equal(safeSourceUrl(license), license);
});

for (const value of [
  undefined, null, {}, '', 'data/recipes/tomato_egg.json',
  'file:///tmp/LICENSE', 'javascript:alert(1)', 'http://github.com/recipe', '//github.com/recipe',
  'https://github.com.example.com/recipe', 'https://example.com/github.com/recipe',
  'https://github.com@evil.example/recipe', 'https://evil@github.com/recipe',
  'https://github.com:8443/recipe', 'https://github.com./recipe',
  'https://github.com\\evil.example/recipe', 'https://github.com/\nrecipe',
  ' https://github.com/recipe', 'https://[invalid', `https://github.com/${'a'.repeat(2048)}`,
]) {
  test(`rejects unsafe or unsupported source URL ${String(value).slice(0, 80)}`, () => {
    assert.equal(safeSourceUrl(value), null);
  });
}

test('provides upstream original and license links independently', () => {
  const source = { provenance: { kind: 'upstream', locator: original }, license: { evidence_locator: license } };
  assert.deepEqual(sourceLinks(source), { original: new URL(original).href, license });
  assert.deepEqual(sourceLinks({ ...source, license: {} }), { original: new URL(original).href, license: null });
});

test('does not open editorial draft paths even when they contain an allowed URL', () => {
  assert.deepEqual(sourceLinks({ provenance: { kind: 'editorial_draft', locator: original }, license: { evidence_locator: license } }), {
    original: null, license: null,
  });
});
