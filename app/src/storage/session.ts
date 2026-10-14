import type { AppCatalog, KitchenState, UpdateKitchen } from '../model/types';
import { decodeKitchen, initialKitchen, validateKitchen } from './state.ts';
import { failure, success } from './types.ts';
import type { KitchenStorage, StorageResult } from './types';

export type KitchenSnapshot = Readonly<{ state: KitchenState | null; error: string | null; saving: boolean }>;

export function createKitchenSession(catalog: AppCatalog, storage: KitchenStorage, now = () => new Date().toISOString()) {
  let snapshot: KitchenSnapshot = { state: null, error: null, saving: false };
  let queue = Promise.resolve();
  let revision = 0;
  let needsReset = false;
  let restoring = false;
  const deferred: (() => void)[] = [];
  const listeners = new Set<() => void>();

  function publish(next: KitchenSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function load() {
    if (restoring) { deferred.push(load); return; }
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
    if (restoring) { deferred.push(() => update(transform)); return; }
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
    if (restoring) { deferred.push(retry); return; }
    if (snapshot.state === null) load();
    else save(snapshot.state);
  }

  function reset() {
    if (restoring) { deferred.push(reset); return; }
    save({ ...initialKitchen(catalog), updatedAt: now() }, true);
  }

  async function restore(state: KitchenState): Promise<StorageResult<void>> {
    if (restoring) return failure('正在恢复厨房记录，请等待完成后重试。');
    if (snapshot.state === null) return failure('厨房记录尚未加载，请完成读取后再恢复备份。');
    const checked = validateKitchen({ ...state, updatedAt: now() }, catalog);
    if (checked.error !== null) return checked;
    restoring = true;
    revision += 1;
    publish({ ...snapshot, saving: true, error: null });
    const operation = queue.then(async () => {
      const result = await storage.write(JSON.stringify(checked.data));
      if (result.error === null) {
        needsReset = false;
        publish({ state: checked.data, saving: false, error: null });
      } else {
        publish({ ...snapshot, saving: false, error: result.error });
      }
      restoring = false;
      for (const action of deferred.splice(0)) action();
      return result.error !== null ? result : success(undefined);
    });
    queue = operation.then(() => undefined);
    return operation;
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
    restore,
    settled: () => queue,
  };
}
