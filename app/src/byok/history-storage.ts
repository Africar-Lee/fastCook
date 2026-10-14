import { t } from '../i18n/core.ts';
import { openDatabaseAsync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';

const MAX_HISTORY_CHARACTERS = 131_072;
let databasePromise: Promise<StorageResult<SQLiteDatabase>> | null = null;

async function sqliteCall<T>(operation: () => Promise<T>, message: string): Promise<StorageResult<T>> {
  try { return success(await operation()); } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(message);
  }
}

async function database(): Promise<StorageResult<SQLiteDatabase>> {
  databasePromise ??= sqliteCall(() => openDatabaseAsync('fastcook-vision.db'), t('无法打开识别记录，请检查设备剩余空间后重试。'));
  const result = await databasePromise;
  if (result.error !== null) { databasePromise = null; return result; }
  const initialized = await sqliteCall(() => result.data.execAsync('CREATE TABLE IF NOT EXISTS vision_history (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)'), t('无法初始化识别记录，请检查设备剩余空间后重试。'));
  return initialized.error !== null ? initialized : result;
}

export const historyStorage = {
  async read(): Promise<StorageResult<string | null>> {
    const opened = await database();
    if (opened.error !== null) return opened;
    const result = await sqliteCall(() => opened.data.getFirstAsync<{ payload: unknown; payload_length: number }>(
      'SELECT CASE WHEN length(payload) <= ? THEN payload ELSE NULL END AS payload, length(payload) AS payload_length FROM vision_history WHERE id = 1', MAX_HISTORY_CHARACTERS,
    ), t('无法读取识别记录，请重试。'));
    if (result.error !== null) return result;
    if (!result.data) return success(null);
    if (result.data.payload_length > MAX_HISTORY_CHARACTERS || typeof result.data.payload !== 'string') return failure(t('识别记录过大或损坏，请检查本地存储。'));
    return success(result.data.payload);
  },
  async write(value: string): Promise<StorageResult<void>> {
    if (value.length > MAX_HISTORY_CHARACTERS) return failure(t('识别记录过大，本次操作未保存。'));
    const opened = await database();
    if (opened.error !== null) return opened;
    const result = await sqliteCall(() => opened.data.runAsync('INSERT INTO vision_history (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload', value), t('识别记录未保存，请检查设备剩余空间后重试。'));
    return result.error !== null ? result : success(undefined);
  },
};
