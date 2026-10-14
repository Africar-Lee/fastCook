import { addIngredient } from './inventory-actions.ts';
import type { AppCatalog, KitchenState } from './types';

export function isNewKitchen(state: KitchenState): boolean {
  return state.updatedAt === null && !state.pantryConfigured && !state.equipmentConfigured
    && state.currentIds.length === 0 && state.pantryIds.length === 0
    && state.unavailableIds.length === 0 && state.equipment.length === 0;
}

export function pantrySetupChoices(catalog: AppCatalog, state: KitchenState): readonly string[] {
  const template = catalog.pantry_templates.find(item => item.template_id === 'cn_basic');
  const current = new Set(state.currentIds);
  return [...new Set([...(template?.ingredient_ids ?? []).filter(id => !current.has(id)), ...state.pantryIds])];
}

function isUnavailable(catalog: AppCatalog, ingredientId: string, unavailable: ReadonlySet<string>): boolean {
  const visited = new Set<string>();
  const pending = [ingredientId];
  while (pending.length) {
    const id = pending.pop()!;
    if (unavailable.has(id)) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(catalog.ingredients.find(item => item.ingredient_id === id)?.matching_parent_ids ?? []));
  }
  return false;
}

export function excludeUnavailableSelections(catalog: AppCatalog, selectedIds: readonly string[],
  unavailableIds: readonly string[]): readonly string[] {
  const unavailable = new Set(unavailableIds);
  return selectedIds.filter(id => !isUnavailable(catalog, id, unavailable));
}

export function initialPantrySelection(catalog: AppCatalog, state: KitchenState): readonly string[] {
  const owned = new Set(state.pantryIds);
  const unavailable = new Set(state.unavailableIds);
  return pantrySetupChoices(catalog, state).filter(id => owned.has(id) || !isUnavailable(catalog, id, unavailable));
}

export function completePantrySetup(state: KitchenState, catalog: AppCatalog, selectedIds: readonly string[],
  equipment: KitchenState['equipment']): KitchenState {
  const configured: KitchenState = {
    ...state,
    pantryIds: [],
    pantryConfigured: true,
    equipment: state.equipmentConfigured ? state.equipment : [...equipment],
    equipmentConfigured: true,
  };
  return selectedIds.reduce((next, id) => addIngredient(next, catalog, id, 'pantry'), configured);
}
