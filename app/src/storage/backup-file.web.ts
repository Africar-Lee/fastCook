import { t } from '../i18n/core.ts';
import { backupFileName, MAX_BACKUP_BYTES } from './backup.ts';
import type { BackupImportResult, KitchenBackup } from './backup';
import type { ReportExportResult } from './report-export-result';
import { withinMediaPackageLimit } from '../model/media-file-limit.ts';

export async function exportKitchenBackup(backup: KitchenBackup): Promise<ReportExportResult> {
  const content = JSON.stringify(backup);
  if (!withinMediaPackageLimit(content)) return { status: 'failed', error: t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。') };
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return { status: 'failed', error: t('浏览器不支持导出文件，请使用支持下载的浏览器重试。') };
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('备份文件未能生成，请重新打开页面后重试。') };
  }
  let link: HTMLAnchorElement | null = null;
  try {
    link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('备份下载未能开始，请允许本站下载文件后重试。') };
  } finally {
    link?.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { status: 'download_started', error: null };
}

async function readBackup(file: File): Promise<BackupImportResult> {
  if (file.size > MAX_BACKUP_BYTES) return { status: 'failed', error: t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。') };
  let content: string;
  try {
    content = await file.text();
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('备份读取失败，请检查文件是否完整后重试。') };
  }
  return withinMediaPackageLimit(content) ? { status: 'selected', content, error: null }
    : { status: 'failed', error: t('图片文件超过 48 MiB，请减少所选菜谱或图片后重试。') };
}

export async function importKitchenBackup(): Promise<BackupImportResult> {
  if (typeof document === 'undefined') return { status: 'failed', error: t('浏览器不支持选择文件，请使用支持文件上传的浏览器重试。') };
  let input: HTMLInputElement;
  try {
    input = document.createElement('input');
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法准备文件选择器，请重新打开页面后重试。') };
  }
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  return new Promise(resolve => {
    const finish = (result: BackupImportResult) => { input.remove(); resolve(result); };
    input.addEventListener('cancel', () => finish({ status: 'cancelled', error: null }), { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { finish({ status: 'cancelled', error: null }); return; }
      void readBackup(file).then(finish);
    }, { once: true });
    try {
      document.body.appendChild(input);
      input.click();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      finish({ status: 'failed', error: t('无法打开文件选择器，请允许访问文件后重试。') });
    }
  });
}
