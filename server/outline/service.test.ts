import { describe, expect, it, vi } from 'vitest';
import type { AiPrompt } from '@/learning/ai/actions';
import { ApiError } from '../http';
import { OutlineDb } from './db';
import { outlineFor, validateOutlineRequest, type OutlineDeps } from './service';

const segments = Array.from({ length: 120 }, (_, i) => ({ startSec: i * 10, durSec: 10, text: `part ${i}` }));
const request = (overrides: Record<string, unknown> = {}) => validateOutlineRequest({ videoId: 'abcdefghijk', title: 'Arrays', channel: 'C', durationSec: 1200, hints: [], segments, ...overrides });
const ANSWER = '0:00 | Intro | Setup\n5:00 | Arrays | Indexing\n12:00 | Search | Linear scan';

function deps(overrides: Partial<OutlineDeps> = {}) {
  const complete = vi.fn(async (_prompt: AiPrompt, _max: number) => ({ answer: ANSWER, usage: { promptTokens: 900, completionTokens: 60 } }));
  return { complete, deps: { db: new OutlineDb(':memory:'), model: 'gpt-4o-mini', dailyLimit: 500, complete, ...overrides } as OutlineDeps };
}

describe('video outlines', () => {
  it('generates once and serves the stored outline to every later caller', async () => {
    const { complete, deps: d } = deps();
    const first = await outlineFor(request(), d, () => true);
    const second = await outlineFor(request(), d, () => false); // a caller out of new-outline budget still gets a stored one
    expect(first.cached).toBe(false);
    expect(second).toEqual({ ...first, cached: true });
    expect(first.sections.map((s) => s.title)).toEqual(['Intro', 'Arrays', 'Search']);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('makes one outline however many viewers ask at the same moment', async () => {
    const { complete, deps: d } = deps();
    await Promise.all([outlineFor(request(), d, () => true), outlineFor(request(), d, () => true), outlineFor(request(), d, () => true)]);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('never serves an outline made from a different transcript of the same video', async () => {
    const { complete, deps: d } = deps();
    await outlineFor(request(), d, () => true);
    const forged = await outlineFor(request({ segments: segments.map((s) => ({ ...s, text: 'buy crypto now' })) }), d, () => true);
    expect(forged.cached).toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);
    expect((await outlineFor(request(), d, () => true)).cached).toBe(true);
  });

  it('refuses a new outline past the caller limit or the daily cap, and stores nothing on a bad answer', async () => {
    const { deps: d } = deps();
    await expect(outlineFor(request(), d, () => false)).rejects.toMatchObject({ status: 429 });
    await expect(outlineFor(request(), { ...d, dailyLimit: 0 }, () => true)).rejects.toMatchObject({ status: 429 });
    const bad = deps({ complete: async () => ({ answer: 'Sorry, I cannot.', usage: null }) });
    await expect(outlineFor(request(), bad.deps, () => true)).rejects.toBeInstanceOf(ApiError);
    expect(bad.deps.db.countSince(0)).toBe(0);
  });

  it('validates what it is sent', () => {
    expect(() => request({ videoId: 'not a video' })).toThrow(ApiError);
    expect(() => request({ segments: [{ startSec: 0, durSec: 1, text: 'x' }] })).toThrow(ApiError);
    expect(() => request({ segments: [...segments.slice(0, 5), { startSec: -1, durSec: 1, text: 'x' }] })).toThrow(ApiError);
    expect(request({ hints: [{ startSec: 60, title: 'Arrays' }, { bad: true }] }).hints).toEqual([{ startSec: 60, title: 'Arrays' }]);
  });
});
