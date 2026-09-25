import type { AiPrompt } from '../ai/actions';
import { formatTimestamp } from '../knowledge/timestamps';
import type { TranscriptSegment } from '../knowledge/types';

/**
 * A whole-video outline: which topic is taught from when to when, with one line on each.
 *
 * Chat only ever sees ~90 seconds of transcript around the playhead, so "where do they cover X?" or
 * "summarise this lecture" had nothing to answer from. The outline is made once per video from the
 * full transcript and stored by the FocusSpace API (server/outline), so every later viewer of the same
 * video gets it without another AI call — the cost is paid once per video, not once per learner.
 *
 * Shared by the extension and the server: the prompt, the parser and the cache key must agree exactly.
 */

export interface OutlineSection {
  startSec: number;
  /** Exclusive: the next section's start, or the video's end. */
  endSec: number;
  title: string;
  /** One sentence on what this section teaches; may be empty. */
  summary: string;
}

export interface VideoOutline {
  videoId: string;
  sections: OutlineSection[];
}

/** A timed heading the video already has (chapters, description timestamps) — a hint, never copied blindly. */
export interface OutlineHint {
  startSec: number;
  title: string;
}

export interface OutlineRequest {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number | null;
  hints: OutlineHint[];
  segments: TranscriptSegment[];
}

/** ~30k tokens of English, a few cents' worth of gpt-4o-mini once per video; longer lectures are sampled evenly. */
export const OUTLINE_SOURCE_MAX_CHARS = 90_000;
/** A section per 1–2 minutes of a short video is noise; per 20 minutes of a long one is useless. */
export const MAX_SECTIONS = 40;
const MIN_SECTIONS = 2;
/** How much of the outline goes into one chat prompt (server/validate.ts caps the whole prompt at 24,000). */
const BLOCK_MAX_CHARS = 4500;

/**
 * The transcript as the outline sees it: one segment per ~30 seconds, trimmed evenly — and, if even that
 * is too long, thinned to evenly spaced segments — to fit the budget, so a lecture is covered start to
 * end, never just its first hours.
 *
 * This is also what the extension *sends*: a 30-hour lecture's captions are ~1.6 million characters,
 * far past what one request should carry, while this is at most OUTLINE_SOURCE_MAX_CHARS. It is
 * deterministic — the same captions always condense to the same segments — so every viewer of a video
 * sends identical data and hits the same stored outline. Condensing condensed segments changes nothing.
 */
export function condenseTranscript(segments: TranscriptSegment[], maxChars = OUTLINE_SOURCE_MAX_CHARS): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  for (const s of segments) {
    const cur = merged[merged.length - 1];
    if (cur && s.startSec - cur.startSec < 30) {
      cur.text = `${cur.text} ${s.text}`;
      cur.durSec = Math.max(cur.durSec, s.startSec + s.durSec - cur.startSec);
    } else merged.push({ startSec: s.startSec, durSec: s.durSec, text: s.text });
  }
  // `[h:mm:ss] ` and the newline: what each segment costs once it is a line of the source.
  const cost = (seg: TranscriptSegment) => seg.text.length + formatTimestamp(seg.startSec).length + 4;
  if (merged.reduce((n, seg) => n + cost(seg), 0) <= maxChars) return merged;
  const MIN_LINE = 40;
  const step = Math.max(1, Math.ceil((merged.length * (MIN_LINE + 12)) / maxChars));
  const kept = merged.filter((_, i) => i % step === 0);
  const perLine = Math.max(MIN_LINE, Math.floor(maxChars / kept.length) - 12);
  return kept.map((seg) => (seg.text.length > perLine ? { ...seg, text: `${seg.text.slice(0, perLine - 1)}…` } : seg));
}

/** Transcript as timestamped lines, one per ~30 seconds, so the model can place every topic in time. */
export function outlineSource(segments: TranscriptSegment[], maxChars = OUTLINE_SOURCE_MAX_CHARS): string {
  return condenseTranscript(segments, maxChars)
    .map((seg) => `[${formatTimestamp(seg.startSec)}] ${seg.text}`)
    .join('\n');
}

const SYSTEM = [
  'You segment a video lecture into the topics it teaches, from its transcript.',
  'Every [mm:ss] or [h:mm:ss] marker in the transcript is the time that line is spoken. Section start times must come from those markers — never invent a time.',
  'The transcript may be in Hindi or another language, and may be auto-generated with misheard words. Understand it in its own language; write every title and summary in English, giving technical terms their usual English names.',
  'Output only the outline lines in the requested format. No introduction, no numbering, no markdown, no LaTeX — write O(n), not \\(O(n)\\).',
].join(' ');

export function buildOutlinePrompt(request: Omit<OutlineRequest, 'segments'>, source: string): AiPrompt {
  const hints = request.hints.length
    ? `\nThe creator's own chapter markers (use them when they agree with the transcript; split or correct them when they do not):\n${request.hints
        .slice(0, 60)
        .map((h) => `${formatTimestamp(h.startSec)} ${h.title}`)
        .join('\n')}\n`
    : '';
  const minutes = request.durationSec ? Math.round(request.durationSec / 60) : null;
  const target = minutes ? Math.max(3, Math.min(MAX_SECTIONS, Math.round(minutes / 4))) : 12;
  return {
    system: SYSTEM,
    user: `Video: ${request.title}${request.channel ? ` — ${request.channel}` : ''}${minutes ? ` (${minutes} min)` : ''}
${hints}
Transcript:
"""
${source}
"""

Task: Divide the whole video, start to end, into about ${target} consecutive sections, one per topic actually taught. Start a new section wherever the subject changes. Skip nothing; merge small asides into the section around them.

Format — one section per line, in time order:
mm:ss | Section title (3–8 words) | One sentence on what is taught there`,
  };
}

const TIME = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[|–—-]\s*(.+)$/;

/**
 * Turns the model's lines into sections, defensively: unparseable lines are skipped, times are sorted
 * and clamped to the video, duplicates at the same second are merged, and each section ends where the
 * next begins. Returns null when there is not a usable outline in the text.
 */
export function parseOutline(text: string, durationSec: number | null): OutlineSection[] | null {
  const found: { startSec: number; title: string; summary: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '').match(TIME);
    if (!m) continue;
    const startSec = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (durationSec && startSec >= durationSec) continue;
    const [title, ...rest] = m[4].split('|').map((p) => p.trim().replace(/\*\*/g, ''));
    if (!title) continue;
    found.push({ startSec, title: title.slice(0, 120), summary: rest.join(' ').slice(0, 300) });
  }
  found.sort((a, b) => a.startSec - b.startSec);
  const unique = found.filter((s, i) => i === 0 || s.startSec !== found[i - 1].startSec).slice(0, MAX_SECTIONS);
  if (unique.length < MIN_SECTIONS) return null;
  if (unique[0].startSec > 0 && unique[0].startSec < 60) unique[0].startSec = 0;
  const end = durationSec ?? unique[unique.length - 1].startSec + 60;
  return unique.map((s, i) => ({ ...s, endSec: i + 1 < unique.length ? unique[i + 1].startSec : Math.max(end, s.startSec + 1) }));
}

/** The outline as prompt lines, with the section the learner is in marked. Bounded so it never crowds out the transcript. */
export function outlineBlock(sections: OutlineSection[], currentTime: number): string {
  const lines = sections.map((s) => {
    const here = currentTime >= s.startSec && currentTime < s.endSec ? '  ← learner is here' : '';
    return `${formatTimestamp(s.startSec)}–${formatTimestamp(s.endSec)} ${s.title}${s.summary ? ` — ${s.summary}` : ''}${here}`;
  });
  let out = lines.join('\n');
  if (out.length > BLOCK_MAX_CHARS) out = sections.map((s) => `${formatTimestamp(s.startSec)}–${formatTimestamp(s.endSec)} ${s.title}`).join('\n').slice(0, BLOCK_MAX_CHARS);
  return `[Whole-video outline — every topic and when it is taught]\n${out}`;
}

/**
 * The cache key for one transcript of one video: a SHA-256 of the exact segments. The server computes
 * it from what it was sent, so an outline is only ever served to callers holding the same transcript —
 * a client sending a made-up transcript for a popular video gets its own entry, never everyone's.
 */
export async function transcriptKey(segments: TranscriptSegment[]): Promise<string> {
  const canonical = segments.map((s) => `${s.startSec}|${s.durSec}|${s.text}`).join('\n');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
