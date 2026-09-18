import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningMode } from '@/types/domain';
import { blankMode } from './templates';
import { addMode, addTemplate, deleteMode, SpaceLimitError } from './service';
import { authorize, release } from '@/background/spaces';

/**
 * The Space allowance as the extension experiences it: the server decides, the
 * client asks first so the learner gets a product explanation rather than a
 * failure, and no creation path can skip the check.
 */

const messages: { type: string; payload: unknown }[] = [];
let reply: (type: string, payload: unknown) => unknown;

/** Same chrome shim the other background tests use, plus runtime.sendMessage. */
function fakeChrome(storage: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...storage };
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
    runtime: {
      id: 'test-extension',
      sendMessage: async (message: { type: string; payload: unknown }) => {
        messages.push(message);
        return reply(message.type, message.payload);
      },
    },
  };
  return data;
}

const mode = (id: string, name = id): LearningMode => ({ ...blankMode(id, Date.now()), id, name });

beforeEach(() => {
  messages.length = 0;
  reply = () => ({ ok: true, allowance: null });
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe('creating a Space asks the server first', () => {
  it('stores the Space when the server allows it', async () => {
    const data = fakeChrome({ modes: [] });
    await addMode(mode('dsa', 'DSA'));
    expect(messages).toEqual([{ type: 'spaces/authorize', payload: { spaceId: 'dsa', name: 'DSA' } }]);
    expect((data.modes as LearningMode[]).map((m) => m.id)).toEqual(['dsa']);
  });

  it('refuses with the server’s explanation, and stores nothing', async () => {
    const data = fakeChrome({ modes: [mode('a'), mode('b'), mode('c'), mode('d')] });
    reply = () => ({ ok: false, code: 'space_limit', error: 'Your plan includes 4 spaces.', allowance: { plan: 'free', used: 4, limit: 4 } });

    await expect(addMode(mode('e'))).rejects.toBeInstanceOf(SpaceLimitError);
    await expect(addMode(mode('e'))).rejects.toThrow('Your plan includes 4 spaces.');
    expect((data.modes as LearningMode[])).toHaveLength(4);
  });

  it('applies to restoring a built-in space too — no creation path skips the check', async () => {
    fakeChrome({ modes: [] });
    reply = () => ({ ok: false, code: 'space_limit', error: 'Limit reached.', allowance: null });
    await expect(addTemplate('dsa')).rejects.toBeInstanceOf(SpaceLimitError);
    expect(messages.map((m) => m.type)).toEqual(['spaces/authorize']);
  });

  it('editing an existing Space is not a new Space', async () => {
    fakeChrome({ modes: [mode('dsa', 'DSA')] });
    await addMode({ ...mode('dsa', 'DSA renamed') });
    expect(messages).toHaveLength(0);
  });

  it('never blocks creation when the check itself fails (offline, no server)', async () => {
    const data = fakeChrome({ modes: [] });
    reply = () => {
      throw new Error('network down');
    };
    await addMode(mode('dsa'));
    expect((data.modes as LearningMode[]).map((m) => m.id)).toEqual(['dsa']);
  });

  it('deleting a Space frees its slot', async () => {
    fakeChrome({ modes: [mode('a'), mode('b')], settings: { defaultModeId: 'a', activeModeId: 'a' }, session: null });
    await deleteMode('b');
    expect(messages.some((m) => m.type === 'spaces/release' && (m.payload as { spaceId: string }).spaceId === 'b')).toBe(true);
  });
});

describe('the allowance belongs to an account, not to the browser', () => {
  const settings = { api: { baseUrl: '' }, ai: { provider: 'auto', endpointUrl: '', language: 'en' } };

  it('never blocks creation while signed out — existing spaces keep working', async () => {
    // A default install already has more built-in spaces than the free plan's limit; enforcing that
    // limit against the local list would break the product for everyone who never signs in.
    fakeChrome({ settings, modes: Array.from({ length: 7 }, (_, i) => mode(`m${i}`)) });
    expect(await authorize('new-space', 'New space')).toEqual({ ok: true, allowance: null });
  });

  it('releasing without an account is a no-op that still succeeds', async () => {
    fakeChrome({ settings });
    await expect(release('anything')).resolves.toEqual({ ok: true });
  });

  it('a refusal from the server is what stops creation, in product language', async () => {
    fakeChrome({ modes: [] });
    reply = () => ({ ok: false, code: 'space_limit', error: 'Your plan includes 4 spaces on your account.', allowance: { plan: 'free', used: 4, limit: 4 } });
    await expect(addMode(mode('fifth'))).rejects.toThrow(/plan includes 4 spaces/i);
    await expect(addMode(mode('fifth'))).rejects.not.toThrow(/error|failed|http/i);
  });
});
