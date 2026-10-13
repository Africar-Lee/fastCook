import type { AppCatalog, KitchenState, UpdateKitchen } from '../model/types';
import { decodeKitchen, initialKitchen, validateKitchen } from './state.ts';
import type { KitchenStorage } from './types';

export type KitchenSnapshot = Readonly<{ state: KitchenState | null; error: string | null; saving: boolean }>;

export function createKitchenSession(catalog: AppCatalog, storage: KitchenStorage, now = () => new Date().toISOString()) {
  let snapshot: KitchenSnapshot = { state: null, error: null, saving: false };
  let queue = Promise.resolve();
  let revision = 0;
  let needsReset = false;
  const listeners = new Set<() => void>();

  function publish(next: KitchenSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function load() {
    const loadRevision = ++revision;
    publish({ state: null, error: null, saving: false });
    queue = queue.then(async () => {
      const stored = await storage.read();
      if (loadRevision !== revision) return;
      const result = stored.error !== null ? stored : decodeKitchen(stored.data, catalog);
      publish(result.error !== null ? { state: null, error: result.error, saving: false } : { state: result.data, error: null, saving: false });
    });
  }

  function save(state: KitchenState, reset = false) {
    if (reset) needsReset = true;
    const saveRevision = ++revision;
    publish({ state, error: null, saving: true });
    queue = queue.then(async () => {
      const resetStore = reset || needsReset;
      const result = await (resetStore ? storage.reset : storage.write)(JSON.stringify(state));
      if (resetStore && result.error === null) needsReset = false;
      if (saveRevision !== revision) return;
      publish({ state, error: result.error, saving: false });
    });
  }

  const update: UpdateKitchen = (transform) => {
    if (snapshot.state === null) return;
    const candidate = { ...transform(snapshot.state), updatedAt: now() };
    const checked = validateKitchen(candidate, catalog);
    if (checked.error !== null) {
      revision += 1;
      publish({ ...snapshot, saving: false, error: checked.error });
      return;
    }
    save(checked.data);
  };

  function retry() {
    if (snapshot.state === null) load();
    else save(snapshot.state);
  }

  function reset() {
    save({ ...initialKitchen(catalog), updatedAt: now() }, true);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    update,
    retry,
    reset,
    settled: () => queue,
  };
}
