import { normalize, type StorageKey, type StorageSchema } from './schema';
import { ownedKeys, readOwnership } from './ownership';

/**
 * Typed wrapper around chrome.storage.local.
 * Nothing else in the codebase should call chrome.storage directly.
 */

const area = () => chrome.storage.local;

/*
 * A page (YouTube, the dashboard, the popup) shows one owner's data. If the data changes hands while it
 * is open — someone signs out, or in as someone else — the page must not write what it still holds into
 * the new owner's keys. `bindToOwner` records whose data the page started with; from then on its writes
 * to owned keys are dropped once that is no longer true, and `onSwitch` runs (pages reload).
 */
let boundEpoch: number | null = null;

export async function bindToOwner(onSwitch: () => void): Promise<void> {
  boundEpoch = (await readOwnership()).epoch;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.ownership) return;
    if (normalize('ownership', changes.ownership.newValue).epoch !== boundEpoch) onSwitch();
  });
}

async function writable(keys: readonly string[]): Promise<boolean> {
  if (boundEpoch === null || !keys.some((k) => (ownedKeys() as readonly string[]).includes(k))) return true;
  if ((await readOwnership()).epoch === boundEpoch) return true;
  console.warn('[FocusSpace] Dropped a write from a page still showing the previous owner’s data.');
  return false;
}

export async function getItem<K extends StorageKey>(key: K): Promise<StorageSchema[K]> {
  const result = await area().get(key);
  return normalize(key, result[key]);
}

/** Whether a key was ever written — `getItem` cannot say, because it fills in defaults. For migrations. */
export async function hasItem(key: StorageKey): Promise<boolean> {
  const result = await area().get(key);
  return result[key] !== undefined;
}

export async function getItems<K extends StorageKey>(keys: readonly K[]): Promise<Pick<StorageSchema, K>> {
  const result = await area().get(keys as unknown as string[]);
  const out = {} as Pick<StorageSchema, K>;
  for (const key of keys) out[key] = normalize(key, result[key]);
  return out;
}

export async function setItem<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void> {
  if (!(await writable([key]))) return;
  await area().set({ [key]: value });
}

export async function setItems(values: Partial<StorageSchema>): Promise<void> {
  if (!(await writable(Object.keys(values)))) return;
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
