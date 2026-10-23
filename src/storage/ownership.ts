import { defaultsFor, normalize, storageKeys, type Ownership, type StorageKey } from './schema';

/**
 * Local data ownership.
 *
 * Everything FocusSpace knows about a learner — Spaces, notes, mind maps, watch history, imported
 * subscriptions, preferences, and every cache derived from them — lives in `chrome.storage.local`. A
 * Chrome profile can be shared, so that data needs an owner: the guest (no account) or one account.
 *
 * The keys the rest of the code reads always hold exactly one owner's data (`ownership.owner`). Other
 * owners' data is set aside under `vault:<owner>`, and a switch replaces one with the other in a single
 * `chrome.storage.local.set`, which Chrome applies atomically. Nothing is merged: one person's data
 * never lands in another's keys, and it never goes to the server.
 */

/** Keys that describe the device or the session rather than a person. Everything else is owned. */
const DEVICE_KEYS: readonly StorageKey[] = ['schemaVersion', 'auth', 'ownership', 'pendingClaim', 'installId', 'welcome', 'health'];

/** Every key that belongs to a person — any key added to the schema later is owned unless listed above. */
let owned: readonly StorageKey[] | null = null;
export const ownedKeys = (): readonly StorageKey[] => (owned ??= storageKeys().filter((k) => !DEVICE_KEYS.includes(k)));

export const GUEST = 'guest';
const vaultKey = (owner: string) => `vault:${owner}`;
const area = () => chrome.storage.local;

type RawData = Partial<Record<StorageKey, unknown>>;

export async function readOwnership(): Promise<Ownership> {
  const raw = await area().get('ownership');
  return normalize('ownership', raw.ownership);
}

export async function hasVault(owner: string): Promise<boolean> {
  const key = vaultKey(owner);
  return (await area().get(key))[key] !== undefined;
}

/**
 * Whether the data in use holds anything a person made. A browser that was never set up has nothing
 * worth asking about, so signing in there needs no question.
 */
export async function activeDataIsEmpty(): Promise<boolean> {
  const raw = await area().get(['settings', 'modes', 'notes', 'watchHistory', 'channels', 'topicPlaylists']);
  const settings = normalize('settings', raw.settings);
  const notes = normalize('notes', raw.notes);
  const playlists = normalize('topicPlaylists', raw.topicPlaylists);
  return (
    !settings.onboarded &&
    normalize('modes', raw.modes).length === 0 &&
    Object.values(notes.byVideo).every((list) => list.length === 0) &&
    normalize('watchHistory', raw.watchHistory).length === 0 &&
    Object.keys(normalize('channels', raw.channels)).length === 0 &&
    Object.values(playlists).every((topics) => Object.values(topics).every((videos) => videos.length === 0))
  );
}

/**
 * Sets the data in use aside for its owner and brings in `next`'s — theirs from a previous visit, or a
 * clean start. The server address is a property of the device, so it stays. Returns the new epoch.
 */
export async function switchOwner(next: string): Promise<number> {
  const current = await readOwnership();
  const incomingKey = vaultKey(next);
  const raw = await area().get([...ownedKeys(), incomingKey]);

  const outgoing: RawData = {};
  for (const key of ownedKeys()) if (raw[key] !== undefined) outgoing[key] = raw[key];

  const stored = (raw[incomingKey] ?? {}) as RawData;
  const incoming: Record<string, unknown> = {};
  for (const key of ownedKeys()) incoming[key] = stored[key] !== undefined ? stored[key] : defaultsFor(key);

  // Keep this device's server address; everything else in settings belongs to the person.
  const deviceApi = normalize('settings', raw.settings).api;
  incoming.settings = { ...normalize('settings', incoming.settings), api: deviceApi };
  // A sync or import that was running belonged to the previous owner; it is not this one's.
  incoming.sync = { ...normalize('sync', incoming.sync), status: 'idle', progress: null };

  const epoch = current.epoch + 1;
  await area().set({ ...incoming, [vaultKey(current.owner)]: outgoing, ownership: { owner: next, epoch } });
  // The incoming vault is now the live data. If this removal is lost, the stale copy is harmless: it is
  // only ever read after this owner is switched away from again, which first overwrites it.
  await area().remove(incomingKey);
  return epoch;
}

/** Marks the data in use as `owner`'s without touching it — for a guest who chose to keep their data. */
export async function claimActiveData(owner: string): Promise<void> {
  const current = await readOwnership();
  await area().set({ ownership: { owner, epoch: current.epoch } });
}

/**
 * For work that reads now and writes later (a sync, a warm-up): true while the data still belongs to the
 * owner it started with. Check it just before writing, so nothing computed from one person's data is
 * written into another's.
 */
export async function ownerGuard(): Promise<() => Promise<boolean>> {
  const { epoch } = await readOwnership();
  return async () => (await readOwnership()).epoch === epoch;
}
