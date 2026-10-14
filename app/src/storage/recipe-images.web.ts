import { t } from '../i18n/core.ts';
import { isImageId, validateImage, validateImageAsset } from '../model/recipe-media.ts';
import type { RecipeImage, RecipeImageAsset } from '../model/recipe-media';
import { failure, success } from './types.ts';
import type { StorageResult } from './types';

const DATABASE = 'fastcook-recipe-images';
const STORE = 'images';
const READ_ERROR = '浏览器无法读取菜谱图片，请允许本站使用本地存储后重试。';
const WRITE_ERROR = '菜谱图片未保存，浏览器存储可能被禁用或已满，请检查设置后重试。';
const CLEANUP_ERROR = '浏览器无法清理菜谱图片，请检查存储权限后重试。';
let databasePromise: Promise<StorageResult<IDBDatabase>> | null = null;
let mutations = Promise.resolve();

function browserCall<Value>(operation: () => Value, message: string): StorageResult<Value> {
  try {
    return success(operation());
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(t(message));
  }
}

function openDatabase(): Promise<StorageResult<IDBDatabase>> {
  const opening = browserCall(() => globalThis.indexedDB.open(DATABASE, 1), READ_ERROR);
  if (opening.error !== null) return Promise.resolve(opening);
  const request = opening.data;
  return new Promise(resolve => {
    let finished = false;
    const finish = (result: StorageResult<IDBDatabase>) => { if (!finished) { finished = true; resolve(result); } };
    request.onupgradeneeded = () => {
      const created = browserCall(() => request.result.createObjectStore(STORE, { keyPath: 'id' }), READ_ERROR);
      if (created.error !== null) { request.transaction?.abort(); finish(created); }
    };
    request.onerror = () => finish(failure(t(READ_ERROR)));
    request.onblocked = () => finish(failure(t(READ_ERROR)));
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
      request.result.onclose = () => { databasePromise = null; };
      finish(success(request.result));
    };
  });
}

async function database(): Promise<StorageResult<IDBDatabase>> {
  databasePromise ??= openDatabase();
  const opened = await databasePromise;
  if (opened.error !== null) databasePromise = null;
  return opened;
}

async function transaction<Value>(mode: IDBTransactionMode, message: string,
  execute: (store: IDBObjectStore, result: (value: StorageResult<Value>) => void) => void): Promise<StorageResult<Value>> {
  const opened = await database();
  if (opened.error !== null) return opened;
  const started = browserCall(() => opened.data.transaction(STORE, mode), message);
  if (started.error !== null) return started;
  const active = started.data;
  return new Promise(resolve => {
    let result: StorageResult<Value> = failure(t(message));
    active.oncomplete = () => resolve(result);
    active.onabort = () => resolve(failure(t(message)));
    active.onerror = () => resolve(failure(t(message)));
    const executed = browserCall(() => execute(active.objectStore(STORE), value => { result = value; }), message);
    if (executed.error !== null) { active.abort(); resolve(executed); }
  });
}

function sameImage(left: RecipeImage, right: RecipeImage): boolean {
  return left.id === right.id && left.width === right.width && left.height === right.height && left.bytes === right.bytes;
}

async function putImage(asset: RecipeImageAsset): Promise<StorageResult<void>> {
  const checked = validateImageAsset(asset);
  if (checked.error !== null) return checked;
  return transaction('readwrite', WRITE_ERROR, (store, finish) => {
    const requested = store.get(checked.data.id);
    requested.onsuccess = () => {
      if (requested.result !== undefined) {
        const existing = validateImageAsset(requested.result);
        finish(existing.error !== null ? existing : sameImage(existing.data, checked.data) && existing.data.base64 === checked.data.base64
          ? success(undefined) : failure(t('菜谱图片编号冲突，请重新选择图片。')));
        return;
      }
      const added = browserCall(() => store.add(checked.data), WRITE_ERROR);
      if (added.error !== null) { finish(added); return; }
      added.data.onsuccess = () => finish(success(undefined));
    };
  });
}

async function read(image: RecipeImage): Promise<StorageResult<RecipeImageAsset>> {
  const checked = validateImage(image);
  if (checked.error !== null) return checked;
  return transaction('readonly', READ_ERROR, (store, finish) => {
    const requested = store.get(checked.data.id);
    requested.onsuccess = () => {
      if (requested.result === undefined) { finish(failure(t('菜谱图片已丢失，请重新添加图片。'))); return; }
      const stored = validateImageAsset(requested.result);
      if (stored.error !== null) { finish(stored); return; }
      finish(sameImage(stored.data, checked.data) ? stored : failure(t(READ_ERROR)));
    };
  });
}

async function resolve(image: RecipeImage): Promise<StorageResult<string>> {
  const stored = await read(image);
  return stored.error !== null ? stored : success(`data:image/jpeg;base64,${stored.data.base64}`);
}

async function pruneImages(keepIds: readonly string[]): Promise<StorageResult<void>> {
  if (!Array.isArray(keepIds) || !keepIds.every(isImageId)) return failure(t(CLEANUP_ERROR));
  const keep = new Set(keepIds);
  return transaction('readwrite', CLEANUP_ERROR, (store, finish) => {
    const requested = store.openCursor();
    requested.onsuccess = () => {
      const cursor = requested.result;
      if (!cursor) { finish(success(undefined)); return; }
      const advanced = browserCall(() => {
        if (isImageId(cursor.key) && !keep.has(cursor.key)) cursor.delete();
        cursor.continue();
      }, CLEANUP_ERROR);
      if (advanced.error !== null) { finish(advanced); store.transaction.abort(); }
    };
  });
}

function enqueue(operation: () => Promise<StorageResult<void>>): Promise<StorageResult<void>> {
  const result = mutations.then(operation);
  mutations = result.then(() => undefined);
  return result;
}

export const imageStore = {
  put: (asset: RecipeImageAsset) => enqueue(() => putImage(asset)),
  read,
  resolve,
  prune: (keepIds: readonly string[]) => enqueue(() => pruneImages(keepIds)),
};
