import { localizedLabels, t } from '../i18n/core.ts';
import type { AppIngredient } from './types';

const categoryLabels: Readonly<Record<string, string>> = {
  vegetable: '蔬菜', meat: '肉类', egg: '蛋类', seafood: '水产',
  soy: '豆制品', seasoning: '调料', grain: '主食', other: '其他',
};
export const ingredientCategoryLabels = localizedLabels(categoryLabels);

type SearchEntry = Readonly<{ ingredient: AppIngredient; terms: readonly string[] }>;
type IngredientSearchIndex = readonly SearchEntry[];

export function normalizeIngredientQuery(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function createIngredientSearchIndex(ingredients: readonly AppIngredient[]): IngredientSearchIndex {
  return ingredients.filter((ingredient) => ingredient.selectable).map((ingredient) => ({
    ingredient,
    terms: [...new Set([
      ...ingredient.search_terms,
      categoryLabels[ingredient.category] ?? ingredient.category,
      t(categoryLabels[ingredient.category] ?? ingredient.category, {}, 'en'),
    ].map(normalizeIngredientQuery).filter(Boolean))],
  })).sort((left, right) => {
    const leftId = left.ingredient.ingredient_id;
    const rightId = right.ingredient.ingredient_id;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

function matchRank(terms: readonly string[], query: string): number {
  if (query.length === 0 || terms.some((term) => term === query)) return 0;
  if (terms.some((term) => term.startsWith(query))) return 1;
  return terms.some((term) => term.includes(query)) ? 2 : -1;
}

export function searchIngredients(
  index: IngredientSearchIndex,
  query: string,
  category: string | null = null,
): AppIngredient[] {
  const normalized = normalizeIngredientQuery(query);
  const matches: AppIngredient[][] = [[], [], []];
  for (const { ingredient, terms } of index) {
    if (category !== null && ingredient.category !== category) continue;
    const rank = matchRank(terms, normalized);
    if (rank >= 0) matches[rank]?.push(ingredient);
  }
  return matches.flat();
}
