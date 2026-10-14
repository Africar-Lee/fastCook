import type { AppCatalog, KitchenState } from '../model/types';
import { validateKitchen, validTimestamp } from './state.ts';
import { failure, success } from './types.ts';
import type { StorageResult } from './types';

export const MAX_BACKUP_BYTES = 131_072;
export type KitchenBackup = Readonly<{
  format: 'fastcook-kitchen';
  version: 1;
  exportedAt: string;
  datasetVersion: string;
  kitchen: KitchenState;
}>;

export function createKitchenBackup(state: KitchenState, catalog: AppCatalog, exportedAt = new Date().toISOString()): StorageResult<KitchenBackup> {
  const checked = validateKitchen(state, catalog);
  if (checked.error !== null) return checked;
  if (!validTimestamp(exportedAt) || exportedAt === null) return failure('备份时间无效，请检查设备时间后重试。');
  return success({ format: 'fastcook-kitchen', version: 1, exportedAt, datasetVersion: catalog.dataset_version, kitchen: checked.data });
}

export function decodeKitchenBackup(raw: string, catalog: AppCatalog): StorageResult<KitchenBackup> {
  if (raw.length > MAX_BACKUP_BYTES || new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) return failure('备份超过 128 KB，请选择 FastCook 导出的 JSON 文件。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure('备份无法解析，请选择完整的 FastCook JSON 文件。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure('备份格式无效，请选择 FastCook 导出的文件。');
  const backup = parsed as Record<string, unknown>;
  const fields = ['format', 'version', 'exportedAt', 'datasetVersion', 'kitchen'];
  if (Object.keys(backup).length !== fields.length || fields.some(field => !Object.hasOwn(backup, field))) return failure('备份字段不完整或含未知字段，请选择原始导出文件。');
  if (backup.format !== 'fastcook-kitchen' || backup.version !== 1) return failure('不支持此备份版本，请使用兼容的 FastCook 版本恢复。');
  if (backup.exportedAt === null || !validTimestamp(backup.exportedAt)) return failure('备份导出时间无效，请重新选择文件。');
  const checked = validateKitchen(backup.kitchen, catalog);
  if (checked.error !== null) return failure('备份中的厨房记录未通过校验，请选择完整且与应用兼容的备份文件。');
  const sourceKitchen = backup.kitchen as Record<string, unknown>;
  if (typeof backup.datasetVersion !== 'string' || backup.datasetVersion !== sourceKitchen.datasetVersion) return failure('备份的数据版本不一致，请选择原始导出文件。');
  return success({ format: 'fastcook-kitchen', version: 1, exportedAt: backup.exportedAt, datasetVersion: backup.datasetVersion, kitchen: checked.data });
}

export type BackupImportResult = Readonly<{ status: 'selected'; content: string; error: null }>
  | Readonly<{ status: 'cancelled'; error: null }>
  | Readonly<{ status: 'failed'; error: string }>;

export function backupFileName(): string {
  return `fastcook-backup-${Date.now()}.json`;
}
