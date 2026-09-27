import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildLearningContext } from '@/learning/context/context';
import { chromeProvider, endpointProvider, resolveProviders } from './ai';

/**
 * Locks in the real provider contract investigated for this task:
 *
 * - the exact request/response shape `endpointProvider` sends to a
 *   FocusSpace-compatible server (see docs — no auth header is sent; the
 *   URL itself is the trust boundary, matching "no API keys in the
 *   extension")
 * - that selecting Chrome on-device explicitly never reaches the network,
 *   independent of whatever endpoint URL happens to be configured
 */

/** Minimal chrome.storage.local shim, same shape src/storage/storage.ts calls. */
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

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const ctx = buildLearningContext({ video: { id: 'v1', title: 'Intro', channelTitle: 'x' }, mode: dsa, topicId: null, path: null, map: null, transcript: null, currentTime: 10 });

describe('endpointProvider: the exact wire contract a FocusSpace-compatible server must implement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs { version, action, question, context, prompt } as JSON, with no Authorization header — the URL is the only trust boundary', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'the answer' }) }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');
    const answer = await provider.complete({ system: 'sys', user: 'usr' }, { action: 'explain', context: ctx, question: undefined });
    expect(answer).toBe('the answer');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/v1/moment');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' }); // no auth header of any kind
    const body = JSON.parse(init.body as string) as unknown;
    // `question` is absent, not null: the API accepts a string or nothing, and sending null
    // made every question-less action (notes, mindmap) fail validation with
    // `"question" must be a string`.
    expect(body).toEqual({ version: 1, action: 'explain', context: ctx, prompt: { system: 'sys', user: 'usr' } });
  });

  it('omits "question" entirely for a question-less action, and includes it when there is one', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');

    await provider.complete({ system: 's', user: 'u' }, { action: 'mindmap', context: ctx, question: undefined });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).not.toHaveProperty('question');

    await provider.complete({ system: 's', user: 'u' }, { action: 'chat', context: ctx, question: 'why?' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({ question: 'why?' });
  });

  it('sends action: "notes" | "mindmap" | "chat" the same way — the server does not need to special-case them (the reference server only reads prompt.system/user)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');
    for (const action of ['notes', 'mindmap', 'chat'] as const) {
      await provider.complete({ system: 's', user: 'u' }, { action, context: ctx });
    }
    const actions = fetchMock.mock.calls.map(([, init]) => (JSON.parse(init.body as string) as { action: string }).action);
    expect(actions).toEqual(['notes', 'mindmap', 'chat']);
  });

  it('rejects a non-2xx HTTP response with a clear error, never silently returning empty text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');
    await expect(provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx })).rejects.toThrow(/HTTP 500/);
  });

  it('REGRESSION (UX audit): a raw fetch failure never surfaces the literal "Failed to fetch" browser error — it becomes a friendly, actionable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');
    const err = await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/^Failed to fetch$/);
    expect((err as Error).message).toMatch(/Couldn't reach your AI endpoint/);
    expect((err as Error).message).toMatch(/127\.0\.0\.1:8787/);
    expect((err as Error).message).toMatch(/Settings/);
  });

  it('re-throws an intentional abort as-is, rather than reporting it as an unreachable endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );
    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');
    const err = await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('rejects a response with no string "answer" field — no streaming/SSE body is understood, only { answer: string }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');
    await expect(provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx })).rejects.toThrow(/no answer/);
  });

  it('surfaces the server\'s own error message (e.g. a Layer 2C quota error) instead of a bare status code, when present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ ok: false, code: 'quota_exceeded', error: "You've used all 200 AI actions included this period." }) })));
    const provider = endpointProvider('http://127.0.0.1:8787/v1/moment');
    await expect(provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx })).rejects.toThrow(/used all 200 AI actions/);
  });

  it('Layer 2C: attaches Authorization: Bearer <token> only when an access token is passed in', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = endpointProvider('http://127.0.0.1:8788/v1/ai/complete', 'the-access-token');
    await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer the-access-token' });
  });

  it('signed out, the install id is sent so the free allowance is per install — and never together with a token', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await endpointProvider('http://127.0.0.1:8788/v1/ai/complete', undefined, 'install-1').complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-FocusSpace-Install': 'install-1' });
    await endpointProvider('http://127.0.0.1:8788/v1/ai/complete', 'the-access-token', 'install-1').complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('X-FocusSpace-Install');
  });
});

describe('Chrome on-device stays independent of the endpoint provider', () => {
  beforeEach(() => {
    fakeChromeStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  });

  it('selecting "chrome" explicitly returns only chromeProvider, even with a valid endpoint URL configured — the endpoint is never reached', async () => {
    fakeChromeStorage({ settings: { ai: { provider: 'chrome', endpointUrl: 'http://127.0.0.1:8787/v1/moment', language: 'en' } } });
    const providers = await resolveProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('chrome');
  });

  it('"off" returns no providers at all, regardless of endpoint configuration', async () => {
    fakeChromeStorage({ settings: { ai: { provider: 'off', endpointUrl: 'http://127.0.0.1:8787/v1/moment', language: 'en' } } });
    expect(await resolveProviders()).toEqual([]);
  });

  it('"endpoint" with no (or an invalid) URL configured returns no providers — it never silently falls back to chrome', async () => {
    fakeChromeStorage({ settings: { ai: { provider: 'endpoint', endpointUrl: '', language: 'en' } } });
    expect(await resolveProviders()).toEqual([]);
    fakeChromeStorage({ settings: { ai: { provider: 'endpoint', endpointUrl: 'not a url', language: 'en' } } });
    expect(await resolveProviders()).toEqual([]);
  });

  it('"auto" offers the endpoint first, chrome as fallback, only when a valid endpoint URL is set', async () => {
    fakeChromeStorage({ settings: { ai: { provider: 'auto', endpointUrl: 'http://127.0.0.1:8787/v1/moment', language: 'en' } } });
    const withEndpoint = await resolveProviders();
    expect(withEndpoint.map((p) => p.id)).toEqual(['endpoint', 'chrome']);

    fakeChromeStorage({ settings: { ai: { provider: 'auto', endpointUrl: '', language: 'en' } } });
    const withoutEndpoint = await resolveProviders();
    expect(withoutEndpoint.map((p) => p.id)).toEqual(['chrome']);
  });

  it('chromeProvider never performs a network call — its availability/complete path only touches globalThis.LanguageModel', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await chromeProvider.availability()).toBe('unavailable'); // no LanguageModel in this environment
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveProviders: Layer 2C same-origin FocusSpace token attachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const loggedIn = { user: { id: 'u1', email: 'a@b.com' }, accessToken: 'tok-123', accessTokenExpiresAt: Date.now() + 900_000, refreshToken: 'rt' };

  it('attaches the access token when the configured AI endpoint and the FocusSpace API share an origin', async () => {
    fakeChromeStorage({
      settings: { ai: { provider: 'endpoint', endpointUrl: 'http://127.0.0.1:8788/v1/ai/complete', language: 'en' }, api: { baseUrl: 'http://127.0.0.1:8788' } },
      auth: loggedIn,
    });
    const [provider] = await resolveProviders();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok-123' });
  });

  it('never attaches a token when the endpoint is a different origin — a personal/third-party server must not receive it', async () => {
    fakeChromeStorage({
      settings: { ai: { provider: 'endpoint', endpointUrl: 'http://my-own-server.example/v1/moment', language: 'en' }, api: { baseUrl: 'http://127.0.0.1:8788' } },
      auth: loggedIn,
    });
    const [provider] = await resolveProviders();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('never attaches a token when no FocusSpace api.baseUrl is configured at all', async () => {
    fakeChromeStorage({ settings: { ai: { provider: 'endpoint', endpointUrl: 'http://127.0.0.1:8788/v1/ai/complete', language: 'en' }, api: { baseUrl: '' } }, auth: loggedIn });
    const [provider] = await resolveProviders();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('never attaches a token when the learner is signed out, even if the origins match', async () => {
    fakeChromeStorage({ settings: { ai: { provider: 'endpoint', endpointUrl: 'http://127.0.0.1:8788/v1/ai/complete', language: 'en' }, api: { baseUrl: 'http://127.0.0.1:8788' } } });
    const [provider] = await resolveProviders();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
    // Signed out, FocusSpace's own server gets this install's id instead, for the per-install free allowance.
    expect(headers['X-FocusSpace-Install']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a personal endpoint never receives the install id', async () => {
    fakeChromeStorage({ settings: { ai: { provider: 'endpoint', endpointUrl: 'https://my-relay.example/v1/ai', language: 'en' }, api: { baseUrl: 'http://127.0.0.1:8788' } } });
    const [provider] = await resolveProviders();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ answer: 'ok' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await provider.complete({ system: 's', user: 'u' }, { action: 'explain', context: ctx });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });
});
