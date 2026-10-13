import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getCommonIngredients } from './common-ingredients.ts';

const { ingredients } = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const ids = (items) => items.map((item) => item.ingredient_id);

for (const [location, firstId, minimum, maximum] of [
  ['current', 'tomato', 24, 30],
  ['pantry', 'light_soy_sauce', 16, 20],
]) {
  test(`${location} common ingredients use a bounded, ordered selection of known IDs`, () => {
    const common = getCommonIngredients(ingredients, location);
    assert.equal(common[0].ingredient_id, firstId);
    assert.ok(common.length >= minimum && common.length <= maximum);
    assert.equal(new Set(ids(common)).size, common.length);
    assert.ok(common.every((ingredient) => ingredients.includes(ingredient)));
    assert.ok(common.every((ingredient) => ingredient.selectable && !ingredient.implicit_staple));
    assert.ok(['scallion', 'ginger', 'garlic'].every((id) => ids(common).includes(id)));
  });

  test(`${location} common ordering is independent of dictionary order`, () => {
    assert.deepEqual(ids(getCommonIngredients([...ingredients].reverse(), location)), ids(getCommonIngredients(ingredients, location)));
  });

  test(`${location} common selection omits unavailable dictionary entries without adding replacements`, () => {
    const limited = ingredients.filter((ingredient) => ingredient.ingredient_id === firstId || ingredient.ingredient_id === 'cola');
    assert.deepEqual(ids(getCommonIngredients(limited, location)), [firstId]);
    assert.deepEqual(getCommonIngredients([], location), []);
  });

  test(`${location} common selection excludes entries made implicit or unselectable`, () => {
    const marked = ingredients.map((ingredient) => ({ ...ingredient, implicit_staple: ingredient.ingredient_id === firstId || ingredient.implicit_staple }));
    assert.ok(!ids(getCommonIngredients(marked, location)).includes(firstId));
    const unselectable = ingredients.map((ingredient) => ({ ...ingredient, selectable: ingredient.ingredient_id !== firstId && ingredient.selectable }));
    assert.ok(!ids(getCommonIngredients(unselectable, location)).includes(firstId));
  });

  test(`${location} common selection does not mutate its input or duplicate repeated dictionary entries`, () => {
    const before = structuredClone(ingredients);
    const frozen = Object.freeze(ingredients.map((ingredient) => Object.freeze(structuredClone(ingredient))));
    const common = getCommonIngredients(frozen, location);
    assert.deepEqual(frozen, before);
    assert.ok(common.every((ingredient) => frozen.includes(ingredient)));
    const repeated = getCommonIngredients([...ingredients, ...ingredients], location);
    assert.deepEqual(ids(repeated), ids(common));
  });
}
