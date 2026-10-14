import { t } from '../i18n/core.ts';
import { failure, success, withinStorageLimit } from './types.ts';
import type { KitchenStorage, StorageResult } from './types';

const STORAGE_KEY = 'fastcook.kitchen.v1';

async function read(): Promise<StorageResult<string | null>> {
  let value: string | null;
  try {
    value = globalThis.localStorage.getItem(STORAGE_KEY);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(t('浏览器未能读取厨房记录，请允许本站使用本地存储后重试。'));
  }
  if (value !== null && !withinStorageLimit(value)) return failure(t('本地厨房记录超过 2 MiB，读取已停止，请确认后重置本地记录。'));
  return success(value);
}

async function write(value: string): Promise<StorageResult<void>> {
  if (!withinStorageLimit(value)) return failure(t('厨房记录超过 2 MiB，本次修改未保存，请减少自建菜谱内容后重试。'));
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, value);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(t('厨房记录未保存，浏览器存储可能被禁用或已满，请检查设置后重试。'));
  }
  return success(undefined);
}

export const kitchenStorage: KitchenStorage = { read, write, reset: write };
