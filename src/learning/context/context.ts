import type { LearningMode } from '@/types/domain';
import type { NoteLanguage, NoteRange } from '@/types/notes';
import { conceptStops, locateConcept, type ConceptStop } from '../knowledge/locate';
import { formatTimestamp } from '../knowledge/timestamps';
import type { KnowledgeMap, KnowledgeSource, TranscriptSegment } from '../knowledge/types';
import type { LearningPath, PathSource } from '../path/path';
import type { OutlineSection } from '../outline/outline';

/**
 * The learning context of one moment: which space, which course and lecture,
 * which concept at which second, what came before and what's next, and the
 * few sentences the instructor just said. Built locally, on demand; it is
 * exactly what an AI companion receives — never the whole transcript.
 *
 * V5: a context can also describe a *span* rather than an instant (`range`)
 * — used for notes over a section, a selection or the whole video. When
 * `range` is set, `transcriptWindow` covers that span instead of the
 * point-in-time window (see `transcriptWindow` below and
 * docs/V5_CONTRACT.md §C). The point-only shape (`range: null`) is what every
 * existing AI action still gets, unchanged.
 */

/** Bumped when the shape reaching the model changes, so cached answers built from the old one are dropped. */
export const CONTEXT_VERSION = 3;

export interface LearningContext {
  version: number;
  videoId: string;
  videoTitle: string;
  channel: string;
  mode: { id: string; name: string; kind: LearningMode['kind'] };
  /** The space's topic order ("Arrays → Strings → Linked Lists …") and where this video fits. */
  learningPath: { topics: string[]; currentTopic: string | null };
  playlist: {
    id: string | null;
    title: string;
    source: PathSource;
    position: number | null;
    total: number;
    next: string | null;
    nextLabel: string;
  } | null;
  currentTime: number;
  timestamp: string;
  currentConcept: string | null;
  /** Outer concepts first, e.g. ["Linked Lists", "Insertion"]. */
  conceptPath: string[];
  conceptId: string | null;
  conceptSource: KnowledgeSource | null;
  previousConcepts: string[];
  upcomingConcepts: string[];
  transcriptWindow: TranscriptWindow | null;
  /** Null when there is no transcript window at all. See TranscriptSource. */
  transcriptSource: TranscriptSource | null;
  /** 'en' unless the learner asked for Hindi/Hinglish output (notes only — every existing action stays English-prompted). */
  language: NoteLanguage;
  /** Set for a span-based context (notes); null for the point-in-time context every existing AI action uses. */
  range: NoteRange | null;
  /** Every topic in the video and when it is taught (learning/outline). Absent or null when there is none yet. */
  videoOutline?: OutlineSection[] | null;
}

export interface TranscriptWindow {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Where the words came from. 'manual' is captions a human uploaded; 'asr' is YouTube's speech
 * recognition, which is often the only thing a lecture has and which reliably mangles the technical
 * terms the lecture is about. The model is told which it is reading so it can treat an odd-looking term
 * as a mishearing rather than as something the instructor said.
 */
export type TranscriptSource = 'manual' | 'asr';

export interface ContextInputs {
  video: { id: string; title: string; channelTitle: string };
  mode: LearningMode;
  topicId: string | null;
  path: LearningPath | null;
  map: KnowledgeMap | null;
  /** Precomputed from the map (reuse across ticks). */
  stops?: ConceptStop[];
  transcript: TranscriptSegment[] | null;
  /** Defaults to 'manual' when a transcript is present and the caller does not say — the safer assumption. */
  transcriptSource?: TranscriptSource | null;
  currentTime: number;
  /** Transcript window size for the action (see WINDOW_FOR). Ignored when `range` is set. */
  window?: { beforeSec?: number; afterSec?: number; maxChars?: number; minLeadSec?: number };
  /** Span the context should describe instead of the instant at `currentTime` (notes only). */
  range?: NoteRange | null;
  language?: NoteLanguage;
  /** The whole-video outline (learning/outline), when the API has one for this transcript. */
  outline?: OutlineSection[] | null;
}

/**
 * Transcript budget for a range-based window (notes, mind maps). It grows with the span — a fixed 6,000
 * characters was the whole budget for a two-minute section and for a three-hour lecture alike, so a long
 * lecture was grounded in a sliver of it — up to a ceiling that keeps the prompt inside the API's limit
 * (server/validate.ts, 24,000 characters for the whole user message).
 */
const RANGE_MIN_CHARS = 6000;
const RANGE_CHARS_PER_MINUTE = 260;
const RANGE_MAX_CHARS = 16_000;
export const rangeBudget = (range: NoteRange): number =>
  Math.round(Math.min(RANGE_MAX_CHARS, Math.max(RANGE_MIN_CHARS, ((range.endSec - range.startSec) / 60) * RANGE_CHARS_PER_MINUTE)));

/**
 * Notes over a range cover the whole span rather than favouring recency. A
 * range that fits the budget verbatim is kept verbatim; a longer one (a full
 * lecture, a whole course) is sampled across evenly-spaced buckets spanning
 * start to end, each capped, joined with a "[…]" marker — so grounding still
 * comes from across the whole range instead of just its first minutes.
 */
function sampleAcrossRange(segments: TranscriptSegment[], maxChars: number): string {
  // More, smaller buckets for a longer range, so every part of the lecture is heard — not twelve snapshots of a three-hour video.
  const bucketCount = Math.min(segments.length, Math.max(12, Math.min(40, Math.round(maxChars / 400))));
  const bucketSize = Math.ceil(segments.length / bucketCount);
  const perBucket = Math.floor(maxChars / bucketCount);
  const parts: string[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucket = segments.slice(i * bucketSize, (i + 1) * bucketSize);
    if (!bucket.length) continue;
    const text = bucket.map((s) => s.text).join(' ');
    parts.push(text.length > perBucket ? text.slice(0, perBucket) : text);
  }
  return parts.join(' […] ');
}

function transcriptForRange(segments: TranscriptSegment[], range: NoteRange, maxChars: number): TranscriptWindow | null {
  const picked = segments.filter((s) => s.startSec + s.durSec > range.startSec && s.startSec < range.endSec);
  if (!picked.length) return null;
  const full = picked.map((s) => s.text).join(' ');
  const text = full.length <= maxChars ? full : sampleAcrossRange(picked, maxChars);
  return { startSec: Math.round(picked[0].startSec), endSec: Math.round(picked[picked.length - 1].startSec + picked[picked.length - 1].durSec), text };
}

/**
 * What the instructor said around `timeSec`: mostly the lead-up (what was just
 * explained), a little of what follows, capped in size. Never starts much
 * before the current concept, so it stays on topic.
 *
 * When `options.range` is set, this describes that span instead — see
 * `transcriptForRange` above. Every existing call site (the five point
 * actions) never sets `range`, so their behaviour is unchanged.
 */
export function transcriptWindow(
  segments: TranscriptSegment[] | null,
  timeSec: number,
  options: { beforeSec?: number; afterSec?: number; maxChars?: number; conceptStartSec?: number | null; minLeadSec?: number; range?: NoteRange | null } = {},
): TranscriptWindow | null {
  if (!segments?.length) return null;
  if (options.range) return transcriptForRange(segments, options.range, options.maxChars ?? rangeBudget(options.range));
  const beforeSec = options.beforeSec ?? 90;
  const afterSec = options.afterSec ?? 20;
  const maxChars = options.maxChars ?? 2400;
  // At least `minLeadSec` of lead-up even when the concept only just started.
  const floor = Math.max(timeSec - beforeSec, options.conceptStartSec != null ? Math.min(options.conceptStartSec, timeSec - (options.minLeadSec ?? 30)) : -Infinity);
  const picked = segments.filter((s) => s.startSec + s.durSec >= floor && s.startSec <= timeSec + afterSec);
  if (!picked.length) return null;

  // Over budget: keep what's closest to the moment, favouring what was just said.
  let chars = picked.reduce((n, s) => n + s.text.length + 1, 0);
  while (chars > maxChars && picked.length > 1) {
    const first = picked[0];
    const last = picked[picked.length - 1];
    const dropLast = last.startSec - timeSec > (timeSec - first.startSec) / 3;
    const removed = dropLast ? picked.pop()! : picked.shift()!;
    chars -= removed.text.length + 1;
  }
  const text = picked.map((s) => s.text).join(' ');
  return { startSec: Math.round(picked[0].startSec), endSec: Math.round(picked[picked.length - 1].startSec + picked[picked.length - 1].durSec), text: text.length > maxChars ? text.slice(text.length - maxChars) : text };
}

export function buildLearningContext(inputs: ContextInputs): LearningContext {
  const { video, mode, map, path, currentTime } = inputs;
  const stops = inputs.stops ?? (map ? conceptStops(map) : []);
  const position = stops.length ? locateConcept(stops, currentTime) : null;
  const current = position?.current ?? null;
  const window = transcriptWindow(inputs.transcript, currentTime, { ...inputs.window, conceptStartSec: current?.startSec ?? null, range: inputs.range ?? null });

  return {
    version: CONTEXT_VERSION,
    videoId: video.id,
    videoTitle: video.title,
    channel: video.channelTitle,
    mode: { id: mode.id, name: mode.name, kind: mode.kind },
    // A space's topic path only helps when this video belongs to one of its topics (a biology video in a DSA space shouldn't get "Arrays → Strings → …").
    learningPath: inputs.topicId ? { topics: mode.topics.map((t) => t.name), currentTopic: mode.topics.find((t) => t.id === inputs.topicId)?.name ?? null } : { topics: [], currentTopic: null },
    playlist: path
      ? {
          id: path.playlistId,
          title: path.title,
          source: path.source,
          position: path.current?.index ?? null,
          total: path.total,
          next: path.next?.title ?? null,
          nextLabel: path.nextLabel,
        }
      : null,
    currentTime: Math.round(currentTime),
    timestamp: formatTimestamp(currentTime),
    currentConcept: current?.title ?? null,
    conceptPath: current ? [...(position?.ancestors ?? []).map((a) => a.title), current.title] : [],
    conceptId: current?.id ?? null,
    conceptSource: current?.source ?? null,
    previousConcepts: (position?.previous ?? []).map((n) => n.title),
    upcomingConcepts: (position?.upcoming ?? []).map((n) => n.title),
    transcriptWindow: window,
    transcriptSource: window ? inputs.transcriptSource ?? 'manual' : null,
    language: inputs.language ?? 'en',
    range: inputs.range ?? null,
    videoOutline: inputs.outline?.length ? inputs.outline : null,
  };
}

/** "What am I learning?" answered locally, from the map and the path alone. */
export function describeMoment(ctx: LearningContext): { headline: string; lines: string[] } {
  const lines: string[] = [];
  if (ctx.conceptPath.length > 1) lines.push(`Part of ${ctx.conceptPath.slice(0, -1).join(' › ')}.`);
  if (ctx.playlist?.position) lines.push(`${ctx.videoTitle} — #${ctx.playlist.position} of ${ctx.playlist.total} in ${ctx.playlist.title}.`);
  if (ctx.previousConcepts.length) lines.push(`Before this: ${ctx.previousConcepts.slice(-2).join(', ')}.`);
  if (ctx.upcomingConcepts.length) lines.push(`Coming up: ${ctx.upcomingConcepts.slice(0, 2).join(', ')}.`);
  if (ctx.playlist?.next) lines.push(`${ctx.playlist.nextLabel}: ${ctx.playlist.next}.`);
  return { headline: ctx.currentConcept ?? ctx.videoTitle, lines };
}
