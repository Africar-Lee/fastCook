import { failure, MAX_STORAGE_CHARACTERS, success } from './types.ts';
import type { KitchenStorage, StorageResult } from './types';

const STORAGE_KEY = 'fastcook.kitchen.v1';

async function read(): Promise<StorageResult<string | null>> {
  try {
    return success(globalThis.localStorage.getItem(STORAGE_KEY));
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure('浏览器未能读取厨房记录，请允许本站使用本地存储后重试。');
  }
}

async function write(value: string): Promise<StorageResult<void>> {
  if (value.length > MAX_STORAGE_CHARACTERS) return failure('厨房记录过大，本次修改未保存，请减少已选食材后重试。');
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, value);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure('厨房记录未保存，浏览器存储可能被禁用或已满，请检查设置后重试。');
  }
  return success(undefined);
}

export const kitchenStorage: KitchenStorage = { read, write, reset: write };
