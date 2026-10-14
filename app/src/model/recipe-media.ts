import { t } from '../i18n/core.ts';
import { MAX_VISION_PHOTO_BYTES, MAX_VISION_PHOTO_EDGE, validateVisionPhoto } from '../byok/photo-validation.ts';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import type { AppCatalog } from './types';

export type RecipeImage = Readonly<{ id: string; width: number; height: number; bytes: number }>;
export type RecipeImageAsset = RecipeImage & Readonly<{ base64: string }>;
export type RecipeMedia = Readonly<{ images: readonly RecipeImage[]; steps: Readonly<Record<string, readonly RecipeImage[]>> }>;
export type RecipeMediaMap = Readonly<Record<string, RecipeMedia>>;
export const MAX_IMAGES_PER_GROUP = 6;
export const MAX_IMAGES_PER_RECIPE = 30;
export const MAX_MEDIA_PACKAGE_BYTES = 48 * 1024 * 1024;
export const EMPTY_RECIPE_MEDIA: RecipeMedia = Object.freeze({ images: Object.freeze([]), steps: Object.freeze({}) });
const MAX_MEDIA_RECIPES = 256;
const MAX_MEDIA_STEPS = 30;
const IMAGE_FIELDS = ['id', 'width', 'height', 'bytes'];

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && /^image_[a-zA-Z0-9_-]{1,96}$/.test(value);
}

export function createImageId(): string {
  return `image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}_${Math.random().toString(36).slice(2, 14)}`;
}

function validSize(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

export function validateImage(value: unknown): StorageResult<RecipeImage> {
  if (!record(value) || !exactFields(value, IMAGE_FIELDS) || !isImageId(value.id)
    || !validSize(value.width, MAX_VISION_PHOTO_EDGE) || !validSize(value.height, MAX_VISION_PHOTO_EDGE)
    || !validSize(value.bytes, MAX_VISION_PHOTO_BYTES)) return failure(t('菜谱图片信息无效，请重新添加图片。'));
  return success(Object.freeze({ id: value.id, width: value.width, height: value.height, bytes: value.bytes }));
}

export function validateImageAsset(value: unknown): StorageResult<RecipeImageAsset> {
  if (!record(value) || !exactFields(value, [...IMAGE_FIELDS, 'base64']) || typeof value.base64 !== 'string'
    || value.base64.length > 4 * Math.ceil(MAX_VISION_PHOTO_BYTES / 3)) return failure(t('菜谱图片文件格式无效，请重新添加图片。'));
  const image = validateImage({ id: value.id, width: value.width, height: value.height, bytes: value.bytes });
  if (image.error !== null) return image;
  const photo = validateVisionPhoto({ ...image.data, base64: value.base64, mimeType: 'image/jpeg', uri: `data:image/jpeg;base64,${value.base64}` });
  if (photo.error !== null) return failure(t('菜谱图片内容损坏或与图片信息不一致，请重新添加图片。'));
  return success(Object.freeze({ ...image.data, base64: photo.data.base64 }));
}

function validateGroup(value: unknown): StorageResult<readonly RecipeImage[]> {
  if (!Array.isArray(value) || value.length > MAX_IMAGES_PER_GROUP) return failure(t('每组最多添加 {count} 张图片。', { count: MAX_IMAGES_PER_GROUP }));
  const images: RecipeImage[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const checked = validateImage(item);
    if (checked.error !== null) return checked;
    if (ids.has(checked.data.id)) return failure(t('同一组内不能重复添加图片。'));
    ids.add(checked.data.id);
    images.push(checked.data);
  }
  return success(Object.freeze(images));
}

function validateMedia(value: unknown): StorageResult<RecipeMedia> {
  if (!record(value) || !exactFields(value, ['images', 'steps']) || !record(value.steps)
    || Object.keys(value.steps).length > MAX_MEDIA_STEPS) return failure(t('菜谱图片分组无效，请重新添加图片。'));
  const images = validateGroup(value.images);
  if (images.error !== null) return images;
  const steps: Record<string, readonly RecipeImage[]> = {};
  let count = images.data.length;
  for (const [stepId, group] of Object.entries(value.steps)) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(stepId)) return failure(t('菜谱步骤图片引用无效，请重新添加图片。'));
    const checked = validateGroup(group);
    if (checked.error !== null) return checked;
    count += checked.data.length;
    if (count > MAX_IMAGES_PER_RECIPE) return failure(t('每道菜最多添加 {count} 张图片。', { count: MAX_IMAGES_PER_RECIPE }));
    Object.defineProperty(steps, stepId, { value: checked.data, enumerable: true });
  }
  return success(Object.freeze({ images: images.data, steps: Object.freeze(steps) }));
}

function validateMap(value: unknown): StorageResult<RecipeMediaMap> {
  if (!record(value) || Object.keys(value).length > MAX_MEDIA_RECIPES) return failure(t('菜谱图片记录格式无效，请重新选择文件。'));
  const media: Record<string, RecipeMedia> = {};
  for (const [recipeId, item] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recipeId)) return failure(t('菜谱图片引用无效，请重新选择文件。'));
    const checked = validateMedia(item);
    if (checked.error !== null) return checked;
    Object.defineProperty(media, recipeId, { value: checked.data, enumerable: true });
  }
  return success(Object.freeze(media));
}

function sameImage(left: RecipeImage, right: RecipeImage): boolean {
  return left.id === right.id && left.width === right.width && left.height === right.height && left.bytes === right.bytes;
}

export function collectRecipeImages(value: unknown): StorageResult<readonly RecipeImage[]> {
  const checked = validateMap(value);
  if (checked.error !== null) return checked;
  const images = new Map<string, RecipeImage>();
  for (const media of Object.values(checked.data)) {
    for (const image of [...media.images, ...Object.values(media.steps).flat()]) {
      const existing = images.get(image.id);
      if (existing && !sameImage(existing, image)) return failure(t('同一图片编号包含不同图片信息，请重新选择文件。'));
      images.set(image.id, image);
    }
  }
  return success(Object.freeze([...images.values()]));
}

export function validateRecipeMediaMap(value: unknown, catalog: AppCatalog): StorageResult<RecipeMediaMap> {
  const checked = validateMap(value);
  if (checked.error !== null) return checked;
  const recipes = new Map((catalog.recipes ?? []).map(recipe => [recipe.recipe_id, recipe]));
  for (const [recipeId, media] of Object.entries(checked.data)) {
    const recipe = recipes.get(recipeId);
    if (!recipe) return failure(t('图片关联的菜谱不存在，请重新选择文件。'));
    const stepIds = new Set(recipe.steps.map(step => step.step_id));
    if (Object.keys(media.steps).some(stepId => !stepIds.has(stepId))) return failure(t('图片关联的烹饪步骤不存在，请重新添加图片。'));
  }
  const images = collectRecipeImages(checked.data);
  return images.error !== null ? images : checked;
}

export function validateImageAssets(value: unknown, media: RecipeMediaMap): StorageResult<readonly RecipeImageAsset[]> {
  const images = collectRecipeImages(media);
  if (images.error !== null) return images;
  if (!Array.isArray(value) || value.length !== images.data.length) return failure(t('菜谱图片文件与引用不完整，请重新导出文件。'));
  const references = new Map(images.data.map(image => [image.id, image]));
  const assets: RecipeImageAsset[] = [];
  for (const item of value) {
    const checked = validateImageAsset(item);
    if (checked.error !== null) return checked;
    const reference = references.get(checked.data.id);
    if (!reference || !sameImage(reference, checked.data)) return failure(t('菜谱图片文件与引用不一致，请重新导出文件。'));
    references.delete(checked.data.id);
    assets.push(checked.data);
  }
  return success(Object.freeze(assets));
}
