export type StorageResult<T> = Readonly<{ data: T; error: null }> | Readonly<{ data: null; error: string }>;

export type KitchenStorage = Readonly<{
  read: () => Promise<StorageResult<string | null>>;
  write: (value: string) => Promise<StorageResult<void>>;
  reset: (value: string) => Promise<StorageResult<void>>;
}>;

export const MAX_STORAGE_BYTES = 2 * 1024 * 1024;
export const MAX_STORAGE_CHARACTERS = MAX_STORAGE_BYTES;

export function withinStorageLimit(value: string): boolean {
  return value.length <= MAX_STORAGE_CHARACTERS && new TextEncoder().encode(value).byteLength <= MAX_STORAGE_BYTES;
}

export function success<T>(data: T): StorageResult<T> {
  return { data, error: null };
}

export function failure<T>(error: string): StorageResult<T> {
  return { data: null, error };
}
