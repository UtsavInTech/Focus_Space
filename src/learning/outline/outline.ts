import type { AiPrompt } from '../ai/actions';
import { labelSimilarity } from '../knowledge/text';
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
 * Long videos are outlined in parts. One request over a 12-hour marathon read ~14% of it and could name
 * ~40 topics — one per 18 minutes, too coarse to find anything in. Past LONG_VIDEO_SEC the video is cut
 * into ~1-hour parts, each outlined on its own and merged. Up to LONG_VIDEO_SEC nothing changes: the same
 * captions condense to the same segments, so every outline already stored is still found.
 *
 * An hour, not two: on a real 5h22m course, gpt-4o-mini given ~1¾ hours at once squeezed the last hour's
 * topics into the part's first ten minutes (where they are only previewed) and stopped — see
 * `longGaps` for the repair that catches what still slips through.
 */
export const LONG_VIDEO_SEC = 3 * 3600;
export const OUTLINE_PART_SEC = 3600;
/**
 * The whole upload for a long video. The API takes at most 2 MB (server/index.ts OUTLINE_MAX_BODY_BYTES),
 * and Hindi captions cost three bytes a character — so ~480k characters, split across the parts.
 */
export const LONG_SOURCE_MAX_CHARS = 480_000;
/** A 12-hour video gets ~180 topics; a 30-hour one is thinned to this. */
export const MAX_LONG_SECTIONS = 200;
/** A section at least this long, and GAP_FACTOR times the typical one, is a stretch the model skipped. */
const GAP_MIN_SEC = 20 * 60;
const GAP_FACTOR = 4;

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

export interface OutlinePart {
  startSec: number;
  endSec: number;
}

/** Where the transcript ends. Condensing keeps the last segment's end, so a condensed transcript gives the same answer. */
const transcriptEnd = (segments: TranscriptSegment[]) => segments.reduce((end, s) => Math.max(end, s.startSec + s.durSec), 0);

/**
 * The parts a long video is outlined in: equal spans of about OUTLINE_PART_SEC, so no part is a stub
 * (a 5h20m video is five parts of 1:04, not five of 1:00 and a twenty-minute tail). Null for a video
 * no longer than LONG_VIDEO_SEC — it is outlined whole, exactly as before.
 */
export function outlineParts(segments: TranscriptSegment[]): OutlinePart[] | null {
  const end = transcriptEnd(segments);
  if (end <= LONG_VIDEO_SEC) return null;
  const count = Math.max(2, Math.round(end / OUTLINE_PART_SEC));
  const width = end / count;
  return Array.from({ length: count }, (_, i) => ({ startSec: Math.floor(width * i), endSec: i + 1 < count ? Math.floor(width * (i + 1)) : Math.ceil(end) }));
}

/** The segments that start inside a part; the last part takes everything to the end. */
export function segmentsInPart(segments: TranscriptSegment[], part: OutlinePart, last: boolean): TranscriptSegment[] {
  return segments.filter((s) => s.startSec >= part.startSec && (last || s.startSec < part.endSec));
}

/** The source budget of one part of a long video. */
export const partBudget = (parts: number) => Math.min(OUTLINE_SOURCE_MAX_CHARS, Math.floor(LONG_SOURCE_MAX_CHARS / parts));

/**
 * What the extension uploads to have a video outlined: `condenseTranscript` for a video up to
 * LONG_VIDEO_SEC (unchanged, so stored outlines keep matching), and for a longer one each part
 * condensed on its own budget — every part is read, not a thin sample of the whole.
 */
export function condenseForOutline(segments: TranscriptSegment[]): TranscriptSegment[] {
  const parts = outlineParts(segments);
  if (!parts) return condenseTranscript(segments);
  const budget = partBudget(parts.length);
  return parts.flatMap((part, i) => condenseTranscript(segmentsInPart(segments, part, i === parts.length - 1), budget));
}

/** Transcript as timestamped lines, one per ~30 seconds, so the model can place every topic in time. */
export function outlineSource(segments: TranscriptSegment[], maxChars = OUTLINE_SOURCE_MAX_CHARS): string {
  return condenseTranscript(segments, maxChars)
    .map((seg) => `[${formatTimestamp(seg.startSec)}] ${seg.text}`)
    .join('\n');
}

const SYSTEM = [
  'You segment a video lecture into the topics it teaches, from its transcript.',
  'Every [mm:ss] or [h:mm:ss] marker in the transcript is the time that line is spoken. Section start times must come from those markers, never invent a time.',
  'The transcript may be in Hindi or another language, and may be auto-generated with misheard words. Understand it in its own language; write every title and summary in English, giving technical terms their usual English names.',
  'Output only the outline lines in the requested format. No introduction, no numbering, no markdown, no LaTeX, write O(n), not \\(O(n)\\).',
].join(' ');

/** One part of a long video being outlined on its own (see outlineParts), or a skipped stretch being redone (see longGaps). */
export interface OutlinePromptPart extends OutlinePart {
  /** Which of `count` parts; absent for a repair. */
  index?: number;
  count?: number;
  /** How many sections this part may have, so the whole video stays within MAX_LONG_SECTIONS. */
  maxSections: number;
}

export function buildOutlinePrompt(request: Omit<OutlineRequest, 'segments'>, source: string, part?: OutlinePromptPart): AiPrompt {
  const ownHints = part ? request.hints.filter((h) => h.startSec >= part.startSec && h.startSec < part.endSec) : request.hints;
  const hints = ownHints.length
    ? `\nThe creator's own chapter markers (use them when they agree with the transcript; split or correct them when they do not):\n${ownHints
        .slice(0, 60)
        .map((h) => `${formatTimestamp(h.startSec)} ${h.title}`)
        .join('\n')}\n`
    : '';
  const minutes = request.durationSec ? Math.round(request.durationSec / 60) : null;
  const partMinutes = part ? Math.round((part.endSec - part.startSec) / 60) : null;
  const target = part
    ? Math.max(3, Math.min(part.maxSections, Math.round(partMinutes! / 4)))
    : minutes
      ? Math.max(3, Math.min(MAX_SECTIONS, Math.round(minutes / 4)))
      : 12;
  const scope = part
    ? `This transcript is ${part.index !== undefined && part.count ? `part ${part.index + 1} of ${part.count}` : 'one stretch'} of a long video: ${formatTimestamp(part.startSec)} to ${formatTimestamp(part.endSec)}. The rest is outlined separately.`
    : '';
  const task = part
    ? `Divide this part, from ${formatTimestamp(part.startSec)} to ${formatTimestamp(part.endSec)}, into about ${target} consecutive sections, one per topic actually taught. The first section starts at the first marker. Start a new section wherever the subject changes. Place each section at the marker where that topic is actually taught, not where it is first previewed or mentioned. Cover the part all the way to ${formatTimestamp(part.endSec)}: the last section starts in its final stretch. Skip nothing; merge small asides into the section around them.`
    : `Divide the whole video, start to end, into about ${target} consecutive sections, one per topic actually taught. Start a new section wherever the subject changes. Skip nothing; merge small asides into the section around them.`;
  return {
    system: SYSTEM,
    user: `Video: ${request.title}${request.channel ? `, ${request.channel}` : ''}${minutes ? ` (${minutes} min)` : ''}
${scope ? `${scope}\n` : ''}${hints}
Transcript:
"""
${source}
"""

Task: ${task}

Format, one section per line, in time order:
${part && part.endSec > 3600 ? 'h:mm:ss, the time exactly as its marker writes it, hours included (2:41:27, not 41:27)' : 'mm:ss'} | Section title (3–8 words) | One sentence on what is taught there`,
  };
}

const TIME = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[|–—-]\s*(.+)$/;

/**
 * A two-part time from a part of a long video that lands outside the part, read the two ways the model
 * actually miswrites it: the hour dropped ("9:25" for 3:09:25) or hours and minutes without seconds
 * ("02:41" for 2:41:00). On the 5h22m course two whole parts came back hourless and were lost. Kept only
 * when a reading lands inside the part; otherwise null, and the line is skipped as before.
 */
function readInPart(a: number, b: number, part: OutlinePart): number | null {
  const inside = (t: number) => t >= part.startSec - 30 && t < part.endSec;
  const plain = a * 60 + b;
  if (inside(plain)) return plain;
  if (a < 60) for (let h = Math.floor(part.startSec / 3600); h <= Math.floor(part.endSec / 3600); h++) if (inside(h * 3600 + plain)) return h * 3600 + plain;
  if (b < 60 && inside(a * 3600 + b * 60)) return a * 3600 + b * 60;
  return null;
}

/**
 * Turns the model's lines into sections, defensively: unparseable lines are skipped, times are sorted
 * and clamped to the video, duplicates at the same second are merged, and each section ends where the
 * next begins. Returns null when there is not a usable outline in the text.
 *
 * `part` is set for one part of a long video: an hourless time outside it is re-read (readInPart).
 * Without it — every video up to three hours — parsing is exactly as it always was.
 */
export function parseOutline(text: string, durationSec: number | null, part?: OutlinePart): OutlineSection[] | null {
  const found: { startSec: number; title: string; summary: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '').match(TIME);
    if (!m) continue;
    let startSec: number | null = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (part && m[1] === undefined) startSec = readInPart(Number(m[2]), Number(m[3]), part);
    if (startSec === null) continue;
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

/**
 * One outline from the parts of a long video, each parsed on its own: sections outside their part are
 * dropped (a model sometimes restates the previous part), a topic running across a part boundary is
 * joined back into one, every section ends where the next begins, and the total is capped.
 */
export function mergeOutlineParts(parts: { part: OutlinePart; sections: OutlineSection[] }[], durationSec: number | null): OutlineSection[] | null {
  const all: OutlineSection[] = [];
  for (const { part, sections } of [...parts].sort((a, b) => a.part.startSec - b.part.startSec)) {
    for (const s of sections) {
      if (s.startSec < part.startSec - 30 || s.startSec >= part.endSec) continue;
      const prev = all[all.length - 1];
      if (prev && (s.startSec <= prev.startSec || labelSimilarity(prev.title, s.title) >= 0.8)) continue;
      all.push({ ...s, startSec: Math.max(s.startSec, part.startSec) });
    }
  }
  if (all.length < MIN_SECTIONS) return null;
  // Too many for the cap: keep an even spread across the whole video rather than its first hours.
  const step = all.length / MAX_LONG_SECTIONS;
  const kept = all.length <= MAX_LONG_SECTIONS ? all : Array.from({ length: MAX_LONG_SECTIONS }, (_, i) => all[Math.floor(i * step)]);
  const end = durationSec ?? Math.max(...parts.map((p) => p.part.endSec));
  return kept.map((s, i) => ({ ...s, endSec: i + 1 < kept.length ? kept[i + 1].startSec : Math.max(end, s.startSec + 1) }));
}

/**
 * Stretches of a merged long-video outline the model skipped: a section far longer than the rest
 * (at least GAP_MIN_SEC, and GAP_FACTOR times the median). On the 5h22m course both parts' tails came
 * back as one 43-minute and one 60-minute "section". Each is outlined again on its own, once.
 */
export function longGaps(sections: OutlineSection[]): OutlinePart[] {
  if (sections.length < 3) return [];
  const lengths = sections.map((s) => s.endSec - s.startSec).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  const limit = Math.max(GAP_MIN_SEC, GAP_FACTOR * median);
  return sections.filter((s) => s.endSec - s.startSec >= limit).map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
}

/**
 * Puts a re-outlined stretch in place of the one section that covered it. The new sections must lie
 * inside the stretch and be at least two; otherwise the original stays. The first keeps the stretch's
 * start, so nothing before it moves.
 */
export function spliceGap(sections: OutlineSection[], gap: OutlinePart, redone: OutlineSection[] | null): OutlineSection[] {
  const inside = (redone ?? []).filter((s) => s.startSec >= gap.startSec && s.startSec < gap.endSec);
  const at = sections.findIndex((s) => s.startSec === gap.startSec);
  if (inside.length < MIN_SECTIONS || at < 0) return sections;
  inside[0] = { ...inside[0], startSec: gap.startSec };
  const merged = [...sections.slice(0, at), ...inside, ...sections.slice(at + 1)];
  return merged.map((s, i) => ({ ...s, endSec: i + 1 < merged.length ? merged[i + 1].startSec : sections[sections.length - 1].endSec }));
}

/** The outline as prompt lines, with the section the learner is in marked. Bounded so it never crowds out the transcript. */
export function outlineBlock(sections: OutlineSection[], currentTime: number): string {
  const lines = sections.map((s) => {
    const here = currentTime >= s.startSec && currentTime < s.endSec ? '  ← learner is here' : '';
    return `${formatTimestamp(s.startSec)}–${formatTimestamp(s.endSec)} ${s.title}${s.summary ? `, ${s.summary}` : ''}${here}`;
  });
  let out = lines.join('\n');
  if (out.length > BLOCK_MAX_CHARS) out = sections.map((s) => `${formatTimestamp(s.startSec)}–${formatTimestamp(s.endSec)} ${s.title}`).join('\n');
  if (out.length <= BLOCK_MAX_CHARS) return `[Whole-video outline — every topic and when it is taught]\n${out}`;
  // A long video's outline still does not fit: keep the topics nearest the learner, in order, rather than cutting off its later hours.
  const here = Math.max(0, sections.findIndex((s) => currentTime >= s.startSec && currentTime < s.endSec));
  const order = sections.map((_, i) => i).sort((a, b) => Math.abs(a - here) - Math.abs(b - here));
  const keep = new Set<number>();
  let used = 0;
  for (const i of order) {
    const s = sections[i];
    const line = `${formatTimestamp(s.startSec)}–${formatTimestamp(s.endSec)} ${s.title}`.length + 1;
    if (used + line > BLOCK_MAX_CHARS) break;
    keep.add(i);
    used += line;
  }
  const near = sections.filter((_, i) => keep.has(i)).map((s) => `${formatTimestamp(s.startSec)}–${formatTimestamp(s.endSec)} ${s.title}`);
  return `[Outline of this video near the learner — ${keep.size} of its ${sections.length} topics, the rest omitted for length]\n${near.join('\n')}`;
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
