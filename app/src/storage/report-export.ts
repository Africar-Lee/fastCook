import { t } from '../i18n/core.ts';
import { Directory } from 'expo-file-system';
import type { File } from 'expo-file-system';
import type { RecipeReport } from '../model/recipe-report';
import { reportFileName } from './report-export-result.ts';
import type { ReportExportResult } from './report-export-result';

export async function exportRecipeReport(report: RecipeReport): Promise<ReportExportResult> {
  const content = JSON.stringify(report, null, 2);
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync();
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_PICKER_CANCELLED') {
      return { status: 'cancelled', error: null };
    }
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法打开保存目录，请重新选择并允许访问该目录。') };
  }
  let file: File;
  try {
    file = directory.createFile(reportFileName(), 'application/json');
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法创建报告文件，请选择可写入的目录后重试。') };
  }
  try {
    file.write(content);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('报告未能完整保存，请检查存储空间和目录权限后重试。') };
  }
  return { status: 'saved', error: null };
}
