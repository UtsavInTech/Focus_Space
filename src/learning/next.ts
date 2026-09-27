import { normalizeText } from './text';

/**
 * "What should I watch next?" — series continuity and resume logic.
 *
 * Inputs are only what FocusSpace can legitimately know: its own local watch
 * history (with progress), watch progress YouTube shows the signed-in user,
 * playlists, and numbered titles within a channel. Every answer carries a
 * confidence so the UI never over-claims.
 */

export type Confidence = 'high' | 'medium' | 'low';

export interface SeriesItem {
  videoId: string;
  title: string;
  /** 1-based position. */
  index: number;
  channelTitle?: string;
  thumbnail?: string;
  durationSec?: number | null;
}

export interface SeriesSource {
  id: string;
  title: string;
  kind: 'playlist' | 'numbered';
  items: SeriesItem[];
}

export interface SeriesState {
  series: SeriesSource;
  current: SeriesItem | null;
  completed: number[];
  missed: SeriesItem[];
  next: SeriesItem | null;
  upcoming: SeriesItem[];
  confidence: Confidence;
  completedLabel: string | null;
}

export type NextKind = 'missed' | 'resume' | 'next';

export interface NextLearningItem {
  kind: NextKind;
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  progress: number | null;
  reason: string;
  confidence: Confidence;
  /** Watch URL including the playlist when the item belongs to one. */
  url: string;
}

export const COMPLETE_AT = 0.85;

/* ─── Numbered titles ──────────────────────────────────────────────────────── */

const PATTERNS: { re: RegExp; style: string }[] = [
  { re: /^\s*(\d{1,2})\.(\d{1,2})(?:\.\d{1,2})?[\s:.)-]/, style: 'decimal' },
  { re: /^\s*(?:l|lec|lecture|ep|episode|part|day|video|chapter|module|class|session|lesson)\s*[-.#:]?\s*(\d{1,3})\b/i, style: 'prefix' },
  { re: /\b(?:lecture|lec|episode|ep|part|day|chapter|module|class|session|lesson)\s*[-.#:]?\s*(\d{1,3})\b/i, style: 'inline' },
  { re: /^\s*#?(\d{1,3})\s*[.:)|-]\s+/, style: 'lead' },
  { re: /(?:^|\s)#(\d{1,3})\b/, style: 'hash' },
];

/** Position and a grouping key for titles like "L18. Implement LRU Cache | Stack Playlist" or "4.7 Traveling Salesman". */
export function seriesNumber(title: string): { n: number; key: string } | null {
  for (const { re, style } of PATTERNS) {
    const m = title.match(re);
    if (!m) continue;
    const n = style === 'decimal' ? Number(m[1]) * 100 + Number(m[2]) : Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const prefix = normalizeText(m[0]).replace(/[\d\s.:#)|-]+/g, '') || style;
    // Series titles often share a trailing segment ("| Stack and Queue Playlist").
    const suffix = title.includes('|') ? normalizeText(title.slice(title.lastIndexOf('|') + 1)) : '';
    return { n, key: `${style}:${prefix}:${suffix}` };
  }
  return null;
}

/** Siblings of `anchor` in the same channel that share its numbering scheme. */
export function numberedSeries(
  anchor: { videoId: string; title: string; channelId: string | null; channelTitle?: string },
  pool: { id: string; title: string; channelId: string | null; thumbnail?: string; durationSec?: number | null }[],
): SeriesSource | null {
  const own = seriesNumber(anchor.title);
  if (!own || !anchor.channelId) return null;
  const byNumber = new Map<number, SeriesItem>();
  for (const v of pool) {
    if (v.channelId !== anchor.channelId) continue;
    const s = seriesNumber(v.title);
    if (!s || s.key !== own.key || byNumber.has(s.n)) continue;
    byNumber.set(s.n, { videoId: v.id, title: v.title, index: s.n, channelTitle: anchor.channelTitle, thumbnail: v.thumbnail, durationSec: v.durationSec });
  }
  if (!byNumber.has(own.n)) byNumber.set(own.n, { videoId: anchor.videoId, title: anchor.title, index: own.n, channelTitle: anchor.channelTitle });
  if (byNumber.size < 2) return null;
  const items = [...byNumber.values()].sort((a, b) => a.index - b.index);
  const suffix = anchor.title.includes('|') ? anchor.title.slice(anchor.title.lastIndexOf('|') + 1).trim() : '';
  return { id: `${anchor.channelId}:${own.key}`, title: suffix || `${anchor.channelTitle ?? 'Channel'} series`, kind: 'numbered', items };
}

/** "1–17, 19–30" */
export function compressRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/** Label for a position: "Lecture 18" style when the titles use it, else "#18". */
export const positionLabel = (item: SeriesItem) => (item.index >= 100 && item.title.match(/^\s*\d{1,2}\.\d{1,2}/) ? item.title.match(/^\s*(\d{1,2}\.\d{1,2})/)![1] : `#${item.index}`);

/**
 * Where the user is in a series.
 * @param watched videoId → progress (0–1); only entries we actually know.
 * @param watchDataFromYouTube true when progress came from YouTube for every item (complete picture).
 */
export function buildSeriesState(series: SeriesSource, currentVideoId: string | null, watched: ReadonlyMap<string, number>, watchDataFromYouTube = false): SeriesState {
  const items = [...series.items].sort((a, b) => a.index - b.index);
  const done = (item: SeriesItem) => (watched.get(item.videoId) ?? 0) >= COMPLETE_AT;
  const current = items.find((i) => i.videoId === currentVideoId) ?? null;
  const completed = items.filter(done).map((i) => i.index);
  const maxCompleted = completed.length ? Math.max(...completed) : null;
  const pivot = current?.index ?? maxCompleted;

  // "Missed" needs evidence the user moved past it: something later is completed.
  const missed =
    pivot === null || completed.length < 2
      ? []
      : items.filter((i) => i.index < pivot && !done(i) && i !== current && (watchDataFromYouTube || (watched.has(i.videoId) && (watched.get(i.videoId) ?? 0) < COMPLETE_AT) || completed.some((c) => c > i.index)));
  const next = items.find((i) => (pivot === null ? !done(i) : i.index > pivot && !done(i))) ?? null;
  const upcoming = next ? items.filter((i) => i.index > next.index && !done(i)).slice(0, 3) : [];

  let confidence: Confidence;
  if (series.kind === 'playlist') confidence = watchDataFromYouTube || current ? 'high' : 'medium';
  else {
    const indexes = new Set(items.map((i) => i.index));
    const around = pivot !== null && (indexes.has(pivot + 1) || indexes.has(pivot - 1));
    confidence = around ? 'medium' : 'low';
  }

  return {
    series: { ...series, items },
    current,
    completed,
    missed: missed.slice(0, 3),
    next,
    upcoming,
    confidence,
    completedLabel: completed.length ? compressRanges(completed) : null,
  };
}

export interface HistoryLike {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail?: string;
  progress: number;
  watchedAt: number;
  playlistId?: string | null;
}

const watchUrl = (videoId: string, playlistId?: string | null) => `https://www.youtube.com/watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ''}`;
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** Videos started but not finished, most recent first. */
export function resumeItems(entries: HistoryLike[], now = Date.now(), maxAgeDays = 45): NextLearningItem[] {
  return entries
    .filter((e) => e.progress >= 0.05 && e.progress < COMPLETE_AT && now - e.watchedAt < maxAgeDays * 86_400_000)
    .sort((a, b) => b.watchedAt - a.watchedAt)
    .map((e) => ({
      kind: 'resume' as const,
      videoId: e.videoId,
      title: e.title,
      channelTitle: e.channelTitle,
      thumbnail: e.thumbnail ?? thumb(e.videoId),
      progress: e.progress,
      reason: `${Math.round(e.progress * 100)}% watched`,
      confidence: 'high' as const,
      url: watchUrl(e.videoId, e.playlistId),
    }));
}

/** Missed and next items from a series state. */
export function seriesItems(state: SeriesState): NextLearningItem[] {
  const playlistId = state.series.kind === 'playlist' ? state.series.id : null;
  const toItem = (item: SeriesItem, kind: NextKind, reason: string): NextLearningItem => ({
    kind,
    videoId: item.videoId,
    title: item.title,
    channelTitle: item.channelTitle ?? '',
    thumbnail: item.thumbnail ?? thumb(item.videoId),
    progress: null,
    reason,
    confidence: state.confidence,
    url: watchUrl(item.videoId, playlistId),
  });
  const nextReason = state.confidence === 'high' ? `Next in ${state.series.title}` : state.confidence === 'medium' ? `Appears to be next in ${state.series.title}` : `Continue exploring ${state.series.title}`;
  return [...state.missed.map((m) => toItem(m, 'missed', `You skipped this in ${state.series.title}`)), ...(state.next ? [toItem(state.next, 'next', nextReason)] : [])];
}

/** Missed first (it's easy to forget), then resume, then next — de-duplicated. */
/** Takes turns between lists — each series gets its "next" in before any series gets a second. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

export function mergeNextItems(lists: NextLearningItem[][], limit = 6): NextLearningItem[] {
  const order: Record<NextKind, number> = { missed: 0, resume: 1, next: 2 };
  const seen = new Set<string>();
  return lists
    .flat()
    .sort((a, b) => order[a.kind] - order[b.kind])
    .filter((i) => (seen.has(i.videoId) ? false : (seen.add(i.videoId), true)))
    .slice(0, limit);
}

/**
 * What to type into YouTube to find episode `n` of the series `title` belongs to — for when the
 * channel's latest uploads don't reach back far enough ("Lecture 102" of a 150-lecture course).
 * "Lecture 104: Deep Copy… || Linked List Series Day-27" → "CodeHelp - by Babbar Lecture 105".
 */
export function seriesSearchQuery(title: string, channelTitle: string, n: number): string | null {
  const word = title.match(/\b(lecture|lec|episode|ep|part|day|chapter|module|class|session|lesson|video)\s*[-.#:]?\s*\d{1,3}\b/i)?.[1] ?? (/^\s*l\s*[-.]?\s*\d{1,3}\b/i.test(title) ? 'L' : null);
  if (!word) return null;
  const label = word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1).toLowerCase();
  return `${channelTitle} ${label} ${n}`.trim();
}
