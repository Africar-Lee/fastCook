import { pinyin } from 'pinyin-pro';
import { normalizeIngredientQuery } from '../../app/src/model/ingredient-search.ts';

export function buildIngredientSearchTerms(ingredient) {
  const names = [
    ...Object.values(ingredient.names),
    ...Object.values(ingredient.aliases).flat().map((alias) => alias.text),
  ];
  const terms = names.flatMap((name) => {
    const syllables = pinyin(name, { toneType: 'none', type: 'array' });
    return [name, syllables.join(''), syllables.map((syllable) => syllable[0]).join('')];
  });
  return [...new Set(terms.map(normalizeIngredientQuery).filter(Boolean))].sort();
}
