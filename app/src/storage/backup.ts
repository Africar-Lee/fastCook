import { t } from '../i18n/core.ts';
import type { AppCatalog, KitchenState } from '../model/types';
import { validateKitchen, validTimestamp } from './state.ts';
import { MAX_MEDIA_PACKAGE_BYTES, validateImageAssets } from '../model/recipe-media.ts';
import type { RecipeImageAsset } from '../model/recipe-media';
import { failure, success, withinStorageLimit } from './types.ts';
import type { StorageResult } from './types';

export const MAX_BACKUP_BYTES = MAX_MEDIA_PACKAGE_BYTES;
export type KitchenBackup = Readonly<{
  format: 'fastcook-kitchen';
  version: 2;
  exportedAt: string;
  datasetVersion: string;
  kitchen: KitchenState;
  assets: readonly RecipeImageAsset[];
}>;

function withinBackupLimit(raw: string): boolean {
  return raw.length <= MAX_BACKUP_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_BACKUP_BYTES;
}

export function createKitchenBackup(state: KitchenState, catalog: AppCatalog, exportedAt = new Date().toISOString(), assets: readonly RecipeImageAsset[] = []): StorageResult<KitchenBackup> {
  const checked = validateKitchen(state, catalog);
  if (checked.error !== null) return checked;
  if (!validTimestamp(exportedAt) || exportedAt === null) return failure(t('备份时间无效，请检查设备时间后重试。'));
  const imageAssets = validateImageAssets(assets, checked.data.recipeMedia);
  if (imageAssets.error !== null) return imageAssets;
  const backup: KitchenBackup = { format: 'fastcook-kitchen', version: 2, exportedAt, datasetVersion: catalog.dataset_version,
    kitchen: checked.data, assets: imageAssets.data };
  return withinBackupLimit(JSON.stringify(backup)) ? success(backup) : failure(t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。'));
}

export function decodeKitchenBackup(raw: string, catalog: AppCatalog): StorageResult<KitchenBackup> {
  if (!withinBackupLimit(raw)) return failure(t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure(t('备份无法解析，请选择完整的 FastCook JSON 文件。'));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure(t('备份格式无效，请选择 FastCook 导出的文件。'));
  const backup = parsed as Record<string, unknown>;
  const fields = ['format', 'version', 'exportedAt', 'datasetVersion', 'kitchen', ...(backup.version === 2 ? ['assets'] : [])];
  if (Object.keys(backup).length !== fields.length || fields.some(field => !Object.hasOwn(backup, field))) return failure(t('备份字段不完整或含未知字段，请选择原始导出文件。'));
  if (backup.format !== 'fastcook-kitchen' || (backup.version !== 1 && backup.version !== 2)) return failure(t('不支持此备份版本，请使用兼容的 FastCook 版本恢复。'));
  if (backup.version === 1 && !withinStorageLimit(raw)) return failure(t('备份超过 2 MiB，请选择 FastCook 导出的 JSON 文件。'));
  if (backup.exportedAt === null || !validTimestamp(backup.exportedAt)) return failure(t('备份导出时间无效，请重新选择文件。'));
  const checked = validateKitchen(backup.kitchen, catalog);
  if (checked.error !== null) return failure(t('备份中的厨房记录未通过校验，请选择完整且与应用兼容的备份文件。'));
  const sourceKitchen = backup.kitchen as Record<string, unknown>;
  if (typeof backup.datasetVersion !== 'string' || backup.datasetVersion !== sourceKitchen.datasetVersion) return failure(t('备份的数据版本不一致，请选择原始导出文件。'));
  if (backup.version === 2 && sourceKitchen.schemaVersion !== 4) return failure(t('图片备份的厨房记录版本无效，请重新导出文件。'));
  const assets = validateImageAssets(backup.version === 2 ? backup.assets : [], checked.data.recipeMedia);
  if (assets.error !== null) return assets;
  return success({ format: 'fastcook-kitchen', version: 2, exportedAt: backup.exportedAt, datasetVersion: backup.datasetVersion,
    kitchen: checked.data, assets: assets.data });
}

export type BackupImportResult = Readonly<{ status: 'selected'; content: string; error: null }>
  | Readonly<{ status: 'cancelled'; error: null }>
  | Readonly<{ status: 'failed'; error: string }>;

export function backupFileName(): string {
  return `fastcook-backup-${Date.now()}.json`;
}
