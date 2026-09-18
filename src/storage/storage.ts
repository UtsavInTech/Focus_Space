import { normalize, type StorageKey, type StorageSchema } from './schema';

/**
 * Typed wrapper around chrome.storage.local.
 * Nothing else in the codebase should call chrome.storage directly.
 */

const area = () => chrome.storage.local;

export async function getItem<K extends StorageKey>(key: K): Promise<StorageSchema[K]> {
  const result = await area().get(key);
  return normalize(key, result[key]);
}

export async function getItems<K extends StorageKey>(keys: readonly K[]): Promise<Pick<StorageSchema, K>> {
  const result = await area().get(keys as unknown as string[]);
  const out = {} as Pick<StorageSchema, K>;
  for (const key of keys) out[key] = normalize(key, result[key]);
  return out;
}

export async function setItem<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void> {
  await area().set({ [key]: value });
}

export async function setItems(values: Partial<StorageSchema>): Promise<void> {
  await area().set(values);
}

/*
 * Read-modify-write, serialised per key within this JS context so rapid
 * updates from one surface (e.g. typing in a form) never clobber each other.
 */
const locks = new Map<StorageKey, Promise<unknown>>();

export function updateItem<K extends StorageKey>(
  key: K,
  updater: (current: StorageSchema[K]) => StorageSchema[K],
): Promise<StorageSchema[K]> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await getItem(key);
      const value = updater(current);
      await setItem(key, value);
      return value;
    });
  locks.set(key, next);
  return next;
}

export type StorageChanges = Partial<{ [K in StorageKey]: StorageSchema[K] }>;

/** Subscribe to changes of specific keys. Returns an unsubscribe function. */
export function subscribe<K extends StorageKey>(keys: readonly K[], listener: (changes: Pick<StorageChanges, K>) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local') return;
    const relevant: StorageChanges = {};
    let hit = false;
    for (const key of keys) {
      if (key in changes) {
        (relevant as Record<string, unknown>)[key] = normalize(key, changes[key].newValue);
        hit = true;
      }
    }
    if (hit) listener(relevant as Pick<StorageChanges, K>);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
