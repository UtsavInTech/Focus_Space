import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchExternal, fakeChrome } from '@/test/fake-chrome';
import { getItem } from '@/storage/storage';

/**
 * The extension half of "one FocusSpace account".
 *
 * The website cannot hand over its session — different origins, no shared storage — so it passes a
 * single-use code and the extension redeems it for a session of its own (server/auth/handoff.ts). What
 * matters here, and what these cover:
 *
 * - a redeemed handoff leaves a real signed-in session behind, the same shape a password sign-in does;
 * - a rejected one changes nothing at all, so a stale link cannot sign anybody out;
 * - none of it touches Spaces, notes or history.
 */

const ACCOUNT = { id: 'user-1', email: 'learner@example.com', phone: null, emailVerified: true };

let fetchMock: ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body } as unknown as Response);
}

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

/** A browser that already has a Space and a server configured — i.e. somebody's real install. */
function setup() {
  return fakeChrome({
    settings: { api: { baseUrl: 'https://api.focusspace.test' } },
    modes: [{ id: 'dsa', name: 'DSA' }],
  });
}

describe('redeemHandoff', () => {
  it('turns a code into a stored session', async () => {
    setup();
    const { redeemHandoff } = await import('./auth');
    respond(200, { ok: true, user: ACCOUNT, accessToken: 'access-1', accessTokenExpiresAt: Date.now() + 600_000, refreshToken: 'refresh-1' });

    const result = await redeemHandoff('a-one-time-code');
    expect(result.ok).toBe(true);

    const auth = await getItem('auth');
    expect(auth.user?.email).toBe(ACCOUNT.email);
    expect(auth.accessToken).toBe('access-1');
    expect(auth.refreshToken).toBe('refresh-1');
  });

  it('posts the code to the configured server and nothing else', async () => {
    setup();
    const { redeemHandoff } = await import('./auth');
    respond(200, { ok: true, user: ACCOUNT, accessToken: 'a', accessTokenExpiresAt: Date.now() + 1000, refreshToken: 'r' });

    await redeemHandoff('the-code');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.focusspace.test/v1/auth/handoff/redeem');
    expect(JSON.parse(String(init.body))).toEqual({ code: 'the-code' });
    // No bearer token: the code is the proof, and there is no session yet to authenticate with.
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('leaves the learner signed out — and their data untouched — when the code is rejected', async () => {
    setup();
    const { redeemHandoff } = await import('./auth');
    respond(401, { ok: false, code: 'unauthorized', error: 'That sign-in link has expired. Start again from FocusSpace.' });

    const result = await redeemHandoff('a-stale-code');
    expect(result.ok).toBe(false);

    const [auth, modes] = [await getItem('auth'), await getItem('modes')];
    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
    // The whole point of the release: nothing about signing in may cost somebody their Spaces.
    expect(modes.map((m) => m.id)).toEqual(['dsa']);
  });

  it('refuses without a configured server rather than calling anything', async () => {
    fakeChrome({ settings: { api: { baseUrl: '' } } });
    const { redeemHandoff } = await import('./auth');
    const result = await redeemHandoff('a-code');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the website → extension bridge', () => {
  /** Drives the real `onMessageExternal` handler the manifest's externally_connectable origins reach. */
  async function bridge() {
    setup();
    const { registerExternalMessaging } = await import('./external');
    registerExternalMessaging();
    return (message: unknown) => dispatchExternal<{ ok: boolean; error?: string }>(message);
  }

  it('signs the extension in from a handoff the website sent', async () => {
    const send = await bridge();
    respond(200, { ok: true, user: ACCOUNT, accessToken: 'access-2', accessTokenExpiresAt: Date.now() + 600_000, refreshToken: 'refresh-2' });

    expect(await send({ type: 'auth/handoff', code: 'from-the-website' })).toMatchObject({ ok: true });
    expect((await getItem('auth')).user?.email).toBe(ACCOUNT.email);
  });

  it('rejects a message with no code without calling the server', async () => {
    const send = await bridge();
    expect(await send({ type: 'auth/handoff', code: '' })).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never hands the website a token back', async () => {
    const send = await bridge();
    respond(200, { ok: true, user: ACCOUNT, accessToken: 'secret-access', accessTokenExpiresAt: Date.now() + 600_000, refreshToken: 'secret-refresh' });

    const response = await send({ type: 'auth/handoff', code: 'from-the-website' });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('secret-access');
    expect(serialized).not.toContain('secret-refresh');
  });
});
