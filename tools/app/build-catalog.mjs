import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadCatalog } from '../data/load-catalog.mjs';
import { validateCatalog } from '../data/validate-catalog.mjs';
import { buildIngredientSearchTerms } from './build-search-index.mjs';
import { localizeIngredients } from './localize-ingredients.mjs';

const loaded = await loadCatalog();
if (loaded.error) throw new Error(loaded.error.message);
const translations = JSON.parse(await readFile(new URL('../../data/locales/ingredients.en.json', import.meta.url), 'utf8'));
const localized = { ...loaded.data, ingredients: localizeIngredients(loaded.data.ingredients, translations) };
const validation = validateCatalog(localized);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
const catalog = {
  ...localized,
  ingredients: localized.ingredients.map((ingredient) => ({
    ...ingredient,
    search_terms: buildIngredientSearchTerms(ingredient),
  })),
};
const output = new URL('../../app/src/data/catalog.json', import.meta.url);
await mkdir(new URL('../../app/src/data/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog)}\n`, 'utf8');
console.log(`已打包 ${loaded.data.recipes.length} 个菜谱草稿，数据版本 ${loaded.data.dataset_version}。`);
