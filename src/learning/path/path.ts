import { buildSeriesState, COMPLETE_AT, positionLabel, type SeriesItem, type SeriesSource, type SeriesState } from '../next';

/**
 * The learning path for the video being watched: "You are here → Next → Then".
 *
 * A real playlist is authoritative. A sequence guessed from numbered titles is
 * only ever presented as a guess. "Next" means the next item the learner hasn't
 * finished — watched lectures after the current one are skipped over — and an
 * item only counts as watched with real progress (≥ COMPLETE_AT), never for
 * having been opened.
 */

/**
 * - playlist: the playlist the learner is watching through (list= in the URL)
 * - creator-playlist: a playlist the creator links from this video that contains it
 * - series: numbered titles from the same channel ("L18.", "Lecture 18")
 */
export type PathSource = 'playlist' | 'creator-playlist' | 'series';

export type RowState = 'watched' | 'in-progress' | 'current' | 'next' | 'skipped' | 'unwatched';

export interface PathRow {
  item: SeriesItem;
  state: RowState;
  /** 0–1 when known. */
  progress: number | null;
  label: string;
  /** Items hidden between the previous row and this one. */
  hiddenBefore: number;
}

export interface LearningPath {
  source: PathSource;
  id: string;
  title: string;
  total: number;
  /** Playlist id for watch links (keeps YouTube's playlist panel and autoplay order). */
  playlistId: string | null;
  current: SeriesItem | null;
  next: SeriesItem | null;
  /** Unfinished items after `next`. */
  then: SeriesItem[];
  /** Earlier items left unfinished while later ones were completed. */
  skipped: SeriesItem[];
  rows: PathRow[];
  watchedCount: number;
  /** "Next in this playlist" · "Next in this series" · "Appears to be next" */
  nextLabel: string;
  /** True when `next` is not simply the following item (watched ones were skipped over). */
  nextSkipsWatched: boolean;
  /** A real playlist, not a guess. */
  authoritative: boolean;
  state: SeriesState;
}

export const PATH_LABEL: Record<PathSource, string> = {
  playlist: 'This playlist',
  'creator-playlist': "Creator's playlist",
  series: 'Series',
};

export function buildLearningPath(
  series: SeriesSource,
  source: PathSource,
  currentVideoId: string | null,
  watched: ReadonlyMap<string, number>,
  options: { progressFromYouTube?: boolean; before?: number; after?: number } = {},
): LearningPath {
  const state = buildSeriesState(series, currentVideoId, watched, options.progressFromYouTube ?? false);
  const items = state.series.items;
  const progressOf = (item: SeriesItem) => watched.get(item.videoId) ?? null;
  const done = (item: SeriesItem) => (progressOf(item) ?? 0) >= COMPLETE_AT;
  const authoritative = source !== 'series';
  const skipped = new Set(state.missed.map((m) => m.videoId));

  const stateOf = (item: SeriesItem): RowState => {
    if (item.videoId === state.current?.videoId) return 'current';
    if (item.videoId === state.next?.videoId) return 'next';
    if (done(item)) return 'watched';
    if (skipped.has(item.videoId)) return 'skipped';
    return (progressOf(item) ?? 0) >= 0.05 ? 'in-progress' : 'unwatched';
  };

  // Window: a little context before "you are here", everything up to "next", a little after.
  const pos = (item: SeriesItem | null) => (item ? items.findIndex((i) => i.videoId === item.videoId) : -1);
  const cur = pos(state.current);
  const nxt = pos(state.next);
  const anchor = cur >= 0 ? cur : nxt >= 0 ? nxt : 0;
  const before = options.before ?? 2;
  const after = options.after ?? 2;
  const keep = new Set<number>();
  for (let i = Math.max(0, anchor - before); i <= Math.min(items.length - 1, Math.max(anchor, nxt) + after); i++) keep.add(i);
  // Between current and a far-away next, keep only the edges.
  if (cur >= 0 && nxt - cur > 5) for (let i = cur + 2; i < nxt - 1; i++) keep.delete(i);
  for (const s of state.missed) keep.add(pos(s));

  const rows: PathRow[] = [];
  let last = -1;
  for (const i of [...keep].filter((i) => i >= 0).sort((a, b) => a - b)) {
    const item = items[i];
    rows.push({ item, state: stateOf(item), progress: progressOf(item), label: positionLabel(item), hiddenBefore: last === -1 ? i : i - last - 1 });
    last = i;
  }

  const nextSkipsWatched = cur >= 0 && nxt > cur + 1;
  const nextLabel = authoritative
    ? `${nextSkipsWatched ? 'Next unwatched' : 'Next'} in this playlist`
    : state.confidence === 'medium' && state.current && items.length >= 3
      ? `${nextSkipsWatched ? 'Next unwatched' : 'Next'} in this series`
      : 'Appears to be next';

  return {
    source,
    id: series.id,
    title: series.title,
    total: items.length,
    playlistId: authoritative ? series.id : null,
    current: state.current,
    next: state.next,
    then: state.upcoming,
    skipped: state.missed,
    rows,
    watchedCount: items.filter(done).length,
    nextLabel,
    nextSkipsWatched,
    authoritative,
    state,
  };
}
