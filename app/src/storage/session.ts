import { t } from '../i18n/core.ts';
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
  let commitFallback: { pendingSaveRevision: number | null; error: string | null } | null = null;
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
      if (commitFallback?.pendingSaveRevision === saveRevision) commitFallback.error = result.error;
      if (saveRevision !== revision) return;
      publish({ state, error: result.error, saving: false });
    });
  }

  function validateUpdate(state: KitchenState): StorageResult<KitchenState> {
    const checked = validateKitchen(state, catalog);
    if (checked.error !== null) return checked;
    return success(state.privateRecipes === snapshot.state?.privateRecipes
      ? { ...checked.data, privateRecipes: state.privateRecipes } : checked.data);
  }

  const update: UpdateKitchen = (transform) => {
    if (restoring) { deferred.push(() => update(transform)); return; }
    if (snapshot.state === null) return;
    const candidate = { ...transform(snapshot.state), updatedAt: now() };
    const checked = validateUpdate(candidate);
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

  function persistConfirmed(state: KitchenState, preservePriorError = false): Promise<StorageResult<void>> {
    commitFallback = preservePriorError ? { pendingSaveRevision: snapshot.saving ? revision : null, error: snapshot.error } : null;
    restoring = true;
    revision += 1;
    publish({ ...snapshot, saving: true, error: null });
    const operation = queue.then(async () => {
      const result = await (needsReset ? storage.reset : storage.write)(JSON.stringify(state));
      if (result.error === null) {
        needsReset = false;
        publish({ state, saving: false, error: null });
      } else {
        publish({ ...snapshot, saving: false, error: preservePriorError ? commitFallback?.error ?? null : result.error });
      }
      commitFallback = null;
      restoring = false;
      for (const action of deferred.splice(0)) action();
      return result.error !== null ? result : success(undefined);
    });
    queue = operation.then(() => undefined);
    return operation;
  }

  async function restore(state: KitchenState): Promise<StorageResult<void>> {
    if (restoring) return failure(t('正在保存厨房记录，请等待完成后重试。'));
    if (snapshot.state === null) return failure(t('厨房记录尚未加载，请完成读取后再恢复备份。'));
    const checked = validateKitchen({ ...state, updatedAt: now() }, catalog);
    return checked.error !== null ? checked : persistConfirmed(checked.data);
  }

  async function commit(transform: (state: KitchenState) => StorageResult<KitchenState>): Promise<StorageResult<void>> {
    if (restoring) return failure(t('正在保存厨房记录，请等待完成后重试。'));
    if (snapshot.state === null) return failure(t('厨房记录尚未加载，请完成读取后再保存菜谱。'));
    const changed = transform(snapshot.state);
    if (changed.error !== null) return changed;
    const checked = validateUpdate({ ...changed.data, updatedAt: now() });
    return checked.error !== null ? checked : persistConfirmed(checked.data, true);
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
    commit,
    settled: () => queue,
  };
}
