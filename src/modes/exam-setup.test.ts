import { afterEach, describe, expect, it } from 'vitest';
import type { LearningMode, Settings } from '@/types/domain';
import { addTemplate, chooseExam } from './service';
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
  it('builds the exam Space and opens it, and never blocks other Spaces', async () => {
    const data = fakeChrome({ modes: [] });
    await chooseExam('upsc');
    expect((data.modes as LearningMode[]).map((m) => m.id)).toEqual(['upsc']);
    expect(data.settings as Settings).toMatchObject({ exam: 'upsc', activeModeId: 'upsc', onboarded: true });
    await expect(addTemplate('dsa')).resolves.toMatchObject({ id: 'dsa' });
    await expect(addTemplate('system-design')).resolves.toBeNull(); // not a template id; created through CreateSpace instead
  });

  it('choosing again reshapes the Space and keeps its creators', async () => {
    const data = fakeChrome({ modes: [] });
    await chooseExam('btech', { branch: ['cse'], year: ['y2'] }, [{ id: 'UC1', title: 'Gate Smashers' }]);
    await chooseExam('btech', { branch: ['cse'], year: ['y3'] });
    const btech = (data.modes as LearningMode[]).find((m) => m.id === 'btech')!;
    expect(btech.allowedChannels.map((c) => c.title)).toEqual(['Gate Smashers']);
    expect(btech.topics.map((t) => t.name)).toContain('Operating System');
  });

  it('understands an exam typed or said to the guide', () => {
    expect(examFromText('I am preparing for UPSC')).toBe('upsc');
    expect(examFromText('ssc cgl')).toBe('ssc');
    expect(examFromText('NEET')).toBe('neet');
    expect(examFromText('DSA and Spanish')).toBeNull();
  });
});
