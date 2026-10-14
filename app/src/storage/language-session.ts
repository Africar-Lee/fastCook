import { isLocale, setLocale, t } from '../i18n/core.ts';
import type { Locale } from '../i18n/core';
import { failure, success } from './types.ts';
import type { StorageResult } from './types';

export type LanguageStorage = Readonly<{
  read: () => Promise<StorageResult<string | null>>;
  write: (value: Locale) => Promise<StorageResult<void>>;
}>;
type Snapshot = Readonly<{ locale: Locale; ready: boolean; saving: boolean; error: string | null }>;

export function createLanguageSession(storage: LanguageStorage) {
  let snapshot: Snapshot = { locale: 'zh-CN', ready: false, saving: false, error: null };
  let revision = 0;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  async function load() {
    if (snapshot.saving) return;
    const current = ++revision;
    const result = await storage.read();
    if (current !== revision) return;
    if (result.error !== null) { publish({ ...snapshot, ready: true, error: result.error }); return; }
    if (result.data !== null && !isLocale(result.data)) {
      publish({ ...snapshot, ready: true, error: t('语言设置无效，请重新选择语言。') }); return;
    }
    const locale = result.data ?? 'zh-CN';
    setLocale(locale);
    publish({ locale, ready: true, saving: false, error: null });
  }
  async function change(value: string): Promise<StorageResult<void>> {
    if (!isLocale(value)) return failure(t('请选择简体中文或英语。'));
    if (snapshot.saving) return failure(t('正在保存语言设置，请稍后重试。'));
    revision += 1;
    publish({ ...snapshot, saving: true, error: null });
    const result = await storage.write(value);
    if (result.error !== null) { publish({ ...snapshot, saving: false, error: result.error }); return result; }
    setLocale(value);
    publish({ locale: value, ready: true, saving: false, error: null });
    return success(undefined);
  }
  return { getSnapshot: () => snapshot, load, change,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
