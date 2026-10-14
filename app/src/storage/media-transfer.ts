import { t } from '../i18n/core';
import { collectRecipeImages, MAX_MEDIA_PACKAGE_BYTES } from '../model/recipe-media';
import type { RecipeImageAsset, RecipeMediaMap } from '../model/recipe-media';
import { imageStore } from './recipe-images';
import { failure, success } from './types';
import type { StorageResult } from './types';

export async function readMediaAssets(media: RecipeMediaMap): Promise<StorageResult<readonly RecipeImageAsset[]>> {
  const images = collectRecipeImages(media);
  if (images.error !== null) return images;
  if (images.data.reduce((total, image) => total + 4 * Math.ceil(image.bytes / 3), 0) > MAX_MEDIA_PACKAGE_BYTES) {
    return failure(t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。'));
  }
  const assets: RecipeImageAsset[] = [];
  for (const image of images.data) {
    const result = await imageStore.read(image);
    if (result.error !== null) return result;
    assets.push(result.data);
  }
  return success(assets);
}

export async function storeMediaAssets(assets: readonly RecipeImageAsset[]): Promise<StorageResult<void>> {
  for (const asset of assets) {
    const result = await imageStore.put(asset);
    if (result.error !== null) return result;
  }
  return success(undefined);
}
