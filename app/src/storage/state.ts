import { t } from '../i18n/core.ts';
import type { Equipment } from '../../../packages/engine/src/types';
import type { AppCatalog, KitchenState } from '../model/types';
import { mergePrivateRecipes, validatePrivateRecipes } from '../model/private-recipes.ts';
import { failure, success, withinStorageLimit } from './types.ts';
import type { StorageResult } from './types';

const EQUIPMENT: readonly Equipment[] = ['wok', 'frying_pan', 'pot', 'steamer', 'oven', 'air_fryer', 'rice_cooker', 'microwave', 'pressure_cooker', 'electric_steamer'];
const LEGACY_FIELDS = ['schemaVersion', 'datasetVersion', 'currentIds', 'pantryIds', 'unavailableIds', 'equipment', 'equipmentConfigured', 'pantryConfigured', 'updatedAt'];
const VERSION_TWO_FIELDS = [...LEGACY_FIELDS, 'defaultPeople', 'burnerCount', 'mealRecipeIds', 'mealPeople', 'sharedIngredientIds'];
const FIELDS = [...VERSION_TWO_FIELDS, 'privateRecipes'];
const MAX_IDS = 256;

export function initialKitchen(catalog: AppCatalog): KitchenState {
  return {
    schemaVersion: 3,
    datasetVersion: catalog.dataset_version,
    currentIds: [],
    pantryIds: [],
    unavailableIds: [],
    equipment: [],
    equipmentConfigured: false,
    pantryConfigured: false,
    defaultPeople: 2,
    burnerCount: 2,
    mealRecipeIds: [],
    mealPeople: 2,
    sharedIngredientIds: [],
    privateRecipes: [],
    updatedAt: null,
  };
}

function uniqueKnownIds(value: unknown, knownIds: ReadonlySet<string>, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum
    && value.every((item: unknown) => typeof item === 'string' && knownIds.has(item))
    && new Set(value).size === value.length;
}

export function validTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function validateKitchen(value: unknown, catalog: AppCatalog): StorageResult<KitchenState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure(t('本地厨房记录格式损坏，请重试读取或重置本地记录。'));
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1 && state.schemaVersion !== 2 && state.schemaVersion !== 3) return failure(t('本地厨房记录版本暂不支持，请升级应用，或确认后重置本地记录。'));
  const fields = state.schemaVersion === 1 ? LEGACY_FIELDS : state.schemaVersion === 2 ? VERSION_TWO_FIELDS : FIELDS;
  if (Object.keys(state).length !== fields.length || fields.some((field) => !Object.hasOwn(state, field))) return failure(t('本地厨房记录字段不完整，请重试读取或重置本地记录。'));
  if (typeof state.datasetVersion !== 'string' || state.datasetVersion.length < 1 || state.datasetVersion.length > 128) return failure(t('本地厨房记录的数据版本无效，请重置本地记录。'));
  const knownIds = new Set(catalog.ingredients.filter((ingredient) => ingredient.selectable).map((ingredient) => ingredient.ingredient_id));
  for (const field of ['currentIds', 'pantryIds', 'unavailableIds']) {
    if (!uniqueKnownIds(state[field], knownIds, MAX_IDS)) return failure(t('本地厨房记录含未知、重复或过多的食材，请重置本地记录后重新选择。'));
  }
  if (!uniqueKnownIds(state.equipment, new Set(EQUIPMENT), EQUIPMENT.length)) return failure(t('本地厨房记录含无效或重复的厨具，请重置本地记录。'));
  if (typeof state.equipmentConfigured !== 'boolean' || typeof state.pantryConfigured !== 'boolean' || !validTimestamp(state.updatedAt)) return failure(t('本地厨房记录设置或更新时间无效，请重置本地记录。'));
  if (!state.equipmentConfigured && state.equipment.length !== 0) return failure(t('本地厨具确认状态不一致，请重置本地记录。'));
  const privateRecipes = validatePrivateRecipes(state.schemaVersion === 3 ? state.privateRecipes : [], catalog);
  if (privateRecipes.error !== null) return privateRecipes;
  if (state.schemaVersion !== 1) {
    const combinedCatalog = privateRecipes.data.length > 0 ? mergePrivateRecipes(catalog, privateRecipes.data) : catalog;
    const mealError = validateMealSettings(state, knownIds, combinedCatalog);
    if (mealError !== null) return failure(mealError);
  }
  const kitchen = { ...initialKitchen(catalog), ...state, schemaVersion: 3, privateRecipes: privateRecipes.data } as KitchenState;
  const currentIds = new Set(kitchen.currentIds);
  if (kitchen.pantryIds.some(id => currentIds.has(id))) return failure(t('本地记录将同一种食材同时放入了当次食材和调料柜，请确认后重置本地记录。'));
  const unavailable = new Set(kitchen.unavailableIds);
  if ([...kitchen.currentIds, ...kitchen.pantryIds].some((id) => unavailable.has(id))) return failure(t('已有食材与明确缺少的食材发生冲突，请重新选择。'));
  if (!withinStorageLimit(JSON.stringify(kitchen))) return failure(t('厨房记录超过 2 MiB，请减少自建菜谱内容后重试。'));
  return success({ ...kitchen, datasetVersion: catalog.dataset_version, currentIds: [...kitchen.currentIds], pantryIds: [...kitchen.pantryIds], unavailableIds: [...kitchen.unavailableIds], equipment: [...kitchen.equipment], mealRecipeIds: [...kitchen.mealRecipeIds], sharedIngredientIds: [...kitchen.sharedIngredientIds] });
}

function validateMealSettings(state: Record<string, unknown>, knownIds: ReadonlySet<string>, catalog: AppCatalog): string | null {
  for (const field of ['defaultPeople', 'mealPeople', 'burnerCount']) {
    const value = state[field];
    const maximum = field === 'burnerCount' ? 6 : 12;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) return t('本地厨房记录的人数或灶眼数量无效，请重新设置。');
  }
  const recipeIds = new Set((catalog.recipes ?? []).map(recipe => recipe.recipe_id));
  if (!uniqueKnownIds(state.mealRecipeIds, recipeIds, 5)) return t('本地菜篮含未知、重复或过多的菜谱，请重新选择。');
  if (!uniqueKnownIds(state.sharedIngredientIds, knownIds, MAX_IDS)) return t('本地食材共用设置无效，请重新选择。');
  const dishIds = state.mealRecipeIds.map(id => catalog.recipes.find(recipe => recipe.recipe_id === id)?.dish_id ?? id);
  if (new Set(dishIds).size !== dishIds.length) return t('本地菜篮重复选择了同一道菜的不同做法，请重新选择。');
  if (state.mealRecipeIds.length === 0 && state.sharedIngredientIds.length > 0) return t('空菜篮的食材共用设置无效，请重新选择。');
  return null;
}

export function decodeKitchen(raw: string | null, catalog: AppCatalog): StorageResult<KitchenState> {
  if (raw === null) return success(initialKitchen(catalog));
  if (!withinStorageLimit(raw)) return failure(t('本地厨房记录超过 2 MiB，读取已停止，请确认后重置本地记录。'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure(t('本地厨房记录无法解析，请重试读取或重置本地记录。'));
  }
  return validateKitchen(parsed, catalog);
}
