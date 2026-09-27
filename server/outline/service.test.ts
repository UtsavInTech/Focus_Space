import { describe, expect, it, vi } from 'vitest';
import type { AiPrompt } from '@/learning/ai/actions';
import { ApiError } from '../http';
import { condenseForOutline, condenseTranscript } from '@/learning/outline/outline';
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

  describe('a video longer than three hours', () => {
    // 12 hours, condensed the way the extension uploads it.
    const long = condenseForOutline(Array.from({ length: 12 * 360 }, (_, i) => ({ startSec: i * 10, durSec: 10, text: `marathon line ${i} about graphs` })));
    const longRequest = () => validateOutlineRequest({ videoId: 'abcdefghijk', title: 'DSA Marathon', channel: 'C', durationSec: 12 * 3600, hints: [], segments: long });
    /** Answers each part with three sections inside that part, read from the prompt. */
    const perPart = vi.fn(async (prompt: AiPrompt) => {
      const [, from] = prompt.user.match(/Divide this part, from ([\d:]+)/)!;
      const [h, m] = from.split(':').map(Number);
      const start = h * 3600 + m * 60;
      const t = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:00`;
      return { answer: [`${t(start)} | Part ${h} opening | a`, `${t(start + 1200)} | Part ${h} middle | b`, `${t(start + 2400)} | Part ${h} end | c`].join('\n'), usage: { promptTokens: 20000, completionTokens: 300 } };
    });

    it('is outlined part by part and stored as one outline, which the next viewer gets free', async () => {
      perPart.mockClear();
      const d = { db: new OutlineDb(':memory:'), model: 'gpt-4o-mini', dailyLimit: 500, complete: perPart } as OutlineDeps;
      const first = await outlineFor(longRequest(), d, () => true);
      expect(perPart).toHaveBeenCalledTimes(12);
      expect(first.sections).toHaveLength(36);
      expect(first.sections[0].startSec).toBe(0);
      expect(first.sections[35].endSec).toBe(12 * 3600);
      expect(first.sections.every((s, i, all) => i === 0 || s.startSec === all[i - 1].endSec)).toBe(true);
      expect(d.db.countSince(0)).toBe(1);
      const again = await outlineFor(longRequest(), d, () => false);
      expect(again.cached).toBe(true);
      expect(perPart).toHaveBeenCalledTimes(12);
    });

    it('retries a part once, and stores nothing when a part still fails', async () => {
      let calls = 0;
      const flaky = vi.fn(async (prompt: AiPrompt) => (++calls === 2 ? { answer: 'Sorry.', usage: null } : perPart(prompt)));
      const d = { db: new OutlineDb(':memory:'), model: 'gpt-4o-mini', dailyLimit: 500, complete: flaky } as OutlineDeps;
      expect((await outlineFor(longRequest(), d, () => true)).sections).toHaveLength(36);
      expect(flaky).toHaveBeenCalledTimes(13);

      const broken = { db: new OutlineDb(':memory:'), model: 'gpt-4o-mini', dailyLimit: 500, complete: async (prompt: AiPrompt) => (/part 3 of/.test(prompt.user) ? { answer: 'No.', usage: null } : perPart(prompt)) } as OutlineDeps;
      await expect(outlineFor(longRequest(), broken, () => true)).rejects.toMatchObject({ status: 502 });
      expect(broken.db.countSince(0)).toBe(0);
    });

    it('outlines a skipped stretch again and splices it in', async () => {
      // Every part answers with its first ten minutes only, then one catch-all — the real failure.
      const lazy = vi.fn(async (prompt: AiPrompt) => {
        const [, from, to] = prompt.user.match(/Divide this part, from ([\d:]+) to ([\d:]+)/)!;
        const sec = (t: string) => t.split(':').map(Number).reduce((n, x) => n * 60 + x, 0);
        const t = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        const [a, b] = [sec(from), sec(to)];
        const repair = /one stretch/.test(prompt.user);
        const starts = repair ? [a, a + 600, a + 1200, a + 1800] : [a, a + 120, a + 240, a + 360, a + 480];
        return { answer: starts.filter((s) => s < b).map((s, i) => `${t(s)} | ${repair ? 'Redone' : 'Lazy'} ${a}-${i} | x`).join('\n'), usage: { promptTokens: 1, completionTokens: 1 } };
      });
      const d = { db: new OutlineDb(':memory:'), model: 'gpt-4o-mini', dailyLimit: 500, complete: lazy } as OutlineDeps;
      const { sections } = await outlineFor(longRequest(), d, () => true);
      // 12 parts, each leaving a ~52-minute tail as one section → 12 repairs.
      expect(lazy).toHaveBeenCalledTimes(24);
      expect(sections.some((s) => s.title.startsWith('Redone'))).toBe(true);
      expect(Math.max(...sections.map((s) => s.endSec - s.startSec))).toBeLessThan(30 * 60);
    });

    it('still serves an older extension that uploaded one 90k condensation of the same video', async () => {
      perPart.mockClear();
      const old = condenseTranscript(Array.from({ length: 12 * 360 }, (_, i) => ({ startSec: i * 10, durSec: 10, text: `marathon line ${i} about graphs` })));
      const d = { db: new OutlineDb(':memory:'), model: 'gpt-4o-mini', dailyLimit: 500, complete: perPart } as OutlineDeps;
      const result = await outlineFor(validateOutlineRequest({ videoId: 'abcdefghijk', title: 'DSA Marathon', channel: 'C', durationSec: 12 * 3600, hints: [], segments: old }), d, () => true);
      expect(result.sections.length).toBeGreaterThan(6);
    });
  });

  it('validates what it is sent', () => {
    expect(() => request({ videoId: 'not a video' })).toThrow(ApiError);
    expect(() => request({ segments: [{ startSec: 0, durSec: 1, text: 'x' }] })).toThrow(ApiError);
    expect(() => request({ segments: [...segments.slice(0, 5), { startSec: -1, durSec: 1, text: 'x' }] })).toThrow(ApiError);
    expect(request({ hints: [{ startSec: 60, title: 'Arrays' }, { bad: true }] }).hints).toEqual([{ startSec: 60, title: 'Arrays' }]);
  });
});
