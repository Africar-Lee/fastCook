import { t } from '../i18n/core.ts';
import { openDatabaseAsync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { failure, MAX_STORAGE_BYTES, success, withinStorageLimit } from './types.ts';
import type { KitchenStorage, StorageResult } from './types';

let databasePromise: Promise<StorageResult<SQLiteDatabase>> | null = null;
const CREATE_TABLE = 'CREATE TABLE IF NOT EXISTS kitchen_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)';
const WRITE_STATE = 'INSERT INTO kitchen_state (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload';

async function sqliteCall<T>(operation: () => Promise<T>, message: string): Promise<StorageResult<T>> {
  try {
    return success(await operation());
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return failure(message);
  }
}

async function getDatabase(): Promise<StorageResult<SQLiteDatabase>> {
  databasePromise ??= sqliteCall(() => openDatabaseAsync('fastcook-kitchen.db'), t('无法打开本地厨房记录，请检查设备剩余空间后重试。'));
  const result = await databasePromise;
  if (result.error !== null) databasePromise = null;
  return result;
}

async function initialize(database: SQLiteDatabase): Promise<StorageResult<void>> {
  const version = await sqliteCall(() => database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'), t('无法读取厨房数据库版本，请重试。'));
  if (version.error !== null) return version;
  if (version.data?.user_version === 1) return success(undefined);
  if (version.data?.user_version !== 0) return failure(t('厨房数据库版本暂不支持，请升级应用，或确认后重置本地记录。'));
  return sqliteCall(() => database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(CREATE_TABLE);
    await transaction.execAsync('PRAGMA user_version = 1');
  }), t('初始化厨房数据库失败，请检查设备剩余空间后重试。'));
}

async function read(): Promise<StorageResult<string | null>> {
  const opened = await getDatabase();
  if (opened.error !== null) return opened;
  const initialized = await initialize(opened.data);
  if (initialized.error !== null) return initialized;
  const result = await sqliteCall(() => opened.data.getFirstAsync<{ payload: unknown; payload_length: number }>(
    'SELECT CASE WHEN length(CAST(payload AS BLOB)) <= ? THEN payload ELSE NULL END AS payload, length(CAST(payload AS BLOB)) AS payload_length FROM kitchen_state WHERE id = 1', MAX_STORAGE_BYTES,
  ), t('读取厨房记录失败，请重试读取；确认记录无需保留后也可重置。'));
  if (result.error !== null) return result;
  if (!result.data) return success(null);
  if (result.data.payload_length > MAX_STORAGE_BYTES || typeof result.data.payload !== 'string') return failure(t('本地厨房记录过大或格式损坏，请确认后重置本地记录。'));
  return success(result.data.payload);
}

async function write(value: string): Promise<StorageResult<void>> {
  if (!withinStorageLimit(value)) return failure(t('厨房记录超过 2 MiB，本次修改未保存，请减少自建菜谱内容后重试。'));
  const opened = await getDatabase();
  if (opened.error !== null) return opened;
  const initialized = await initialize(opened.data);
  if (initialized.error !== null) return initialized;
  const result = await sqliteCall(() => opened.data.runAsync(WRITE_STATE, value), t('厨房记录未保存，请检查设备剩余空间后重试。'));
  return result.error !== null ? result : success(undefined);
}

async function reset(value: string): Promise<StorageResult<void>> {
  if (!withinStorageLimit(value)) return failure(t('厨房记录超过 2 MiB，重置已取消。'));
  const opened = await getDatabase();
  if (opened.error !== null) return opened;
  return sqliteCall(() => opened.data.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync('DROP TABLE IF EXISTS kitchen_state');
    await transaction.execAsync(CREATE_TABLE);
    await transaction.runAsync(WRITE_STATE, value);
    await transaction.execAsync('PRAGMA user_version = 1');
  }), t('重置厨房记录失败，原记录仍保留，请检查设备剩余空间后重试。'));
}

export const kitchenStorage: KitchenStorage = { read, write, reset };
