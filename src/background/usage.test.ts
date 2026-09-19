import { afterEach, describe, expect, it, vi } from 'vitest';
import { status } from './usage';

/** Minimal chrome.storage.local shim, same shape src/storage/storage.ts calls (mirrors background/ai.test.ts / auth.test.ts). */
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
const loggedIn = { user: { id: 'u1', email: 'a@b.com' }, accessToken: 'tok-123', accessTokenExpiresAt: Date.now() + 900_000, refreshToken: 'rt' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usage status (Layer 2C)', () => {
  it('returns null with no network call when signed out', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL) });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await status()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null with no network call when no FocusSpace server is configured', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(''), auth: loggedIn });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await status()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the plan/usage view for a signed-in account', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: loggedIn });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/v1/me/usage`);
        expect(init.headers).toEqual({ Authorization: 'Bearer tok-123' });
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: 'free', period: '2025-06', used: 12, limit: 200 }) };
      }),
    );
    expect(await status()).toEqual({ plan: 'free', period: '2025-06', used: 12, limit: 200 });
  });

  it('keeps an unlimited plan (null limit) instead of discarding it as malformed', async () => {
    // Infinity reaches the wire as null. Dropping it hid the plan from every Unlimited and Max subscriber.
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: loggedIn });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, plan: 'unlimited', period: '2026-09', used: 40, limit: null }) })));
    expect(await status()).toEqual({ plan: 'unlimited', period: '2026-09', used: 40, limit: null });
  });

  it('fails silently to null on a non-2xx response, a network error, or a malformed body', async () => {
    fakeChromeStorage({ settings: settingsWithBaseUrl(BASE_URL), auth: loggedIn });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'nope' }) })));
    expect(await status()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await status()).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
    expect(await status()).toBeNull();
  });
});
