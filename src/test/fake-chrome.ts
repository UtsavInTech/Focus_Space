/**
 * An in-memory chrome.storage.local for tests, with change events — the ownership guard reacts to them —
 * plus a runtime.sendMessage that tests can answer and an onMessageExternal a test can dispatch to
 * (the channel the website reaches the extension on).
 */
type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

type ExternalListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void;

/** Delivers a message to whatever `registerExternalMessaging()` registered, and resolves with its reply. */
export function dispatchExternal<T = unknown>(message: unknown): Promise<T> {
  const listeners = (globalThis as unknown as { __fsExternalListeners?: Set<ExternalListener> }).__fsExternalListeners;
  const listener = listeners && [...listeners][0];
  if (!listener) throw new Error('No external listener registered — call registerExternalMessaging() first.');
  return new Promise((resolve) => listener(message, { origin: 'https://focusspace.xyz' }, (response) => resolve(response as T)));
}

export function fakeChrome(initial: Record<string, unknown> = {}, reply: (type: string, payload: unknown) => unknown = () => undefined) {
  const data: Record<string, unknown> = structuredClone(initial);
  const listeners = new Set<Listener>();
  const external = new Set<ExternalListener>();
  (globalThis as unknown as { __fsExternalListeners?: Set<ExternalListener> }).__fsExternalListeners = external;
  const emit = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
    if (Object.keys(changes).length) for (const l of listeners) l(changes, 'local');
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
          return out;
        },
        set: async (values: Record<string, unknown>) => {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const [k, v] of Object.entries(values)) {
            changes[k] = { oldValue: data[k], newValue: v };
            data[k] = structuredClone(v);
          }
          emit(changes);
        },
        remove: async (keys: string | string[]) => {
          const changes: Record<string, { oldValue?: unknown }> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) {
            if (k in data) changes[k] = { oldValue: data[k] };
            delete data[k];
          }
          emit(changes);
        },
      },
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
    runtime: {
      id: 'test-extension',
      sendMessage: async (m: { type: string; payload: unknown }) => reply(m.type, m.payload),
      onMessageExternal: { addListener: (l: ExternalListener) => external.add(l), removeListener: (l: ExternalListener) => external.delete(l) },
    },
  };
  return data;
}
