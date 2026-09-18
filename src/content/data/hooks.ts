import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LearningMode, Topic } from '@/types/domain';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { fingerprintOf, isRelevant } from '@/learning/classifier';
import { getClassifier } from '@/ai/registry';
import { discoveryQueriesFor, rankDiscovery, type DiscoveredVideo, type DiscoveryCandidate } from '@/learning/discovery';
import type { FeedView } from '@/learning/feed-view';
import { COMPLETE_AT, mergeNextItems, resumeItems, seriesItems, type HistoryLike, type NextLearningItem } from '@/learning/next';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { fetchDiscoveryPage, loadHistory, loadRecommendations } from './youtube';
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
  const key = `${mode.id}|${topic?.id ?? ''}|${fingerprint}|${mode.discovery}`;
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

  const anchor = entries[0] ?? null;
  const anchorKey = anchor ? `${anchor.videoId}:${anchor.progress >= COMPLETE_AT}:${view?.computedAt ?? 0}` : '';

  useEffect(() => {
    if (!anchor) {
      setSeries([]);
      return;
    }
    let alive = true;
    seriesFor(
      { videoId: anchor.videoId, title: anchor.title, channelId: anchor.channelId, channelTitle: anchor.channelTitle, playlistId: anchor.playlistId ?? null },
      { pool: view?.items ?? [], history: store?.watchHistory ?? [], ytWatched: youtubeHistory, currentVideoId: anchor.progress < COMPLETE_AT ? anchor.videoId : null },
    )
      .then((state) => alive && setSeries(state ? seriesItems(state).filter((i) => i.videoId !== anchor.videoId) : []))
      .catch(() => alive && setSeries([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  return useMemo(() => mergeNextItems([series, resumeItems(entries)], 6), [series, entries]);
}
