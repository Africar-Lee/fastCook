import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createKitchenSession } from '../storage/session';
import { kitchenStorage } from '../storage/storage';
import type { AppCatalog } from './types';

export function useKitchen(catalog: AppCatalog) {
  const session = useMemo(() => createKitchenSession(catalog, kitchenStorage), [catalog]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => {
    session.load();
  }, [session]);

  return { ...snapshot, update: session.update, retry: session.retry, reset: session.reset, restore: session.restore };
}
