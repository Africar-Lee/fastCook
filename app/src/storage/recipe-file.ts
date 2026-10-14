import { MAX_MEDIA_PACKAGE_BYTES } from '../model/recipe-media.ts';
import { withinMediaPackageLimit } from '../model/media-file-limit.ts';
import { t } from '../i18n/core.ts';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { FileHandle } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import type { ReportExportResult } from './report-export-result';
import { failure, success } from './types.ts';
import type { StorageResult } from './types';

export type RecipeFileImportResult = Readonly<{ status: 'selected'; content: string; error: null }>
  | Readonly<{ status: 'cancelled'; error: null }> | Readonly<{ status: 'failed'; error: string }>;
export type RecipeShareResult = (Readonly<{ status: 'closed' | 'cancelled' | 'unsupported'; error: null }>
  | Readonly<{ status: 'failed'; error: string }>) & Readonly<{ cleanupError?: string }>;

const FILE_TOO_LARGE = '图片文件超过 48 MiB，请减少所选菜谱或图片后重试。';
const CLEANUP_ERROR = '部分分享缓存未能清理，请检查设备存储空间后重试。';
const SHARE_LIFETIME_MS = 24 * 60 * 60 * 1000;
let sharing = false;

function fileName(): string {
  return `fastcook-recipes-${Date.now()}.json`;
}

function contentError(content: string): string | null {
  return typeof content === 'string' && withinMediaPackageLimit(content) ? null : t(FILE_TOO_LARGE);
}

function fileCall<Value>(operation: () => Value, message: string): StorageResult<Value> {
  try {
    return success(operation());
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(t(message));
  }
}

function pickerCancelled(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ERR_PICKER_CANCELLED';
}

export async function exportRecipeFile(content: string): Promise<ReportExportResult> {
  const invalid = contentError(content);
  if (invalid) return { status: 'failed', error: invalid };
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync();
  } catch (error: unknown) {
    if (pickerCancelled(error)) return { status: 'cancelled', error: null };
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法打开菜谱保存目录，请重新选择并允许访问。') };
  }
  const created = fileCall(() => directory.createFile(fileName(), 'application/json'), t('无法创建菜谱文件，请选择可写入的目录后重试。'));
  if (created.error !== null) return { status: 'failed', error: created.error };
  const written = fileCall(() => created.data.write(content), t('菜谱文件未能完整保存，请检查存储空间和目录权限后重试。'));
  return written.error !== null ? { status: 'failed', error: written.error } : { status: 'saved', error: null };
}

function readRecipeFile(file: File): RecipeFileImportResult {
  const opened = fileCall(() => file.open(FileMode.ReadOnly), t('无法读取菜谱文件，请重新选择并允许访问。'));
  if (opened.error !== null) return { status: 'failed', error: opened.error };
  const handle: FileHandle = opened.data;
  let read: StorageResult<Uint8Array>;
  let closed: StorageResult<void>;
  try {
    read = fileCall(() => handle.readBytes(MAX_MEDIA_PACKAGE_BYTES + 1), t('菜谱文件读取失败，请检查文件是否完整后重试。'));
  } finally {
    closed = fileCall(() => handle.close(), t('菜谱文件未能完成读取，请重新选择后重试。'));
  }
  if (read.error !== null) return { status: 'failed', error: read.error };
  if (closed.error !== null) return { status: 'failed', error: closed.error };
  if (read.data.byteLength > MAX_MEDIA_PACKAGE_BYTES) return { status: 'failed', error: t(FILE_TOO_LARGE) };
  const content = new TextDecoder().decode(read.data);
  return withinMediaPackageLimit(content) ? { status: 'selected', content, error: null } : { status: 'failed', error: t(FILE_TOO_LARGE) };
}

export async function importRecipeFile(): Promise<RecipeFileImportResult> {
  let selected: File | File[];
  try {
    selected = await File.pickFileAsync(undefined, 'application/json');
  } catch (error: unknown) {
    if (pickerCancelled(error)) return { status: 'cancelled', error: null };
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法打开菜谱文件选择器，请重试并允许访问文件。') };
  }
  if (Array.isArray(selected)) return { status: 'failed', error: t('请选择一个 FastCook 菜谱文件。') };
  return readRecipeFile(selected);
}

function clearFile(file: File): string | null {
  return fileCall(() => { if (file.exists) file.delete(); }, CLEANUP_ERROR).error;
}

function clearExpiredFiles(directory: Directory): string | null {
  const listed = fileCall(() => directory.list(), CLEANUP_ERROR);
  if (listed.error !== null) return listed.error;
  let cleanupError: string | null = null;
  const cutoff = Date.now() - SHARE_LIFETIME_MS;
  for (const file of listed.data) {
    if (!(file instanceof File) || !/^fastcook-recipes-\d+\.json$/.test(file.name)) continue;
    const modified = fileCall(() => file.lastModified, CLEANUP_ERROR);
    if (modified.error !== null) { cleanupError = modified.error; continue; }
    if (modified.data !== null && Number.isFinite(modified.data) && modified.data >= 0 && modified.data < cutoff) {
      cleanupError = clearFile(file) ?? cleanupError;
    }
  }
  return cleanupError;
}

function prepareShare(content: string): StorageResult<Readonly<{ file: File; cleanupError: string | null }>> {
  const directory = fileCall(() => new Directory(Paths.cache, 'fastcook-recipe-shares'), t('无法准备菜谱分享目录，请重新打开应用后重试。'));
  if (directory.error !== null) return directory;
  const created = fileCall(() => directory.data.create({ intermediates: true, idempotent: true }), t('无法创建菜谱分享目录，请检查存储空间后重试。'));
  if (created.error !== null) return created;
  const cleanupError = clearExpiredFiles(directory.data);
  const reference = fileCall(() => new File(directory.data, fileName()), t('无法准备菜谱分享文件，请重新打开应用后重试。'));
  if (reference.error !== null) return reference;
  const allocated = fileCall(() => reference.data.create(), t('无法创建菜谱分享文件，请检查存储空间后重试。'));
  if (allocated.error !== null) return allocated;
  const written = fileCall(() => reference.data.write(content), t('菜谱分享文件未能写入，请检查存储空间后重试。'));
  if (written.error !== null) {
    const cleanup = clearFile(reference.data) ?? cleanupError;
    return failure(cleanup ? `${written.error} ${cleanup}` : written.error);
  }
  return success({ file: reference.data, cleanupError });
}

async function openShare(content: string): Promise<RecipeShareResult> {
  let available: boolean;
  try {
    available = await isAvailableAsync();
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法检查系统分享功能，请重新打开应用后重试。') };
  }
  if (!available) return { status: 'unsupported', error: null };
  const prepared = prepareShare(content);
  if (prepared.error !== null) return { status: 'failed', error: prepared.error };
  const { file, cleanupError: previousCleanupError } = prepared.data;
  let result: RecipeShareResult;
  try {
    await shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: t('分享菜谱') });
    result = { status: 'closed', error: null };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    result = error.name === 'AbortError' ? { status: 'cancelled', error: null }
      : { status: 'failed', error: t('菜谱分享面板未能打开，请重试或导出文件后分享。') };
  }
  // The receiver can still read the attachment after Android closes its chooser.
  const cleanupError = result.status === 'closed' ? previousCleanupError : clearFile(file) ?? previousCleanupError;
  return cleanupError ? { ...result, cleanupError } : result;
}

export async function shareRecipeFile(content: string): Promise<RecipeShareResult> {
  const invalid = contentError(content);
  if (invalid) return { status: 'failed', error: invalid };
  if (sharing) return { status: 'failed', error: t('正在打开菜谱分享，请关闭当前面板后重试。') };
  sharing = true;
  try {
    return await openShare(content);
  } finally {
    sharing = false;
  }
}
