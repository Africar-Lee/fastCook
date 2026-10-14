import { t } from '../i18n/core.ts';
import { Directory, File, FileMode } from 'expo-file-system';
import type { FileHandle } from 'expo-file-system';
import { backupFileName, MAX_BACKUP_BYTES } from './backup.ts';
import type { BackupImportResult, KitchenBackup } from './backup';
import type { ReportExportResult } from './report-export-result';
import { withinMediaPackageLimit } from '../model/media-file-limit.ts';

function cancelled(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ERR_PICKER_CANCELLED';
}

export async function exportKitchenBackup(backup: KitchenBackup): Promise<ReportExportResult> {
  const content = JSON.stringify(backup);
  if (!withinMediaPackageLimit(content)) return { status: 'failed', error: t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。') };
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync();
  } catch (error: unknown) {
    if (cancelled(error)) return { status: 'cancelled', error: null };
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法打开保存目录，请重新选择并允许访问该目录。') };
  }
  let file: File;
  try {
    file = directory.createFile(backupFileName(), 'application/json');
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法创建备份文件，请选择可写入的目录后重试。') };
  }
  try {
    file.write(content);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('备份未能完整保存，请检查存储空间和目录权限后重试。') };
  }
  return { status: 'saved', error: null };
}

function readBackup(file: File): BackupImportResult {
  let handle: FileHandle;
  try {
    handle = file.open(FileMode.ReadOnly);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法读取备份，请重新选择文件并允许访问。') };
  }
  let bytes: Uint8Array;
  try {
    bytes = handle.readBytes(MAX_BACKUP_BYTES + 1);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('备份读取失败，请检查文件是否完整后重试。') };
  } finally {
    try {
      handle.close();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return { status: 'failed', error: t('备份文件未能完成读取，请重新选择文件后重试。') };
    }
  }
  if (bytes.byteLength > MAX_BACKUP_BYTES) return { status: 'failed', error: t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。') };
  return { status: 'selected', content: new TextDecoder().decode(bytes), error: null };
}

export async function importKitchenBackup(): Promise<BackupImportResult> {
  let selected: File | File[];
  try {
    // 对象重载会把访问失败也转换成取消，兼容重载保留可重试的错误。
    selected = await File.pickFileAsync(undefined, 'application/json');
  } catch (error: unknown) {
    if (cancelled(error)) return { status: 'cancelled', error: null };
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法打开备份文件选择器，请重试并允许访问文件。') };
  }
  if (Array.isArray(selected)) return { status: 'failed', error: t('请选择一个 FastCook 备份文件。') };
  return readBackup(selected);
}
