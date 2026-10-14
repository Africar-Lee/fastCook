import { t } from '../i18n/core.ts';
import { MAX_PRIVATE_RECIPES, validatePrivateRecipe } from './private-recipes.ts';
import type { AppCatalog, KitchenState } from './types';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';

export function savePrivateRecipe(state: KitchenState, catalog: AppCatalog, value: unknown, existingId?: string): StorageResult<KitchenState> {
  const checked = validatePrivateRecipe(value, catalog);
  if (checked.error !== null) return checked;
  const recipe = checked.data;
  const existing = state.privateRecipes.find(item => item.id === recipe.id);
  if (existingId !== undefined && (existingId !== recipe.id || !existing)) return failure(t('这道菜谱已不存在，请返回我的菜谱重新选择。'));
  if (existingId === undefined && existing) return failure(t('菜谱编号重复，请返回后重新新建。'));
  if (!existing && state.privateRecipes.length >= MAX_PRIVATE_RECIPES) return failure(t('最多保存 {count} 道自建菜谱，请删除不再需要的菜谱后重试。', { count: MAX_PRIVATE_RECIPES }));
  const privateRecipes = existing ? state.privateRecipes.map(item => item.id === recipe.id ? recipe : item)
    : [...state.privateRecipes, recipe];
  return success({ ...state, privateRecipes,
    sharedIngredientIds: state.mealRecipeIds.includes(recipe.id) ? [] : state.sharedIngredientIds,
  });
}

export function deletePrivateRecipe(state: KitchenState, recipeId: string): StorageResult<KitchenState> {
  if (!state.privateRecipes.some(recipe => recipe.id === recipeId)) return failure(t('这道菜谱已不存在，请返回后重新选择。'));
  const mealRecipeIds = state.mealRecipeIds.filter(id => id !== recipeId);
  return success({ ...state, privateRecipes: state.privateRecipes.filter(recipe => recipe.id !== recipeId), mealRecipeIds,
    mealPeople: mealRecipeIds.length === 0 ? state.defaultPeople : state.mealPeople,
    sharedIngredientIds: state.mealRecipeIds.includes(recipeId) ? [] : state.sharedIngredientIds,
  });
}
