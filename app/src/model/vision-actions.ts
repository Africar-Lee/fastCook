import { t } from '../i18n/core.ts';
import { addIngredient } from './inventory-actions.ts';
import type { AppCatalog, KitchenState } from './types';
import { validateKitchen } from '../storage/state.ts';
import { failure } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';

export function addRecognizedIngredients(state: KitchenState, catalog: AppCatalog, ids: readonly string[]): StorageResult<KitchenState> {
  const knownIds = new Set(catalog.ingredients.filter(item => item.selectable).map(item => item.ingredient_id));
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 30 || ids.some(id => !knownIds.has(id))) {
    return failure(t('请选择对应的食材后再加入。'));
  }
  const existingIds = new Set([...state.currentIds, ...state.pantryIds]);
  const next = [...new Set(ids)].reduce((previous, id) => existingIds.has(id)
    ? previous : addIngredient(previous, catalog, id, 'current'), state);
  return validateKitchen(next, catalog);
}
