import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '@/test/fake-chrome';
import { storageKeys } from './schema';
import { activeDataIsEmpty, claimActiveData, ownedKeys, ownerGuard, readOwnership, switchOwner } from './ownership';

const note = (videoId: string) => ({ id: `n-${videoId}`, videoId, format: 'notes', language: 'en', range: null, markdown: 'x', mindmap: null, conceptIds: [], contextVersion: 1, createdAt: 1, updatedAt: 1, provenance: {} });

/** A's data as it would sit in the live keys. */
const personData = (who: string) => ({
  modes: [{ id: `${who}-space`, name: `${who}'s space`, createdAt: 1, updatedAt: 1 }],
  notes: { version: 1, byVideo: { [`${who}-video`]: [note(`${who}-video`)] } },
  watchHistory: [{ videoId: `${who}-watched`, title: 'Watched', watchedAt: 1 }],
  channels: { [`${who}-channel`]: { id: `${who}-channel`, title: 'Channel' } },
  settings: { onboarded: true, activeModeId: `${who}-space`, displayName: who, api: { baseUrl: 'https://device.example' } },
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.resetModules();
});

describe('which keys belong to a person', () => {
  it('every key except the device/session ones is owned — a key added later is owned by default', () => {
    expect([...ownedKeys()].sort()).toEqual(storageKeys().filter((k) => !['schemaVersion', 'auth', 'ownership', 'pendingClaim', 'installId', 'welcome', 'health'].includes(k)).sort());
    for (const key of ['settings', 'modes', 'notes', 'watchHistory', 'channels', 'videos', 'topicPlaylists', 'preferenceProfiles', 'feedViews', 'knowledgeMaps', 'discoveryCache'] as const) {
      expect(ownedKeys()).toContain(key);
    }
  });
});

describe('switching owner', () => {
  it('sets the current owner’s data aside and starts the next one clean', async () => {
    const data = fakeChrome({ ...personData('A'), ownership: { owner: 'user-a', epoch: 3 } });
    expect(await switchOwner('guest')).toBe(4);

    expect(await readOwnership()).toEqual({ owner: 'guest', epoch: 4 });
    expect(data.modes).toEqual([]);
    expect(data.notes).toEqual({ version: 1, byVideo: {} });
    expect(data.watchHistory).toEqual([]);
    expect(data.channels).toEqual({});
    expect((data['vault:user-a'] as Record<string, unknown>).notes).toEqual(personData('A').notes);
  });

  it('brings back an owner’s own data from an earlier visit, and removes it from the vault', async () => {
    const data = fakeChrome({ ...personData('B'), ownership: { owner: 'guest', epoch: 1 }, 'vault:user-a': personData('A') });
    await switchOwner('user-a');
    expect(data.modes).toEqual(personData('A').modes);
    expect(data.notes).toEqual(personData('A').notes);
    expect(data['vault:user-a']).toBeUndefined();
    expect((data['vault:guest'] as Record<string, unknown>).modes).toEqual(personData('B').modes);
  });

  it('keeps this device’s server address, and nothing else from the previous owner’s settings', async () => {
    const data = fakeChrome({ ...personData('A'), ownership: { owner: 'user-a', epoch: 0 } });
    await switchOwner('guest');
    const settings = data.settings as { api: { baseUrl: string }; displayName: string; onboarded: boolean };
    expect(settings.api.baseUrl).toBe('https://device.example');
    expect(settings.displayName).toBe('');
    expect(settings.onboarded).toBe(false);
  });

  it('claiming keeps the data exactly as it is and does not change the epoch', async () => {
    const data = fakeChrome({ ...personData('G'), ownership: { owner: 'guest', epoch: 2 } });
    await claimActiveData('user-a');
    expect(await readOwnership()).toEqual({ owner: 'user-a', epoch: 2 });
    expect(data.notes).toEqual(personData('G').notes);
  });

  it('knows an untouched browser from one someone has used', async () => {
    fakeChrome({});
    expect(await activeDataIsEmpty()).toBe(true);
    fakeChrome({ notes: personData('G').notes });
    expect(await activeDataIsEmpty()).toBe(false);
    fakeChrome({ settings: { onboarded: true } });
    expect(await activeDataIsEmpty()).toBe(false);
  });
});

describe('work that outlives a switch', () => {
  it('ownerGuard turns false once the data belongs to someone else', async () => {
    fakeChrome({ ownership: { owner: 'user-a', epoch: 0 } });
    const stillOwner = await ownerGuard();
    expect(await stillOwner()).toBe(true);
    await switchOwner('guest');
    expect(await stillOwner()).toBe(false);
  });

  it('a page bound to the previous owner has its writes dropped, and is told to reload', async () => {
    const data = fakeChrome({ ...personData('A'), ownership: { owner: 'user-a', epoch: 0 } });
    const storage = await import('./storage');
    const onSwitch = vi.fn();
    await storage.bindToOwner(onSwitch);

    await storage.setItem('watchHistory', [{ videoId: 'before' } as never]);
    expect(data.watchHistory).toEqual([{ videoId: 'before' }]);

    await switchOwner('user-b');
    expect(onSwitch).toHaveBeenCalled();

    // Still open, still holding A's state: nothing it writes may land in B's keys.
    await storage.setItem('watchHistory', [{ videoId: 'stale-from-a' } as never]);
    await storage.updateItem('notes', () => personData('A').notes as never);
    await storage.setItems({ modes: personData('A').modes as never });
    expect(data.watchHistory).toEqual([]);
    expect(data.notes).toEqual({ version: 1, byVideo: {} });
    expect(data.modes).toEqual([]);
  });
});
