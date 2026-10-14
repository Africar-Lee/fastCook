import type { Equipment } from '../../../packages/engine/src/types';
import type { AppCatalog, KitchenState } from '../model/types';
import { failure, MAX_STORAGE_CHARACTERS, success } from './types.ts';
import type { StorageResult } from './types';

const EQUIPMENT: readonly Equipment[] = ['wok', 'frying_pan', 'pot', 'steamer', 'oven', 'air_fryer', 'rice_cooker', 'microwave', 'pressure_cooker', 'electric_steamer'];
const LEGACY_FIELDS = ['schemaVersion', 'datasetVersion', 'currentIds', 'pantryIds', 'unavailableIds', 'equipment', 'equipmentConfigured', 'pantryConfigured', 'updatedAt'];
const FIELDS = [...LEGACY_FIELDS, 'defaultPeople', 'burnerCount', 'mealRecipeIds', 'mealPeople', 'sharedIngredientIds'];
const MAX_IDS = 256;

export function initialKitchen(catalog: AppCatalog): KitchenState {
  return {
    schemaVersion: 2,
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('本地厨房记录格式损坏，请重试读取或重置本地记录。');
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1 && state.schemaVersion !== 2) return failure('本地厨房记录版本暂不支持，请升级应用，或确认后重置本地记录。');
  const fields = state.schemaVersion === 1 ? LEGACY_FIELDS : FIELDS;
  if (Object.keys(state).length !== fields.length || fields.some((field) => !Object.hasOwn(state, field))) return failure('本地厨房记录字段不完整，请重试读取或重置本地记录。');
  if (typeof state.datasetVersion !== 'string' || state.datasetVersion.length < 1 || state.datasetVersion.length > 128) return failure('本地厨房记录的数据版本无效，请重置本地记录。');
  const knownIds = new Set(catalog.ingredients.filter((ingredient) => ingredient.selectable).map((ingredient) => ingredient.ingredient_id));
  for (const field of ['currentIds', 'pantryIds', 'unavailableIds']) {
    if (!uniqueKnownIds(state[field], knownIds, MAX_IDS)) return failure('本地厨房记录含未知、重复或过多的食材，请重置本地记录后重新选择。');
  }
  if (!uniqueKnownIds(state.equipment, new Set(EQUIPMENT), EQUIPMENT.length)) return failure('本地厨房记录含无效或重复的厨具，请重置本地记录。');
  if (typeof state.equipmentConfigured !== 'boolean' || typeof state.pantryConfigured !== 'boolean' || !validTimestamp(state.updatedAt)) return failure('本地厨房记录设置或更新时间无效，请重置本地记录。');
  if (!state.equipmentConfigured && state.equipment.length !== 0) return failure('本地厨具确认状态不一致，请重置本地记录。');
  if (state.schemaVersion === 2) {
    const mealError = validateMealSettings(state, knownIds, catalog);
    if (mealError !== null) return failure(mealError);
  }
  const kitchen = { ...initialKitchen(catalog), ...state, schemaVersion: 2 } as KitchenState;
  const currentIds = new Set(kitchen.currentIds);
  if (kitchen.pantryIds.some(id => currentIds.has(id))) return failure('本地记录将同一种食材同时放入了当次食材和调料柜，请确认后重置本地记录。');
  const unavailable = new Set(kitchen.unavailableIds);
  if ([...kitchen.currentIds, ...kitchen.pantryIds].some((id) => unavailable.has(id))) return failure('已有食材与明确缺少的食材发生冲突，请重新选择。');
  return success({ ...kitchen, datasetVersion: catalog.dataset_version, currentIds: [...kitchen.currentIds], pantryIds: [...kitchen.pantryIds], unavailableIds: [...kitchen.unavailableIds], equipment: [...kitchen.equipment], mealRecipeIds: [...kitchen.mealRecipeIds], sharedIngredientIds: [...kitchen.sharedIngredientIds] });
}

function validateMealSettings(state: Record<string, unknown>, knownIds: ReadonlySet<string>, catalog: AppCatalog): string | null {
  for (const field of ['defaultPeople', 'mealPeople', 'burnerCount']) {
    const value = state[field];
    const maximum = field === 'burnerCount' ? 6 : 12;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) return '本地厨房记录的人数或灶眼数量无效，请重新设置。';
  }
  const recipeIds = new Set((catalog.recipes ?? []).map(recipe => recipe.recipe_id));
  if (!uniqueKnownIds(state.mealRecipeIds, recipeIds, 5)) return '本地菜篮含未知、重复或过多的菜谱，请重新选择。';
  if (!uniqueKnownIds(state.sharedIngredientIds, knownIds, MAX_IDS)) return '本地食材共用设置无效，请重新选择。';
  const dishIds = state.mealRecipeIds.map(id => catalog.recipes.find(recipe => recipe.recipe_id === id)?.dish_id ?? id);
  if (new Set(dishIds).size !== dishIds.length) return '本地菜篮重复选择了同一道菜的不同做法，请重新选择。';
  if (state.mealRecipeIds.length === 0 && state.sharedIngredientIds.length > 0) return '空菜篮的食材共用设置无效，请重新选择。';
  return null;
}

export function decodeKitchen(raw: string | null, catalog: AppCatalog): StorageResult<KitchenState> {
  if (raw === null) return success(initialKitchen(catalog));
  if (raw.length > MAX_STORAGE_CHARACTERS) return failure('本地厨房记录过大，读取已停止，请确认后重置本地记录。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure('本地厨房记录无法解析，请重试读取或重置本地记录。');
  }
  return validateKitchen(parsed, catalog);
}
