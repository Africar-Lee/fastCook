import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createLanguageSession } from '../storage/language-session';
import { languageStorage } from '../storage/language';

export function useLanguagePreference() {
  const session = useMemo(() => createLanguageSession(languageStorage), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { void session.load(); }, [session]);
  return { ...snapshot, change: session.change, retry: session.load };
}

export type LanguagePreference = ReturnType<typeof useLanguagePreference>;
