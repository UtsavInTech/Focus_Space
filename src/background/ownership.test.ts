import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '@/test/fake-chrome';
import { readOwnership } from '@/storage/ownership';
import { getItems, setItem } from '@/storage/storage';
import { reconcileOwnership, resolveClaim, startOwnership } from './ownership';

/**
 * The scenarios from the product spec, end to end through the background: who is signed in decides
 * whose data is in use, and one account never sees another's.
 */

const signedIn = (id: string, email = `${id}@example.com`) => ({
  user: { id, email, createdAt: 1 },
  accessToken: `token-${id}`,
  accessTokenExpiresAt: Date.now() + 3_600_000,
  refreshToken: `refresh-${id}`,
});
const SIGNED_OUT = { user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null };

const note = (videoId: string) => ({ id: `n-${videoId}`, videoId, format: 'notes', language: 'en', range: null, markdown: 'x', mindmap: null, conceptIds: [], contextVersion: 1, createdAt: 1, updatedAt: 1, provenance: {} });
const work = (who: string) => ({
  modes: [{ id: `${who}-space`, name: `${who}'s space`, createdAt: 1, updatedAt: 1 }],
  notes: { version: 1, byVideo: { [`${who}-video`]: [note(`${who}-video`)] } },
  watchHistory: [{ videoId: `${who}-watched`, title: 'Watched', watchedAt: 1 }],
  channels: { [`${who}-channel`]: { id: `${who}-channel`, title: 'Channel' } },
  topicPlaylists: { [`${who}-space`]: { t: [{ videoId: `${who}-saved` }] } },
  settings: { onboarded: true, activeModeId: `${who}-space`, api: { baseUrl: 'https://api.example' } },
});

/** Everything a person could see: if none of it mentions `who`, they are not visible. */
async function visibleMentions(who: string): Promise<boolean> {
  const live = await getItems(['modes', 'notes', 'watchHistory', 'channels', 'topicPlaylists', 'settings']);
  return JSON.stringify(live).includes(`${who}-`);
}

const signIn = async (id: string) => {
  await setItem('auth', signedIn(id) as never);
  await reconcileOwnership();
};
const signOut = async () => {
  await setItem('auth', SIGNED_OUT as never);
  await reconcileOwnership();
};

let registered: string[] = [];
beforeEach(() => {
  registered = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/v1/me/spaces') && init?.method === 'POST') registered.push(JSON.parse(String(init.body)).spaceId);
      return { ok: true, status: 200, json: async () => ({ ok: true, plan: 'free', used: registered.length, limit: 5 }) };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('user A signs out, user B signs in on the same Chrome profile', () => {
  it('B never sees A’s Spaces, notes, history, subscriptions or saved videos', async () => {
    fakeChrome({ ...work('A'), auth: signedIn('user-a'), ownership: { owner: 'user-a', epoch: 0 } });

    await signOut();
    expect(await visibleMentions('A')).toBe(false);
    expect(await readOwnership()).toMatchObject({ owner: 'guest' });

    await signIn('user-b');
    expect(await visibleMentions('A')).toBe(false);
    expect(await readOwnership()).toMatchObject({ owner: 'user-b' });
    // A's data is not even offered to B.
    expect((await getItems(['pendingClaim'])).pendingClaim).toBeNull();
  });

  it('A gets their own data back when they sign in again — and B’s stays B’s', async () => {
    fakeChrome({ ...work('A'), auth: signedIn('user-a'), ownership: { owner: 'user-a', epoch: 0 } });
    await signOut();
    await signIn('user-b');
    await setItem('notes', work('B').notes as never);
    await signOut();
    await signIn('user-a');

    expect(await visibleMentions('A')).toBe(true);
    expect(await visibleMentions('B')).toBe(false);
  });

  it('switching straight from A to B, without signing out, still swaps the data', async () => {
    fakeChrome({ ...work('A'), auth: signedIn('user-a'), ownership: { owner: 'user-a', epoch: 0 } });
    await signIn('user-b');
    expect(await visibleMentions('A')).toBe(false);
  });

  it('every switch clears what the worker holds in memory (AI answers, usage)', async () => {
    fakeChrome({ ...work('A'), auth: signedIn('user-a'), ownership: { owner: 'user-a', epoch: 0 } });
    const onSwitch = vi.fn();
    startOwnership({ onSwitch });
    await reconcileOwnership();
    expect(onSwitch).not.toHaveBeenCalled();
    await signOut();
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});

describe('a guest signs in for the first time', () => {
  it('with nothing in the browser, the account simply takes over — no question', async () => {
    const data = fakeChrome({ auth: SIGNED_OUT });
    await signIn('user-a');
    expect(await readOwnership()).toMatchObject({ owner: 'user-a' });
    expect(data.pendingClaim ?? null).toBeNull();
  });

  it('with work in the browser, they are asked — and nothing is attached until they answer', async () => {
    fakeChrome({ ...work('G'), auth: SIGNED_OUT });
    await signIn('user-a');
    expect(await readOwnership()).toMatchObject({ owner: 'guest' });
    expect((await getItems(['pendingClaim'])).pendingClaim).toEqual({ userId: 'user-a', email: 'user-a@example.com' });
    // Asking again (the worker restarting, another auth write) does not change the question.
    await reconcileOwnership();
    expect((await getItems(['pendingClaim'])).pendingClaim?.userId).toBe('user-a');
  });

  it('"Keep with my account": the work becomes theirs as it is, and its Spaces are registered', async () => {
    fakeChrome({ ...work('G'), auth: SIGNED_OUT });
    await signIn('user-a');
    expect(await resolveClaim(true)).toEqual({ ok: true });

    expect(await readOwnership()).toMatchObject({ owner: 'user-a', epoch: 0 });
    expect(await visibleMentions('G')).toBe(true);
    expect(registered).toEqual(['G-space']);
    // It goes with the account: signing out hides it, signing back in returns it.
    await signOut();
    expect(await visibleMentions('G')).toBe(false);
    await signIn('user-a');
    expect(await visibleMentions('G')).toBe(true);
  });

  it('"Start fresh": the account starts clean, and the guest’s work returns on sign-out', async () => {
    fakeChrome({ ...work('G'), auth: SIGNED_OUT });
    await signIn('user-a');
    expect(await resolveClaim(false)).toEqual({ ok: true });

    expect(await readOwnership()).toMatchObject({ owner: 'user-a' });
    expect(await visibleMentions('G')).toBe(false);
    expect(registered).toEqual([]);
    await signOut();
    expect(await visibleMentions('G')).toBe(true);
  });

  it('signing out without answering withdraws the offer', async () => {
    fakeChrome({ ...work('G'), auth: SIGNED_OUT });
    await signIn('user-a');
    await signOut();
    expect((await getItems(['pendingClaim'])).pendingClaim).toBeNull();
    expect(await visibleMentions('G')).toBe(true);
  });

  it('an offer made to A cannot be answered by B', async () => {
    fakeChrome({ ...work('G'), auth: SIGNED_OUT });
    await signIn('user-a');
    await setItem('auth', signedIn('user-b') as never); // B signs in before the offer is cleared
    expect(await resolveClaim(true)).toEqual({ ok: false });
    expect(await readOwnership()).toMatchObject({ owner: 'guest' });
  });

  it('a guest whose account already has data here gets that back; the guest’s work is set aside, not merged', async () => {
    fakeChrome({ ...work('A'), auth: signedIn('user-a'), ownership: { owner: 'user-a', epoch: 0 } });
    await signOut();
    await setItem('notes', work('G').notes as never); // used as a guest meanwhile
    await signIn('user-a');

    expect(await visibleMentions('A')).toBe(true);
    expect(await visibleMentions('G')).toBe(false);
    expect((await getItems(['pendingClaim'])).pendingClaim).toBeNull();
    await signOut();
    expect(await visibleMentions('G')).toBe(true);
  });
});
