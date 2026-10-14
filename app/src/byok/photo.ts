import { t } from '../i18n/core.ts';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';
import type { StorageResult } from '../storage/types';
import type { VisionPhoto } from './types';
import { isOwnedPhotoCacheUri, jpegBase64Bytes, MAX_VISION_PHOTO_EDGE, validatePhotoInput, validateVisionPhoto } from './photo-validation.ts';

type PhotoResult = { status: 'selected'; photo: VisionPhoto } | { status: 'cancelled' } | { status: 'failed'; error: string };
let picking = false;

function snapshotPhotoCache(): StorageResult<readonly string[]> {
  try {
    const files = ['ImagePicker', 'ImageManipulator'].flatMap(folder => {
      const directory = new Directory(Paths.cache, folder);
      return directory.exists ? directory.list().map(file => file.uri) : [];
    });
    return { data: files, error: null };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { data: null, error: t('无法读取图片缓存，请检查存储空间后重试。') };
  }
}

function cleanPhotoCache(previous: readonly string[], generatedUri?: string): string | null {
  const current = snapshotPhotoCache();
  if (current.error) return current.error;
  const existing = new Set(previous);
  const created = current.data!.filter(uri => !existing.has(uri));
  if (generatedUri) created.push(generatedUri);
  let cleanupError: string | null = null;
  for (const uri of new Set(created)) {
    if (!isOwnedPhotoCacheUri(uri, Paths.cache.uri)) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      cleanupError = t('图片缓存清理失败，请清理应用缓存后重试。');
    }
  }
  return cleanupError;
}

async function acquireImage(source: 'camera' | 'library'): Promise<StorageResult<ImagePicker.ImagePickerResult>> {
  if (source === 'camera') {
    let permission: ImagePicker.CameraPermissionResponse;
    try {
      permission = await ImagePicker.requestCameraPermissionsAsync();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return { data: null, error: t('无法请求相机权限，请在系统设置中检查 FastCook 的相机权限。') };
    }
    if (!permission.granted) return { data: null, error: permission.canAskAgain
      ? t('需要相机权限才能拍照，也可以改为选择图片。') : t('相机权限已关闭，请在系统设置中允许 FastCook 使用相机，或改为选择图片。') };
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsMultipleSelection: false,
    allowsEditing: false, quality: 1, base64: false, exif: false };
  try {
    return { data: await (source === 'camera' ? ImagePicker.launchCameraAsync(options) : ImagePicker.launchImageLibraryAsync(options)), error: null };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { data: null, error: source === 'camera' ? t('无法打开相机，请检查相机是否可用，或改为选择图片。') : t('无法打开图片选择器，请重新选择图片。') };
  }
}

function validateAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  if (!asset || typeof asset.uri !== 'string' || !isOwnedPhotoCacheUri(asset.uri, Paths.cache.uri)
    || (asset.type && asset.type !== 'image')) return t('无法读取所选图片，请重新选择一张照片。');
  let bytes: number;
  try {
    bytes = new File(asset.uri).size;
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return t('无法读取所选图片，请重新选择一张照片。');
  }
  return validatePhotoInput(asset.width, asset.height, bytes);
}

async function compressImage(asset: ImagePicker.ImagePickerAsset): Promise<{ result: PhotoResult; generatedUri?: string }> {
  const validationError = validateAsset(asset);
  if (validationError) return { result: { status: 'failed', error: validationError } };
  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let image: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | undefined;
  let output: Awaited<ReturnType<NonNullable<typeof image>['saveAsync']>>;
  try {
    context = ImageManipulator.manipulate(asset.uri);
    if (Math.max(asset.width, asset.height) > MAX_VISION_PHOTO_EDGE) {
      context.resize(asset.width >= asset.height ? { width: MAX_VISION_PHOTO_EDGE } : { height: MAX_VISION_PHOTO_EDGE });
    }
    image = await context.renderAsync();
    output = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { result: { status: 'failed', error: t('图片处理失败，请换一张图片或缩小图片后重试。') } };
  } finally {
    image?.release();
    context?.release();
  }
  const base64 = output.base64 ?? '';
  const photo = validateVisionPhoto({ uri: `data:image/jpeg;base64,${base64}`, base64, mimeType: 'image/jpeg',
    width: output.width, height: output.height, bytes: jpegBase64Bytes(base64) });
  return { result: photo.error ? { status: 'failed', error: photo.error } : { status: 'selected', photo: photo.data! }, generatedUri: output.uri };
}

export async function pickVisionPhoto(source: 'camera' | 'library'): Promise<PhotoResult> {
  if (picking) return { status: 'failed', error: t('图片正在处理，请稍候。') };
  const previous = snapshotPhotoCache();
  if (previous.error) return { status: 'failed', error: previous.error };
  picking = true;
  try {
    const selected = await acquireImage(source);
    const processed = selected.error ? { result: { status: 'failed', error: selected.error } as PhotoResult }
      : selected.data!.canceled ? { result: { status: 'cancelled' } as PhotoResult }
        : await compressImage(selected.data!.assets[0]!);
    const cleanupError = cleanPhotoCache(previous.data!, 'generatedUri' in processed ? processed.generatedUri : undefined);
    return cleanupError ? { status: 'failed', error: cleanupError } : processed.result;
  } finally {
    picking = false;
  }
}
