import { Directory, File, Paths } from 'expo-file-system';
import { t } from '../i18n/core.ts';
import { isImageId, validateImage, validateImageAsset } from '../model/recipe-media.ts';
import type { RecipeImage, RecipeImageAsset } from '../model/recipe-media';
import { failure, success } from './types.ts';
import type { StorageResult } from './types';

const READ_ERROR = '无法读取菜谱图片，请检查存储空间后重试。';
const WRITE_ERROR = '菜谱图片未保存，请检查存储空间后重试。';
const CLEANUP_ERROR = '菜谱图片清理失败，请检查存储空间后重试。';
let mutations = Promise.resolve();

function fileCall<Value>(operation: () => Value, message: string): StorageResult<Value> {
  try {
    return success(operation());
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(t(message));
  }
}

async function filePromise<Value>(operation: () => Promise<Value>, message: string): Promise<StorageResult<Value>> {
  try {
    return success(await operation());
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(t(message));
  }
}

function directory(): StorageResult<Directory> {
  return fileCall(() => new Directory(Paths.document, 'recipe-images'), READ_ERROR);
}

function imageFile(image: RecipeImage): StorageResult<File> {
  const checked = validateImage(image);
  if (checked.error !== null) return checked;
  const folder = directory();
  return folder.error !== null ? folder : fileCall(() => new File(folder.data, `${checked.data.id}.jpg`), READ_ERROR);
}

async function read(image: RecipeImage): Promise<StorageResult<RecipeImageAsset>> {
  const reference = imageFile(image);
  if (reference.error !== null) return reference;
  const info = fileCall(() => reference.data.info(), READ_ERROR);
  if (info.error !== null) return info;
  if (!info.data.exists) return failure(t('菜谱图片已丢失，请重新添加图片。'));
  if (info.data.size !== image.bytes) return failure(t(READ_ERROR));
  const encoded = await filePromise(() => reference.data.base64(), READ_ERROR);
  return encoded.error !== null ? encoded : validateImageAsset({ ...image, base64: encoded.data });
}

function removeFile(file: File): StorageResult<void> {
  return fileCall(() => { if (file.exists) file.delete(); }, CLEANUP_ERROR);
}

function abandonWrite(file: File, error: string): StorageResult<void> {
  const removed = removeFile(file);
  return failure(removed.error === null ? error : `${error} ${removed.error}`);
}

async function putImage(asset: RecipeImageAsset): Promise<StorageResult<void>> {
  const checked = validateImageAsset(asset);
  if (checked.error !== null) return checked;
  const { base64, ...image } = checked.data;
  const reference = imageFile(image);
  if (reference.error !== null) return reference;
  const exists = fileCall(() => reference.data.exists, READ_ERROR);
  if (exists.error !== null) return exists;
  if (exists.data) {
    const existing = await read(image);
    return existing.error !== null ? existing : existing.data.base64 === base64 ? success(undefined)
      : failure(t('菜谱图片编号冲突，请重新选择图片。'));
  }
  const folder = directory();
  if (folder.error !== null) return folder;
  const created = fileCall(() => folder.data.create({ intermediates: true, idempotent: true }), WRITE_ERROR);
  if (created.error !== null) return created;
  const temporary = fileCall(() => new File(folder.data, `${image.id}.${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.tmp`), WRITE_ERROR);
  if (temporary.error !== null) return temporary;
  const written = fileCall(() => { temporary.data.create(); temporary.data.write(base64, { encoding: 'base64' }); }, WRITE_ERROR);
  if (written.error !== null) return abandonWrite(temporary.data, written.error);
  const size = fileCall(() => temporary.data.size, WRITE_ERROR);
  if (size.error !== null || size.data !== image.bytes) return abandonWrite(temporary.data, size.error ?? t(WRITE_ERROR));
  const moved = await filePromise(() => temporary.data.move(reference.data, { overwrite: false }), WRITE_ERROR);
  if (moved.error !== null) return abandonWrite(temporary.data, moved.error);
  return success(undefined);
}

function enqueue(operation: () => Promise<StorageResult<void>>): Promise<StorageResult<void>> {
  const result = mutations.then(operation);
  mutations = result.then(() => undefined);
  return result;
}

async function resolve(image: RecipeImage): Promise<StorageResult<string>> {
  const checked = await read(image);
  if (checked.error !== null) return checked;
  const reference = imageFile(image);
  return reference.error !== null ? reference : success(reference.data.uri);
}

function ownedImageId(name: string): string | null {
  const id = name.endsWith('.jpg') ? name.slice(0, -4)
    : /^(image_[a-zA-Z0-9_-]{1,96})\.[a-z0-9]{1,16}-[a-z0-9]{0,16}\.tmp$/.exec(name)?.[1];
  return isImageId(id) ? id : null;
}

async function pruneImages(keepIds: readonly string[]): Promise<StorageResult<void>> {
  if (!Array.isArray(keepIds) || !keepIds.every(isImageId)) return failure(t(CLEANUP_ERROR));
  const folder = directory();
  if (folder.error !== null) return folder;
  const entries = fileCall(() => folder.data.exists ? folder.data.list() : [], CLEANUP_ERROR);
  if (entries.error !== null) return entries;
  const keep = new Set(keepIds);
  for (const entry of entries.data) {
    if (!(entry instanceof File)) continue;
    const id = ownedImageId(entry.name);
    if (id === null || keep.has(id)) continue;
    const removed = removeFile(entry);
    if (removed.error !== null) return removed;
  }
  return success(undefined);
}

export const imageStore = {
  put: (asset: RecipeImageAsset) => enqueue(() => putImage(asset)),
  read,
  resolve,
  prune: (keepIds: readonly string[]) => enqueue(() => pruneImages(keepIds)),
};
