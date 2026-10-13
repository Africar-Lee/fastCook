import { mkdir, writeFile } from 'node:fs/promises';
import { loadCatalog } from '../data/load-catalog.mjs';
import { validateCatalog } from '../data/validate-catalog.mjs';
import { buildIngredientSearchTerms } from './build-search-index.mjs';

const loaded = await loadCatalog();
if (loaded.error) throw new Error(loaded.error.message);
const validation = validateCatalog(loaded.data);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
const catalog = {
  ...loaded.data,
  ingredients: loaded.data.ingredients.map((ingredient) => ({
    ...ingredient,
    search_terms: buildIngredientSearchTerms(ingredient),
  })),
};
const output = new URL('../../app/src/data/catalog.json', import.meta.url);
await mkdir(new URL('../../app/src/data/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog)}\n`, 'utf8');
console.log(`已打包 ${loaded.data.recipes.length} 个菜谱草稿，数据版本 ${loaded.data.dataset_version}。`);
