import { MAX_MEDIA_PACKAGE_BYTES } from '../model/recipe-media.ts';
import { withinMediaPackageLimit } from '../model/media-file-limit.ts';
import { t } from '../i18n/core.ts';
import type { RecipeFileImportResult, RecipeShareResult } from './recipe-file';
import type { ReportExportResult } from './report-export-result';

const FILE_TOO_LARGE = '图片文件超过 48 MiB，请减少所选菜谱或图片后重试。';

function fileName(): string {
  return `fastcook-recipes-${Date.now()}.json`;
}

function validContent(content: string): boolean {
  return typeof content === 'string' && withinMediaPackageLimit(content);
}

export async function exportRecipeFile(content: string): Promise<ReportExportResult> {
  if (!validContent(content)) return { status: 'failed', error: t(FILE_TOO_LARGE) };
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { status: 'failed', error: t('浏览器不支持导出菜谱文件，请使用支持下载的浏览器重试。') };
  }
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('菜谱文件未能生成，请重新打开页面后重试。') };
  }
  let link: HTMLAnchorElement | null = null;
  try {
    link = document.createElement('a');
    link.href = url; link.download = fileName(); link.style.display = 'none';
    document.body.appendChild(link); link.click();
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('菜谱下载未能开始，请允许本站下载文件后重试。') };
  } finally {
    link?.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { status: 'download_started', error: null };
}

async function readRecipeFile(file: File): Promise<RecipeFileImportResult> {
  if (file.size > MAX_MEDIA_PACKAGE_BYTES) return { status: 'failed', error: t(FILE_TOO_LARGE) };
  let content: string;
  try {
    content = await file.text();
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('菜谱文件读取失败，请检查文件是否完整后重试。') };
  }
  return validContent(content) ? { status: 'selected', content, error: null } : { status: 'failed', error: t(FILE_TOO_LARGE) };
}

export async function importRecipeFile(): Promise<RecipeFileImportResult> {
  if (typeof document === 'undefined') return { status: 'failed', error: t('浏览器不支持选择菜谱文件，请使用支持文件上传的浏览器重试。') };
  let input: HTMLInputElement;
  try {
    input = document.createElement('input');
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法准备菜谱文件选择器，请重新打开页面后重试。') };
  }
  input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'none';
  return new Promise(resolve => {
    let finished = false;
    const finish = (result: RecipeFileImportResult) => { if (finished) return; finished = true; input.remove(); resolve(result); };
    input.addEventListener('cancel', () => finish({ status: 'cancelled', error: null }), { once: true });
    input.addEventListener('change', () => {
      if (input.files && input.files.length > 1) { finish({ status: 'failed', error: t('请选择一个 FastCook 菜谱文件。') }); return; }
      const file = input.files?.[0];
      if (!file) { finish({ status: 'cancelled', error: null }); return; }
      void readRecipeFile(file).then(finish);
    }, { once: true });
    try {
      document.body.appendChild(input); input.click();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      finish({ status: 'failed', error: t('无法打开菜谱文件选择器，请允许访问文件后重试。') });
    }
  });
}

export async function shareRecipeFile(content: string): Promise<RecipeShareResult> {
  if (!validContent(content)) return { status: 'failed', error: t(FILE_TOO_LARGE) };
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function'
    || typeof navigator.share !== 'function' || typeof File !== 'function') return { status: 'unsupported', error: null };
  let file: File;
  try {
    file = new File([content], fileName(), { type: 'application/json' });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('菜谱分享文件未能生成，请重新打开页面后重试。') };
  }
  const data = { files: [file], title: t('FastCook 菜谱') };
  let supported: boolean;
  try {
    supported = navigator.canShare({ files: [file] });
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'unsupported', error: null };
  }
  if (!supported) return { status: 'unsupported', error: null };
  try {
    await navigator.share(data);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return error.name === 'AbortError' ? { status: 'cancelled', error: null }
      : { status: 'failed', error: t('菜谱分享未能开始，请重新点击分享，或导出文件后分享。') };
  }
  return { status: 'closed', error: null };
}
