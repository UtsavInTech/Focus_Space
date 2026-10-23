import { afterEach, describe, expect, it } from 'vitest';
import type { LearningMode, Settings } from '@/types/domain';
import { blankMode } from './templates';
import { addTemplate, chooseExam, SpaceLimitError, SpaceLockedError } from './service';
import { examFromText } from './exam-intent';

/** The same chrome shim as spaces-limit.test.ts: storage plus a server that allows every Space. */
function fakeChrome(storage: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...storage };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) if (k in data) out[k] = data[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          Object.assign(data, obj);
        },
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
    runtime: { id: 'test-extension', sendMessage: async () => ({ ok: true, allowance: null }) },
  };
  return data;
}

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('choosing an exam', () => {
  it('builds the exam Space, opens it, and locks other new Spaces for a new learner', async () => {
    const data = fakeChrome({ modes: [] });
    await chooseExam('upsc');
    const settings = data.settings as Settings;
    expect((data.modes as LearningMode[]).map((m) => m.id)).toEqual(['upsc']);
    expect(settings).toMatchObject({ exam: 'upsc', activeModeId: 'upsc', onboarded: true, spacesUnlocked: false });

    const err = await addTemplate('dsa').catch((e) => e);
    expect(err).toBeInstanceOf(SpaceLockedError);
    expect(err).toBeInstanceOf(SpaceLimitError); // every surface that explains a full allowance explains this too
    expect((err as Error).message).toMatch(/UPSC/);
  });

  it('never locks a learner who already had Spaces', async () => {
    const data = fakeChrome({ modes: [{ ...blankMode('dsa', 1), name: 'DSA' }] });
    await chooseExam('ssc');
    expect((data.settings as Settings).spacesUnlocked).toBe(true);
    await expect(addTemplate('web-dev')).resolves.toMatchObject({ id: 'web-dev' });
  });

  it('understands an exam typed or said to the guide', () => {
    expect(examFromText('I am preparing for UPSC')).toBe('upsc');
    expect(examFromText('ssc cgl')).toBe('ssc');
    expect(examFromText('NEET')).toBe('neet');
    expect(examFromText('DSA and Spanish')).toBeNull();
  });
});
