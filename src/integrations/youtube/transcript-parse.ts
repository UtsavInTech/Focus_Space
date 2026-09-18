import type { TranscriptSegment } from '@/learning/knowledge/types';

/**
 * Captions as YouTube's player loads them (/api/timedtext). json3 is what the
 * web player requests; srv3/XML is accepted too. Word-level events are merged
 * into short phrases so a 5-hour course stays a few hundred KB.
 */

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; aAppend?: number; segs?: { utf8?: string }[] }[];
}

const clean = (s: string) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[(?:music|applause|laughter|silence|__)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function parseTimedTextJson3(json: unknown): TranscriptSegment[] {
  const events = (json as Json3)?.events ?? [];
  const out: TranscriptSegment[] = [];
  for (const e of events) {
    if (!e.segs || e.aAppend) continue;
    const text = clean(e.segs.map((s) => s.utf8 ?? '').join(''));
    if (!text) continue;
    out.push({ startSec: (e.tStartMs ?? 0) / 1000, durSec: (e.dDurationMs ?? 0) / 1000, text });
  }
  return out;
}

export function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  // <text start="1.2" dur="3.4">…</text> (legacy) and <p t="1200" d="3400">…</p> (srv3)
  for (const m of xml.matchAll(/<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const attrs = m[2];
    const num = (name: string) => Number(attrs.match(new RegExp(`\\b${name}="([\\d.]+)"`))?.[1] ?? NaN);
    const ms = m[1] === 'p';
    const start = ms ? num('t') / 1000 : num('start');
    const dur = ms ? num('d') / 1000 : num('dur');
    const text = clean(m[3].replace(/<[^>]+>/g, ''));
    if (text && Number.isFinite(start)) out.push({ startSec: start, durSec: Number.isFinite(dur) ? dur : 0, text });
  }
  return out;
}

export function parseTimedText(body: string): TranscriptSegment[] {
  const trimmed = body.trimStart();
  if (!trimmed) return [];
  if (trimmed.startsWith('{')) {
    try {
      return parseTimedTextJson3(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return parseTimedTextXml(trimmed);
}

/** Merge consecutive phrases into segments of at most `maxSec` seconds. */
export function compactSegments(segments: TranscriptSegment[], maxSec = 12): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let cur: TranscriptSegment | null = null;
  for (const s of segments) {
    if (cur && s.startSec + s.durSec - cur.startSec <= maxSec && !/[.?!]$/.test(cur.text)) {
      cur.text = `${cur.text} ${s.text}`;
      cur.durSec = Math.max(cur.durSec, s.startSec + s.durSec - cur.startSec);
    } else {
      if (cur) out.push(cur);
      cur = { ...s };
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ startSec: Math.round(s.startSec * 10) / 10, durSec: Math.round(s.durSec * 10) / 10, text: s.text }));
}
