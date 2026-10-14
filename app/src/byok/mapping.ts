import type { Catalog, Ingredient } from '../../../packages/engine/src/types';
import type { VisionItem } from './types';

export type MappedVisionItem = Readonly<{
  item: VisionItem;
  candidateIds: readonly string[];
  selectedId: string | null;
  status: 'matched' | 'needs_confirmation' | 'unknown';
}>;

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function createDescendantResolver(ingredients: readonly Ingredient[]) {
  const children = new Map<string, Ingredient[]>();
  for (const ingredient of ingredients) {
    for (const parentId of ingredient.matching_parent_ids) {
      const existing = children.get(parentId) ?? [];
      existing.push(ingredient);
      children.set(parentId, existing);
    }
  }
  return (parentId: string): readonly string[] => {
    const visited = new Set([parentId]);
    const pending = [parentId];
    const selectable: string[] = [];
    for (let index = 0; index < pending.length; index++) {
      for (const child of children.get(pending[index]!) ?? []) {
        if (visited.has(child.ingredient_id)) continue;
        visited.add(child.ingredient_id);
        pending.push(child.ingredient_id);
        if (child.selectable) selectable.push(child.ingredient_id);
      }
    }
    return selectable;
  };
}

export function mapVisionItems(catalog: Pick<Catalog, 'ingredients'>, items: readonly VisionItem[]): readonly MappedVisionItem[] {
  const index = new Map<string, Map<string, boolean>>();
  const descendants = createDescendantResolver(catalog.ingredients);
  const add = (name: string, ids: readonly string[], uncertain: boolean) => {
    const normalized = normalizeName(name);
    const matches = index.get(normalized) ?? new Map<string, boolean>();
    for (const id of ids) matches.set(id, (matches.get(id) ?? false) || uncertain);
    index.set(normalized, matches);
  };
  for (const ingredient of catalog.ingredients) {
    const ids = ingredient.selectable ? [ingredient.ingredient_id] : descendants(ingredient.ingredient_id);
    for (const name of Object.values(ingredient.names)) add(name, ids, !ingredient.selectable);
    for (const aliases of Object.values(ingredient.aliases)) {
      for (const alias of aliases) add(alias.text, ids, !ingredient.selectable || alias.resolution === 'needs_confirmation');
    }
  }
  return items.map(item => {
    const matches = index.get(normalizeName(item.name));
    const candidateIds = [...(matches?.keys() ?? [])].sort();
    const matched = candidateIds.length === 1 && !matches?.get(candidateIds[0]!);
    return { item, candidateIds, selectedId: matched ? candidateIds[0]! : null, status: candidateIds.length === 0 ? 'unknown' : matched ? 'matched' : 'needs_confirmation' };
  });
}
