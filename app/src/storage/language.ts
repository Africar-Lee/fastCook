import Storage from 'expo-sqlite/kv-store';
import { t } from '../i18n/core';
import { failure, success } from './types';
import type { LanguageStorage } from './language-session';

const KEY = 'fastcook.language.v1';
export const languageStorage: LanguageStorage = {
  async read() {
    try { return success(await Storage.getItemAsync(KEY)); }
    catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return failure(t('读取语言设置失败，请重试。'));
    }
  },
  async write(value) {
    try { await Storage.setItemAsync(KEY, value); }
    catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      return failure(t('保存语言设置失败，请检查存储空间后重试。'));
    }
    return success(undefined);
  },
};
