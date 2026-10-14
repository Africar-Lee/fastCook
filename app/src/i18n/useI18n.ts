import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale, t } from './core';

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return { locale, t };
}
