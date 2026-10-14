import type { RecipeReport } from '../model/recipe-report';
import { reportFileName } from './report-export-result.ts';
import type { ReportExportResult } from './report-export-result';

export async function exportRecipeReport(report: RecipeReport): Promise<ReportExportResult> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { status: 'failed', error: '浏览器不支持导出文件，请使用支持下载的浏览器重试。' };
  }
  const content = JSON.stringify(report, null, 2);
  let link: HTMLAnchorElement;
  try {
    link = document.createElement('a');
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: '报告下载未能准备，请重新打开页面后重试。' };
  }
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: '报告文件未能生成，请重新打开页面后重试。' };
  }
  link.href = url;
  link.download = reportFileName();
  try {
    link.click();
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: '报告下载未能开始，请允许本站下载文件后重试。' };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { status: 'download_started', error: null };
}
