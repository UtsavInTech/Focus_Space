import {
  buildOutlinePrompt,
  longGaps,
  MAX_LONG_SECTIONS,
  mergeOutlineParts,
  outlineParts,
  outlineSource,
  parseOutline,
  partBudget,
  segmentsInPart,
  spliceGap,
  transcriptKey,
  type OutlineHint,
  type OutlineRequest,
  type OutlineSection,
} from '@/learning/outline/outline';
import type { TranscriptSegment } from '@/learning/knowledge/types';
import type { AiPrompt } from '@/learning/ai/actions';
import { ApiError } from '../http';
import type { OpenAIResult } from '../openai';
import type { OutlineDb } from './db';

/**
 * Video outlines: served from storage when this transcript has been outlined before, generated once
 * otherwise (see src/learning/outline/outline.ts for why they exist).
 *
 * Outlines are not metered against anyone's AI allowance — the learner never asked for one, and the
 * next viewer of the same video gets it for free. What bounds the cost instead:
 *  - a per-caller limit on *new* outlines (index.ts), so one client cannot outline thousands of videos;
 *  - a global daily cap (OUTLINE_DAILY_LIMIT), the hard ceiling on what this can ever spend in a day;
 *  - one generation at a time per (video, transcript), however many viewers ask at once.
 *
 * A video longer than three hours is outlined in ~1-hour parts (learning/outline outlineParts), a few
 * requests at a time, any stretch the model skipped is redone once, and the result is stored as one
 * outline like any other — the parts are never stored apart.
 */

const MAX_SEGMENTS = 20_000;
const MAX_SEGMENT_CHARS = 1_000;
const MAX_TRANSCRIPT_CHARS = 1_000_000;
const MAX_HINTS = 200;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Room for ~40 sections of title + one sentence. */
export const OUTLINE_MAX_TOKENS = 2_500;
const DAY_MS = 24 * 60 * 60_000;

export const outlineDailyLimit = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.OUTLINE_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? n : 500;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validateVideoId(v: unknown): string {
  if (typeof v !== 'string' || !VIDEO_ID.test(v)) throw new ApiError(400, 'invalid_request', '"videoId" must be a YouTube video id.');
  return v;
}

export function validateTranscriptKey(v: unknown): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new ApiError(400, 'invalid_request', '"key" must be a transcript hash.');
  return v;
}

export function validateOutlineRequest(raw: unknown): OutlineRequest {
  if (!isObject(raw)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object body.');
  const videoId = validateVideoId(raw.videoId);
  const title = typeof raw.title === 'string' ? raw.title.slice(0, 300) : '';
  const channel = typeof raw.channel === 'string' ? raw.channel.slice(0, 200) : '';
  const durationSec = finite(raw.durationSec) ? raw.durationSec : null;

  if (!Array.isArray(raw.segments) || raw.segments.length < 3 || raw.segments.length > MAX_SEGMENTS) {
    throw new ApiError(400, 'invalid_request', `"segments" must be an array of 3–${MAX_SEGMENTS} transcript segments.`);
  }
  let chars = 0;
  const segments: TranscriptSegment[] = raw.segments.map((s) => {
    if (!isObject(s) || !finite(s.startSec) || !finite(s.durSec) || typeof s.text !== 'string' || s.text.length > MAX_SEGMENT_CHARS) {
      throw new ApiError(400, 'invalid_request', 'Each segment must be { startSec, durSec, text }.');
    }
    chars += s.text.length;
    return { startSec: s.startSec, durSec: s.durSec, text: s.text };
  });
  if (chars > MAX_TRANSCRIPT_CHARS) throw new ApiError(400, 'invalid_request', 'The transcript is too long.');

  const hints: OutlineHint[] = Array.isArray(raw.hints)
    ? raw.hints
        .slice(0, MAX_HINTS)
        .filter((h): h is { startSec: number; title: string } => isObject(h) && finite(h.startSec) && typeof h.title === 'string')
        .map((h) => ({ startSec: h.startSec, title: h.title.slice(0, 200) }))
    : [];
  return { videoId, title, channel, durationSec, hints, segments };
}

export interface OutlineDeps {
  db: OutlineDb;
  complete: (prompt: AiPrompt, maxTokens: number) => Promise<OpenAIResult>;
  model: string;
  dailyLimit: number;
  now?: () => number;
}

const inflight = new Map<string, Promise<OutlineSection[]>>();

/** Parts of a long video outlined at once — enough to finish inside the extension's wait, few enough to be polite upstream. */
const PART_CONCURRENCY = 3;

type Usage = { promptTokens: number | null; completionTokens: number | null };

/** Sections for a video up to three hours: one request, exactly as before. */
async function outlineWhole(request: OutlineRequest, deps: OutlineDeps): Promise<{ sections: OutlineSection[] | null; usage: Usage }> {
  const { answer, usage } = await deps.complete(buildOutlinePrompt(request, outlineSource(request.segments)), OUTLINE_MAX_TOKENS);
  return { sections: parseOutline(answer, request.durationSec), usage: { promptTokens: usage?.promptTokens ?? null, completionTokens: usage?.completionTokens ?? null } };
}

/**
 * Sections for a long video: each part outlined on its own (one retry each), then merged. A part that
 * still fails fails the whole — nothing half-made is stored. Then any stretch the model skipped
 * (longGaps) is outlined once more on its own; a repair that fails leaves the section as it was.
 */
async function outlineInParts(request: OutlineRequest, deps: OutlineDeps, parts: NonNullable<ReturnType<typeof outlineParts>>): Promise<{ sections: OutlineSection[] | null; usage: Usage }> {
  const budget = partBudget(parts.length);
  const maxSections = Math.max(3, Math.floor(MAX_LONG_SECTIONS / parts.length));
  const results: { part: (typeof parts)[number]; sections: OutlineSection[] }[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  const one = async (index: number) => {
    const part = parts[index];
    const source = outlineSource(segmentsInPart(request.segments, part, index === parts.length - 1), budget);
    const prompt = buildOutlinePrompt(request, source, { ...part, index, count: parts.length, maxSections });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { answer, usage: u } = await deps.complete(prompt, OUTLINE_MAX_TOKENS);
      usage.promptTokens += u?.promptTokens ?? 0;
      usage.completionTokens += u?.completionTokens ?? 0;
      const sections = parseOutline(answer, part.endSec, part);
      if (sections) return results.push({ part, sections });
    }
    throw new ApiError(502, 'upstream_error', 'The AI did not return a usable outline.');
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, async () => {
    while (next < parts.length) await one(next++);
  }));
  let sections = mergeOutlineParts(results, request.durationSec);
  if (!sections) return { sections, usage };

  const gaps = longGaps(sections);
  const redone = await Promise.all(
    gaps.map(async (gap) => {
      const source = outlineSource(segmentsInPart(request.segments, gap, false), budget);
      const prompt = buildOutlinePrompt(request, source, { ...gap, maxSections });
      try {
        const { answer, usage: u } = await deps.complete(prompt, OUTLINE_MAX_TOKENS);
        usage.promptTokens += u?.promptTokens ?? 0;
        usage.completionTokens += u?.completionTokens ?? 0;
        return parseOutline(answer, gap.endSec, gap);
      } catch {
        return null;
      }
    }),
  );
  gaps.forEach((gap, i) => (sections = spliceGap(sections!, gap, redone[i])));
  // Repairs can push past the cap; thin evenly again, over the outline's own span.
  const whole = { startSec: 0, endSec: sections[sections.length - 1].endSec };
  return { sections: sections.length > MAX_LONG_SECTIONS ? mergeOutlineParts([{ part: whole, sections }], whole.endSec) : sections, usage };
}

/** The stored outline for this transcript, or a freshly generated (and stored) one. */
export async function outlineFor(request: OutlineRequest, deps: OutlineDeps, allowNew: () => boolean): Promise<{ key: string; sections: OutlineSection[]; cached: boolean }> {
  const key = await transcriptKey(request.segments);
  const stored = deps.db.get(request.videoId, key);
  if (stored) return { key, sections: stored.sections, cached: true };

  const id = `${request.videoId}:${key}`;
  const running = inflight.get(id);
  if (running) return { key, sections: await running, cached: false };

  if (!allowNew()) throw new ApiError(429, 'rate_limited', 'Too many new video outlines from this device. Try again later.');
  const now = deps.now?.() ?? Date.now();
  if (deps.db.countSince(now - DAY_MS) >= deps.dailyLimit) throw new ApiError(429, 'rate_limited', 'Video outlines are paused for today.');

  const task = (async () => {
    const parts = outlineParts(request.segments);
    const { sections, usage } = parts ? await outlineInParts(request, deps, parts) : await outlineWhole(request, deps);
    if (!sections) throw new ApiError(502, 'upstream_error', 'The AI did not return a usable outline.');
    deps.db.put(request.videoId, key, { sections, model: deps.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }, now);
    return sections;
  })().finally(() => inflight.delete(id));
  inflight.set(id, task);
  return { key, sections: await task, cached: false };
}
