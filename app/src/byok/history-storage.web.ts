import { t } from '../i18n/core.ts';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';

const STORAGE_KEY = 'fastcook.vision.history.v1';

export const historyStorage = {
  async read(): Promise<StorageResult<string | null>> {
    let value: string | null;
    try { value = globalThis.localStorage.getItem(STORAGE_KEY); } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return failure(t('无法读取识别记录，请允许本站使用本地存储后重试。'));
    }
    if (value !== null && value.length > 131_072) return failure(t('识别记录过大或损坏，请检查本地存储。'));
    return success(value);
  },
  async write(value: string): Promise<StorageResult<void>> {
    if (value.length > 131_072) return failure(t('识别记录过大，本次操作未保存。'));
    try { globalThis.localStorage.setItem(STORAGE_KEY, value); } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return failure(t('识别记录未保存，浏览器存储可能被禁用或已满，请检查设置后重试。'));
    }
    return success(undefined);
  },
};
