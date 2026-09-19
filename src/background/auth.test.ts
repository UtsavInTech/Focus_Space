import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { login, logout, status } from './auth';

/** Minimal chrome.storage.local shim, same shape src/storage/storage.ts calls (mirrors background/ai.test.ts). */
function fakeChromeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in data) out[k] = data[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          Object.assign(data, obj);
        },
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
  return data;
}

const BASE_URL = 'http://127.0.0.1:8788';
const settingsWithBaseUrl = (baseUrl: string) => ({ ai: { provider: 'auto', endpointUrl: '', language: 'en' }, api: { baseUrl } });

const jsonResponse = (status: number, body: unknown) => ({ status, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login', () => {
  it('no FocusSpace server configured -> a clear local error, no network call', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl('') });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await login('a@b.com', 'password one');
    expect(result).toEqual({ ok: false, error: expect.stringContaining('No FocusSpace server') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success persists the returned session locally', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL) });
    const success = { ok: true, user: { id: 'u1', email: 'a@b.com', createdAt: 1 }, accessToken: 'at1', accessTokenExpiresAt: Date.now() + 900_000, refreshToken: 'rt1' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe(`${BASE_URL}/v1/auth/login`);
        return jsonResponse(200, success);
      }),
    );

    const result = await login('a@b.com', 'password one');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.user).toEqual({ id: 'u1', email: 'a@b.com', phone: null, emailVerified: false });

    const restored = await status();
    expect(restored.user).toEqual({ id: 'u1', email: 'a@b.com', phone: null, emailVerified: false });
    expect(restored.accessToken).toBe('at1');
  });

  it('login: server rejection (wrong password) is surfaced as-is, local state stays anonymous', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL) });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { ok: false, code: 'unauthorized', error: 'Invalid email or password.' })));

    const result = await login('a@b.com', 'wrong');
    expect(result).toEqual({ ok: false, error: 'Invalid email or password.', code: 'unauthorized' });

    expect((await status()).user).toBeNull();
  });
});

describe('logout', () => {
  it('clears local state even if the server call fails (network down)', async () => {
    const data = fakeChromeStorage({
      settings: settingsWithBaseUrl(BASE_URL),
      auth: { user: { id: 'u1', email: 'a@b.com' }, accessToken: 'at1', accessTokenExpiresAt: Date.now() + 900_000, refreshToken: 'rt1' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await logout();
    expect(result).toEqual({ ok: true });
    expect(data.auth).toEqual({ user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null });
  });
});

describe('status: silent refresh near expiry', () => {
  const loggedIn = (expiresInMs: number) => ({
    user: { id: 'u1', email: 'a@b.com', phone: null, emailVerified: false },
    accessToken: 'stale-access',
    accessTokenExpiresAt: Date.now() + expiresInMs,
    refreshToken: 'rt1',
  });

  it('returns cached state unchanged, with no network call, when the access token is not near expiry', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: loggedIn(10 * 60_000) });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await status();
    expect(result.accessToken).toBe('stale-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rotates the token when near expiry and the server confirms the refresh', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: loggedIn(30_000) });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true, accessToken: 'fresh-access', accessTokenExpiresAt: Date.now() + 900_000, refreshToken: 'rt2' })));

    const result = await status();
    expect(result.accessToken).toBe('fresh-access');
    expect(result.refreshToken).toBe('rt2');
  });

  it('REGRESSION: a network failure during silent refresh must NOT sign the learner out — local state is left untouched', async () => {
    const originalAuth = loggedIn(30_000);
    const data = fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: originalAuth });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const result = await status();
    expect(result.user).toEqual({ id: 'u1', email: 'a@b.com', phone: null, emailVerified: false }); // still logged in, not cleared
    expect(result.accessToken).toBe('stale-access'); // unchanged — no server confirmation either way
    expect(data.auth).toEqual(originalAuth); // storage untouched, not overwritten with anonymous
  });

  it('REGRESSION: a non-conclusive server error (e.g. rate limited, or a benign concurrent-refresh conflict) must NOT sign the learner out', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: loggedIn(30_000) });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, { ok: false, code: 'conflict', error: 'This refresh token was already used a moment ago. Retry shortly.' })));

    const result = await status();
    expect(result.user).toEqual({ id: 'u1', email: 'a@b.com', phone: null, emailVerified: false });
    expect(result.accessToken).toBe('stale-access');
  });

  it('a server-confirmed "unauthorized" (session genuinely dead) DOES sign the learner out locally', async () => {
    const data = fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: loggedIn(30_000) });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { ok: false, code: 'unauthorized', error: 'Session is no longer valid.' })));

    const result = await status();
    expect(result.user).toBeNull();
    expect(data.auth).toEqual({ user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null });
  });
});

describe('anonymous', () => {
  beforeEach(() => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL) });
  });

  it('status() makes no network call at all when there is no local user', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await status();
    expect(result.user).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
