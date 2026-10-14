import { t } from '../i18n/core.ts';
import * as SecureStore from 'expo-secure-store';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import { createCredentialStore } from './config.ts';

const CREDENTIAL_KEY = 'fastcook.vision.credentials.v1';

async function secureCall<T>(operation: () => Promise<T>, message: string): Promise<StorageResult<T>> {
  try { return success(await operation()); } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(message);
  }
}

export const credentialStore = createCredentialStore({
  read: () => secureCall(() => SecureStore.getItemAsync(CREDENTIAL_KEY), t('无法读取模型密钥，请解锁设备后重试。')),
  write: value => secureCall(() => SecureStore.setItemAsync(CREDENTIAL_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }), t('模型配置未保存，请解锁设备并检查剩余空间后重试。')),
  remove: () => secureCall(() => SecureStore.deleteItemAsync(CREDENTIAL_KEY), t('模型密钥未删除，请解锁设备后重试。')),
});
