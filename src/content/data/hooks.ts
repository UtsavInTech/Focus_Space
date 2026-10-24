import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LearningMode, Topic } from '@/types/domain';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { fingerprintOf, isRelevant } from '@/learning/classifier';
import { getClassifier } from '@/ai/registry';
import { discoveryQueriesFor, rankDiscovery, type DiscoveredVideo, type DiscoveryCandidate } from '@/learning/discovery';
import type { FeedView } from '@/learning/feed-view';
import { COMPLETE_AT, interleave, mergeNextItems, resumeItems, seriesItems, seriesNumber, type HistoryLike, type NextLearningItem } from '@/learning/next';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { fetchDiscoveryPage, loadHistory, loadRecommendations, pageYouTube } from './youtube';
import { cached } from './cache';
import { seriesFor } from './series';

/* ─── Subscription feed (precomputed in the background) ────────────────────── */

export function useFeedView(mode: LearningMode | null) {
  const store = useStorage(['feedViews'] as const);
  const fingerprint = useMemo(() => (mode ? fingerprintOf(mode) : null), [mode]);
  const view = mode && store ? store.feedViews.modes[mode.id] ?? null : null;
  const fresh = !!view && view.fingerprint === fingerprint;
  const requested = useRef<string | null>(null);

  useEffect(() => {
    if (!mode || !store || fresh) return;
    const key = `${mode.id}|${fingerprint}`;
    if (requested.current === key) return;
    requested.current = key;
    void sendMessage('library/view', { modeId: mode.id }).catch(() => undefined);
  }, [mode, store, fresh, fingerprint]);

  return { loading: !store || (!!mode && !view), view, channelIds: store?.feedViews.channelIds ?? [] };
}

/* ─── YouTube discovery ────────────────────────────────────────────────────── */

export interface DiscoveryState {
  items: DiscoveredVideo[];
  loading: boolean;
  error: string | null;
  exhausted: boolean;
  loadMore: () => void;
}

/**
 * Pages through the space's discovery searches one request at a time, only
 * when the feed needs more, and re-ranks everything found so far.
 */
export function useDiscovery(mode: LearningMode, topic: Topic | null, excludeVideoIds: string[], excludeChannelIds: string[]): DiscoveryState {
  const fingerprint = useMemo(() => fingerprintOf(mode), [mode]);
  const queries = useMemo(() => (mode.discovery ? discoveryQueriesFor(mode, topic) : []), [mode, topic]);
  const key = `${mode.id}|${topic?.id ?? ''}|${topic?.name ?? ''}|${fingerprint}|${mode.discovery}`;
  const exclude = useMemo(() => ({ videoIds: new Set(excludeVideoIds), channelIds: new Set(excludeChannelIds) }), [excludeVideoIds, excludeChannelIds]);
  const [state, setState] = useState({ items: [] as DiscoveredVideo[], loading: false, error: null as string | null, exhausted: queries.length === 0 });
  const cursor = useRef({ key: '', index: 0, continuation: null as string | null, candidates: [] as DiscoveryCandidate[], busy: false, recsLoaded: false });
  // Behavioral creator preference (docs/V5_CONTRACT.md §D) — this is what lets a
  // repeatedly-watched but unsubscribed creator's videos rank higher here.
  const preferences = useStorage(['preferenceProfiles'] as const);
  const affinity = preferences?.preferenceProfiles.modes[mode.id]?.channels;

  const rank = useCallback(() => {
    setState((s) => ({ ...s, items: rankDiscovery(mode, cursor.current.candidates, exclude, topic?.id ?? null, affinity) }));
  }, [mode, topic, exclude, affinity]);

  const loadMore = useCallback(() => {
    const c = cursor.current;
    if (c.busy || c.key !== key) return;
    if (c.index >= queries.length) {
      setState((s) => (s.exhausted ? s : { ...s, exhausted: true, loading: false }));
      return;
    }
    c.busy = true;
    setState((s) => ({ ...s, loading: true }));
    const query = queries[c.index];
    const continuation = c.continuation;
    void (async () => {
      try {
        const page = await fetchDiscoveryPage(query, continuation);
        if (c.key !== key) return;
        c.candidates.push(...page.videos.map((video) => ({ video, query, fromSpaceQuery: true, topicId: topic?.id ?? null })));
        // One follow-up page per query, then the next query.
        if (!continuation && page.continuation) c.continuation = page.continuation;
        else {
          c.index++;
          c.continuation = null;
        }
        if (!topic && !c.recsLoaded) {
          c.recsLoaded = true;
          const recs = await loadRecommendations().catch(() => [] as YtVideo[]);
          if (c.key === key) c.candidates.push(...recs.map((video) => ({ video, query: null, fromSpaceQuery: false, topicId: null })));
        }
        rank();
        setState((s) => ({ ...s, loading: false, error: null, exhausted: c.index >= queries.length }));
      } catch {
        if (c.key !== key) return;
        c.index++;
        c.continuation = null;
        setState((s) => ({ ...s, loading: false, error: 'YouTube discovery is unavailable right now.', exhausted: c.index >= queries.length }));
      } finally {
        c.busy = false;
      }
    })();
  }, [key, queries, topic, rank]);

  useEffect(() => {
    cursor.current = { key, index: 0, continuation: null, candidates: [], busy: false, recsLoaded: false };
    setState({ items: [], loading: queries.length > 0, error: null, exhausted: queries.length === 0 });
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Newly synced library videos leave discovery.
  useEffect(() => {
    if (cursor.current.candidates.length) rank();
  }, [exclude, rank]);

  return { ...state, loadMore };
}

/* ─── Continue watching ────────────────────────────────────────────────────── */

export function useContinueWatching(mode: LearningMode, view: FeedView | null): NextLearningItem[] {
  const store = useStorage(['watchHistory'] as const);
  const [youtubeHistory, setYoutubeHistory] = useState<YtVideo[]>([]);
  const [series, setSeries] = useState<NextLearningItem[]>([]);

  useEffect(() => {
    let alive = true;
    loadHistory()
      .then((videos) => alive && setYoutubeHistory(videos))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const entries = useMemo(() => {
    const classifier = getClassifier();
    const now = Date.now();
    const byId = new Map<string, HistoryLike & { channelId: string | null }>();
    for (const e of store?.watchHistory ?? []) {
      const relevant = e.modeId === mode.id || isRelevant(classifier.classify({ videoId: e.videoId, title: e.title, channelId: e.channelId ?? undefined, channelTitle: e.channelTitle }, mode));
      if (relevant) byId.set(e.videoId, { videoId: e.videoId, title: e.title, channelTitle: e.channelTitle, channelId: e.channelId, progress: e.progress, watchedAt: e.watchedAt, playlistId: e.playlistId });
    }
    // YouTube's own history (signed in): ordered newest first, no exact times.
    youtubeHistory.forEach((v, i) => {
      if (v.watchedPercent === null || v.isShort) return;
      if (!isRelevant(classifier.classify({ videoId: v.id, title: v.title, channelId: v.channelId ?? undefined, channelTitle: v.channelTitle }, mode))) return;
      const existing = byId.get(v.id);
      const progress = Math.max(existing?.progress ?? 0, v.watchedPercent / 100);
      byId.set(v.id, existing ? { ...existing, progress } : { videoId: v.id, title: v.title, channelTitle: v.channelTitle, channelId: v.channelId, progress, watchedAt: now - 3_600_000 - i * 60_000, playlistId: null });
    });
    return [...byId.values()].sort((a, b) => b.watchedAt - a.watchedAt);
  }, [store?.watchHistory, youtubeHistory, mode]);

  /*
   * Up to three series at once — the Linked List course *and* the Stack playlist someone is halfway
   * through — not only whatever was watched last. One anchor per series: its most recent video.
   */
  const anchors = useMemo(() => {
    const seen = new Set<string>();
    const picked: typeof entries = [];
    for (const e of entries) {
      const numbered = seriesNumber(e.title);
      const key = e.playlistId ? `list:${e.playlistId}` : numbered && e.channelId ? `${e.channelId}:${numbered.key}` : picked.length ? null : `latest:${e.videoId}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      picked.push(e);
      if (picked.length === 3) break;
    }
    return picked;
  }, [entries]);
  const anchorKey = anchors.map((a) => `${a.videoId}:${a.progress >= COMPLETE_AT}`).join('|') + `:${view?.computedAt ?? 0}`;

  useEffect(() => {
    if (!anchors.length) {
      setSeries([]);
      return;
    }
    let alive = true;
    const anchorIds = new Set(anchors.map((a) => a.videoId));
    void Promise.all(
      anchors.map((anchor) =>
        seriesFor(
          { videoId: anchor.videoId, title: anchor.title, channelId: anchor.channelId, channelTitle: anchor.channelTitle, playlistId: anchor.playlistId ?? null },
          { pool: view?.items ?? [], history: store?.watchHistory ?? [], ytWatched: youtubeHistory, currentVideoId: anchor.progress < COMPLETE_AT ? anchor.videoId : null },
        )
          .then((state) => (state ? seriesItems(state).filter((i) => !anchorIds.has(i.videoId)) : []))
          .catch(() => []),
      ),
    ).then((lists) => alive && setSeries(mergeNextItems([interleave(lists)], 6)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  return useMemo(() => mergeNextItems([series, resumeItems(entries)], 6), [series, entries]);
}

export interface PlayedRow {
  /** The video it grows from: "Because you played …". */
  seed: { videoId: string; title: string; channelId: string | null };
  videos: YtVideo[];
}

/**
 * "Because you played …" — for Spaces that are about listening or watching rather than a course
 * (music, entertainment): YouTube's own "up next" for the last things played in this Space, minus
 * what has already been watched. A course gets its next episode instead (useContinueWatching).
 */
export function useBecauseYouPlayed(mode: LearningMode): PlayedRow[] {
  const store = useStorage(['watchHistory'] as const);
  const [rows, setRows] = useState<PlayedRow[]>([]);
  const seeds = useMemo(() => {
    const out: { videoId: string; title: string; channelId: string | null }[] = [];
    for (const e of [...(store?.watchHistory ?? [])].sort((a, b) => b.watchedAt - a.watchedAt)) {
      if (e.modeId !== mode.id || out.some((s) => s.videoId === e.videoId)) continue;
      out.push({ videoId: e.videoId, title: e.title, channelId: e.channelId });
      if (out.length === 2) break;
    }
    return out;
  }, [store?.watchHistory, mode.id]);
  const seedKey = seeds.map((s) => s.videoId).join(',');

  useEffect(() => {
    if (!seeds.length) {
      setRows([]);
      return;
    }
    let alive = true;
    const watched = new Set((store?.watchHistory ?? []).map((e) => e.videoId));
    const classifier = getClassifier();
    // YouTube's "up next" follows the viewer, not the song — a travel vlog or a tech video rides along.
    // Only the same artist, or what this Space itself would call a match, stays.
    const belongs = (v: YtVideo, seedChannel: string | null) =>
      (!!seedChannel && v.channelId === seedChannel) || isRelevant(classifier.classify({ videoId: v.id, title: v.title, channelId: v.channelId ?? undefined, channelTitle: v.channelTitle }, mode));
    void Promise.all(
      seeds.map((seed) =>
        cached(`related:${seed.videoId}`, 30 * 60_000, () => pageYouTube.watchNext(seed.videoId))
          .then((page) => ({ seed, videos: page.related.filter((v) => v.id && !v.isShort && !v.isLive && !watched.has(v.id) && belongs(v, seed.channelId)) }))
          .catch(() => ({ seed, videos: [] as YtVideo[] })),
      ),
    ).then((found) => {
      if (!alive) return;
      // A video suggested for both seeds shows once, under the first.
      const shown = new Set<string>();
      setRows(found.map((r) => ({ seed: r.seed, videos: r.videos.filter((v) => (shown.has(v.id) ? false : (shown.add(v.id), true))).slice(0, 8) })).filter((r) => r.videos.length >= 2));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  return rows;
}
