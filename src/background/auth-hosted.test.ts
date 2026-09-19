import { describe, expect, it, vi } from 'vitest';

// A store build: VITE_API_URL is baked in (see STORE.md). Isolated in its own file because
// the mock applies to the whole module graph, and the other auth tests model a build without it.
vi.mock('@/config', () => ({ API_URL: 'https://api.focusspace.xyz' }));

const { apiBaseUrl } = await import('./auth');

function withSettings(baseUrl: string) {
  const data: Record<string, unknown> = { settings: { ai: { provider: 'auto', endpointUrl: '', language: 'en' }, api: { baseUrl } } };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (obj: Record<string, unknown>) => void Object.assign(data, obj),
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
}

describe('account server in a store build', () => {
  it('signs in against the built-in API when Settings has no server address', async () => {
    // Without this fallback nobody could sign in from a store install, so paid plans never reached the extension.
    withSettings('');
    expect(await apiBaseUrl()).toBe('https://api.focusspace.xyz');
  });

  it('still prefers a server the learner set themselves', async () => {
    withSettings('http://127.0.0.1:8788/');
    expect(await apiBaseUrl()).toBe('http://127.0.0.1:8788');
  });
});
