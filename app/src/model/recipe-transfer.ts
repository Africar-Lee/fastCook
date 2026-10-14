import { t } from '../i18n/core.ts';
import { validateKitchen } from '../storage/state.ts';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import { createPrivateRecipeId, MAX_PRIVATE_RECIPES, mergePrivateRecipes, validatePrivateRecipes } from './private-recipes.ts';
import { collectRecipeImages, EMPTY_RECIPE_MEDIA, MAX_MEDIA_PACKAGE_BYTES, validateImageAssets, validateRecipeMediaMap } from './recipe-media.ts';
import type { RecipeImageAsset, RecipeMedia, RecipeMediaMap } from './recipe-media';
import type { PrivateRecipe, PrivateRecipeIngredient } from './private-recipes';
import type { AppCatalog, KitchenState } from './types';

export const MAX_RECIPE_PACKAGE_BYTES = 2 * 1024 * 1024;
export const MAX_RECIPE_QR_BYTES = 1800;
export const RECIPE_QR_PREFIX = 'fastcook:recipe:1:';

type RecipePackageBase = Readonly<{
  format: 'fastcook-recipes';
  datasetVersion: string;
  recipes: readonly PrivateRecipe[];
}>;
export type RecipePackage = RecipePackageBase & (Readonly<{ version: 1; media?: never; assets?: never }>
  | Readonly<{ version: 2; media: RecipeMediaMap; assets: readonly RecipeImageAsset[] }>);
export type RecipeImportSummary = Readonly<{
  added: number;
  skipped: number;
  sameNameCount: number;
}>;
export type RecipeImportPlan = RecipeImportSummary & Readonly<{ state: KitchenState; assets: readonly RecipeImageAsset[] }>;

const PACKAGE_FIELDS = ['format', 'version', 'datasetVersion', 'recipes'];

function withinBytes(value: string, maximum: number): boolean {
  return value.length <= maximum && new TextEncoder().encode(value).byteLength <= maximum;
}

function validDatasetVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validatedPackage(value: unknown, catalog: AppCatalog): StorageResult<RecipePackage> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure(t('菜谱包格式无效，请选择 FastCook 导出的菜谱文件。'));
  const item = value as Record<string, unknown>;
  const fields = item.version === 2 ? [...PACKAGE_FIELDS, 'media', 'assets'] : PACKAGE_FIELDS;
  if (Object.keys(item).length !== fields.length || fields.some(field => !Object.hasOwn(item, field))) {
    return failure(t('菜谱包字段不完整或含未知字段，请选择原始导出的菜谱文件。'));
  }
  if (item.format !== 'fastcook-recipes' || (item.version !== 1 && item.version !== 2)) return failure(t('此文件不是兼容的 FastCook 菜谱包，请检查文件或应用版本。'));
  if (!validDatasetVersion(item.datasetVersion)) return failure(t('菜谱包的数据版本无效，请重新选择原始文件。'));
  if (!Array.isArray(item.recipes) || item.recipes.length === 0 || item.recipes.length > MAX_PRIVATE_RECIPES) {
    return failure(t('每个菜谱包需要包含 1 至 100 道菜谱。'));
  }
  const recipes = validatePrivateRecipes(item.recipes, catalog);
  if (recipes.error !== null) return failure(t('菜谱包未通过校验。{error}', { error: recipes.error }));
  const base = { format: 'fastcook-recipes' as const, datasetVersion: item.datasetVersion, recipes: recipes.data };
  if (item.version === 1) return withinBytes(JSON.stringify({ ...base, version: 1 }), MAX_RECIPE_PACKAGE_BYTES)
    ? success({ format: base.format, version: 1, datasetVersion: base.datasetVersion, recipes: base.recipes }) : failure(t('菜谱包超过 2 MiB，请减少所选菜谱或拆分文件。'));
  const ids = new Set(recipes.data.map(recipe => recipe.id));
  const combined = mergePrivateRecipes(catalog, recipes.data);
  const media = validateRecipeMediaMap(item.media, { ...combined, recipes: combined.recipes.filter(recipe => ids.has(recipe.recipe_id)) });
  if (media.error !== null) return media;
  if (!withinBytes(JSON.stringify({ ...base, version: 2, media: media.data }), MAX_RECIPE_PACKAGE_BYTES)) return failure(t('菜谱包超过 2 MiB，请减少所选菜谱或拆分文件。'));
  if (!withinBytes(JSON.stringify(item), MAX_MEDIA_PACKAGE_BYTES)) return failure(t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。'));
  const assets = validateImageAssets(item.assets, media.data);
  return assets.error !== null ? assets : success({ ...base, version: 2, media: media.data, assets: assets.data });
}

export function createRecipePackage(recipes: unknown, catalog: AppCatalog, media: RecipeMediaMap = {}, assets: readonly RecipeImageAsset[] = []): StorageResult<RecipePackage> {
  const images = collectRecipeImages(media);
  if (images.error !== null) return images;
  const version = Object.keys(media).length === 0 && assets.length === 0 ? 1 : 2;
  const checked = validatedPackage({ format: 'fastcook-recipes', version, datasetVersion: catalog.dataset_version, recipes,
    ...(version === 2 ? { media, assets } : {}),
  }, catalog);
  if (checked.error !== null || checked.data.version === 1 || checked.data.assets.length > 0) return checked;
  return success({ format: checked.data.format, version: 1, datasetVersion: checked.data.datasetVersion, recipes: checked.data.recipes });
}

export function encodeRecipePackage(value: unknown, catalog: AppCatalog): StorageResult<string> {
  const checked = validatedPackage(value, catalog);
  return checked.error !== null ? checked : success(JSON.stringify(checked.data));
}

export function decodeRecipePackage(raw: unknown, catalog: AppCatalog): StorageResult<RecipePackage> {
  if (typeof raw !== 'string') return failure(t('菜谱文件内容无效，请选择 FastCook JSON 菜谱文件。'));
  if (!withinBytes(raw, MAX_MEDIA_PACKAGE_BYTES)) return failure(t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。'));
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure(t('菜谱文件无法解析，请选择完整的 FastCook JSON 菜谱文件。'));
  }
  if ((!value || typeof value !== 'object' || (value as Record<string, unknown>).version !== 2)
    && !withinBytes(raw, MAX_RECIPE_PACKAGE_BYTES)) return failure(t('菜谱文件超过 2 MiB，请选择较小的菜谱包。'));
  return validatedPackage(value, catalog);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : Number(left > right);
}

function canonicalIngredient(ingredient: PrivateRecipeIngredient, stepIndices: ReadonlyMap<string, number>) {
  return { ingredientId: ingredient.ingredientId, quantity: ingredient.quantity, importance: ingredient.importance,
    role: ingredient.role, consumes: ingredient.consumes,
    ...(ingredient.omission ? { omission: { note: ingredient.omission.note,
      stepChanges: ingredient.omission.stepChanges.map(change => change.action === 'skip'
        ? { stepIndex: stepIndices.get(change.stepId)!, action: 'skip' }
        : { stepIndex: stepIndices.get(change.stepId)!, action: 'replace', text: change.text, ingredientIds: [...change.ingredientIds].sort(compareText) })
        .sort((left, right) => left.stepIndex - right.stepIndex),
    } } : {}),
  };
}

function recipeContent(recipe: PrivateRecipe, media: RecipeMedia = EMPTY_RECIPE_MEDIA): string {
  const stepIndices = new Map(recipe.steps.map((step, index) => [step.id, index]));
  return JSON.stringify({ name: recipe.name, course: recipe.course, cookingMethod: recipe.cookingMethod,
    timeMinutes: recipe.timeMinutes, servings: recipe.servings, spicyLevel: recipe.spicyLevel,
    equipment: [...recipe.equipment].sort(compareText),
    ingredients: [...recipe.ingredients].sort((left, right) => compareText(left.ingredientId, right.ingredientId))
      .map(ingredient => canonicalIngredient(ingredient, stepIndices)),
    steps: recipe.steps.map(step => ({ text: step.text, ingredientIds: [...step.ingredientIds].sort(compareText) })),
    media: { images: media.images, steps: recipe.steps.map(step => media.steps[step.id] ?? []) },
  });
}

function uniqueRecipeId(occupied: Set<string>): string {
  const generated = createPrivateRecipeId();
  let result = generated;
  let suffix = 0;
  while (occupied.has(result)) {
    suffix += 1;
    result = `${generated}_${suffix}`;
  }
  occupied.add(result);
  return result;
}

export function prepareRecipeImport(state: KitchenState, catalog: AppCatalog, value: unknown): StorageResult<RecipeImportPlan> {
  const checked = validatedPackage(value, catalog);
  if (checked.error !== null) return checked;
  const current = validateKitchen(state, catalog);
  if (current.error !== null) return failure(t('无法导入菜谱，请先修复厨房记录。{error}', { error: current.error }));
  const contents = new Set(current.data.privateRecipes.map(recipe => recipeContent(recipe, current.data.recipeMedia[recipe.id])));
  const names = new Set(current.data.privateRecipes.map(recipe => recipe.name));
  const occupied = new Set([...current.data.privateRecipes.map(recipe => recipe.id),
    ...catalog.recipes.map(recipe => recipe.recipe_id), ...catalog.dishes.map(dish => dish.dish_id)]);
  const additions: PrivateRecipe[] = [];
  const importedMedia: Record<string, RecipeMedia> = {};
  let skipped = 0;
  let sameNameCount = 0;
  for (const recipe of checked.data.recipes) {
    const media = checked.data.media?.[recipe.id];
    const content = recipeContent(recipe, media);
    if (contents.has(content)) { skipped += 1; continue; }
    if (current.data.privateRecipes.length + additions.length >= MAX_PRIVATE_RECIPES) return failure(t('导入后将超过 100 道自建菜谱，请减少所选菜谱后重试。'));
    if (names.has(recipe.name)) sameNameCount += 1;
    const id = uniqueRecipeId(occupied);
    additions.push({ ...recipe, id });
    if (media) importedMedia[id] = media;
    contents.add(content);
    names.add(recipe.name);
  }
  if (additions.length === 0) return success({ state, added: 0, skipped, sameNameCount: 0, assets: [] });
  const candidate = validateKitchen({ ...current.data, privateRecipes: [...current.data.privateRecipes, ...additions],
    recipeMedia: { ...current.data.recipeMedia, ...importedMedia },
  }, catalog);
  if (candidate.error !== null) return failure(t('导入未完成。{error}', { error: candidate.error }));
  const images = collectRecipeImages(importedMedia);
  if (images.error !== null) return images;
  const imageIds = new Set(images.data.map(image => image.id));
  return success({ state: candidate.data, added: additions.length, skipped, sameNameCount,
    assets: checked.data.assets?.filter(asset => imageIds.has(asset.id)) ?? [],
  });
}

export function encodeRecipeQr(value: unknown, catalog: AppCatalog): StorageResult<string> {
  const checked = validatedPackage(value, catalog);
  if (checked.error !== null) return checked;
  if (checked.data.assets?.length) return failure(t('带图片的菜谱请使用文件分享。'));
  if (checked.data.recipes.length !== 1) return failure(t('二维码只能分享一道菜谱，多道菜谱请使用文件分享。'));
  const content = `${RECIPE_QR_PREFIX}${JSON.stringify(checked.data)}`;
  return withinBytes(content, MAX_RECIPE_QR_BYTES) ? success(content) : failure(t('这道菜谱内容较长，请使用文件分享。'));
}

export function decodeRecipeQr(raw: unknown, catalog: AppCatalog): StorageResult<RecipePackage> {
  if (typeof raw !== 'string' || !raw.startsWith(RECIPE_QR_PREFIX)) return failure(t('此二维码不是兼容的 FastCook 菜谱二维码。'));
  if (!withinBytes(raw, MAX_RECIPE_QR_BYTES)) return failure(t('二维码菜谱内容超过限制，请使用文件导入。'));
  const checked = decodeRecipePackage(raw.slice(RECIPE_QR_PREFIX.length), catalog);
  if (checked.error !== null) return checked;
  if (checked.data.assets?.length) return failure(t('带图片的菜谱请使用文件导入。'));
  return checked.data.recipes.length === 1 ? checked : failure(t('二维码只能包含一道菜谱，多道菜谱请使用文件导入。'));
}
