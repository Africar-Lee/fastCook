import type { AppCatalog, KitchenState } from './types';

function parents(catalog: AppCatalog, ingredientId: string): Set<string> {
  const result = new Set<string>();
  const pending = [ingredientId];
  while (pending.length) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    pending.push(...(catalog.ingredients.find(item => item.ingredient_id === id)?.matching_parent_ids ?? []));
  }
  return result;
}

export function addIngredient(state: KitchenState, catalog: AppCatalog, ingredientId: string, location: 'current' | 'pantry'): KitchenState {
  const key = location === 'current' ? 'currentIds' : 'pantryIds';
  const otherKey = location === 'current' ? 'pantryIds' : 'currentIds';
  const cleared = parents(catalog, ingredientId);
  return { ...state, [key]: [...new Set([...state[key], ingredientId])], [otherKey]: state[otherKey].filter(id => id !== ingredientId),
    unavailableIds: state.unavailableIds.filter(id => !cleared.has(id)) };
}

export function markUnavailable(state: KitchenState, catalog: AppCatalog, ingredientId: string): KitchenState {
  const affected = new Set(catalog.ingredients.filter(item => parents(catalog, item.ingredient_id).has(ingredientId)).map(item => item.ingredient_id));
  return { ...state, currentIds: state.currentIds.filter(id => !affected.has(id)), pantryIds: state.pantryIds.filter(id => !affected.has(id)),
    unavailableIds: [...new Set([...state.unavailableIds, ingredientId])] };
}
