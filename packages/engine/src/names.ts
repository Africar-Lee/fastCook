import { compareIds } from './inventory.ts';
import type { NameResolution, PreparedCatalog, Result } from './types.ts';

export function normalizeName(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function createNameResolver(prepared: PreparedCatalog) {
  const index = new Map<string, Map<string, boolean>>();
  const add = (locale: string, text: string, id: string, uncertain: boolean) => {
    const key = `${locale.toLowerCase()}/${normalizeName(text)}`;
    const candidates = index.get(key) ?? new Map<string, boolean>();
    candidates.set(id, (candidates.get(id) ?? false) || uncertain);
    index.set(key, candidates);
  };
  for (const ingredient of prepared.ingredients.values()) {
    if (!ingredient.selectable) continue;
    for (const [locale, name] of Object.entries(ingredient.names)) add(locale, name, ingredient.ingredient_id, false);
    for (const [locale, aliases] of Object.entries(ingredient.aliases)) {
      for (const alias of aliases) add(locale, alias.text, ingredient.ingredient_id, alias.resolution === 'needs_confirmation');
    }
  }
  return (query: unknown, locale: unknown = prepared.catalog.default_locale): Result<NameResolution> => {
    if (typeof query !== 'string' || query.length > 160 || typeof locale !== 'string' || !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(locale) || locale.length > 35) {
      return { data: null, error: { code: 'input.invalid', path: 'query', message: '食材名称或语言无效，请输入不超过 160 字的名称。' } };
    }
    const candidates = index.get(`${locale.toLowerCase()}/${normalizeName(query)}`);
    const ids = [...(candidates?.keys() ?? [])].sort(compareIds);
    const status = ids.length === 0 ? 'not_found' : ids.length > 1 || [...(candidates?.values() ?? [])].some(Boolean) ? 'needs_confirmation' : 'resolved';
    return { data: { status, ingredient_ids: ids }, error: null };
  };
}
