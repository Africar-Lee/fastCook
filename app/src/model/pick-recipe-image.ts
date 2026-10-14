import { pickVisionPhoto } from '../byok/photo';
import { imageStore } from '../storage/recipe-images';
import { createImageId } from './recipe-media.ts';
import type { RecipeImage, RecipeImageAsset } from './recipe-media';

type RecipeImageResult = Readonly<{ status: 'selected'; image: RecipeImage }>
  | Readonly<{ status: 'cancelled' }> | Readonly<{ status: 'failed'; error: string }>;

export async function pickRecipeImage(source: 'camera' | 'library'): Promise<RecipeImageResult> {
  const selected = await pickVisionPhoto(source);
  if (selected.status !== 'selected') return selected;
  const image: RecipeImage = { id: createImageId(), width: selected.photo.width, height: selected.photo.height, bytes: selected.photo.bytes };
  const asset: RecipeImageAsset = { ...image, base64: selected.photo.base64 };
  const stored = await imageStore.put(asset);
  return stored.error !== null ? { status: 'failed', error: stored.error } : { status: 'selected', image };
}
