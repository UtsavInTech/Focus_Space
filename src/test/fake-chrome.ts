/**
 * An in-memory chrome.storage.local for tests, with change events — the ownership guard reacts to them —
 * plus a runtime.sendMessage that tests can answer.
 */
type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

export function fakeChrome(initial: Record<string, unknown> = {}, reply: (type: string, payload: unknown) => unknown = () => undefined) {
  const data: Record<string, unknown> = structuredClone(initial);
  const listeners = new Set<Listener>();
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
    runtime: { id: 'test-extension', sendMessage: async (m: { type: string; payload: unknown }) => reply(m.type, m.payload) },
  };
  return data;
}
