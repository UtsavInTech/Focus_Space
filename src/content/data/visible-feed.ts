import { useSyncExternalStore } from 'react';
import type { FeedVideo } from '@/learning/feed-view';
import type { HomepageOrigin } from '@/learning/ai/homepage-context';
import type { DiscoveredVideo } from '@/learning/discovery';
import type { NextLearningItem } from '@/learning/next';

/**
 * What the home view is currently showing, published for the AI entry to read.
 *
 * Why this exists: `AiEntry` and `SpaceHome` mount into two different slots
 * (separate React roots — see controller.ts), so there is no shared component
 * tree and no context to pass through. `AiEntry` used to build its own
 * context from `useFeedView().items`, which is only the *subscription* half of
 * the feed. On a space where the learner follows no matching channels — a new
 * install, or a subject they have not subscribed to yet — that list is empty,
 * so the AI was told "there are no videos" while the page was full of them,
 * and answered accordingly.
 *
 * A module-level store rather than a second set of hooks: `useDiscovery` and
 * `useContinueWatching` both fetch, and mounting them again in `AiEntry` would
 * duplicate every request. The home view already has the composed result, so
 * it publishes it and the AI reads it. One writer, many readers.
 */

export interface VisibleVideo extends FeedVideo {
  origin: HomepageOrigin;
}

export interface VisibleFeed {
  /** In the order they appear on the page: Continue watching first, then the composed feed. */
  videos: VisibleVideo[];
  /** The topic chip currently selected, by name — null when "All". */
  activeCategory: string | null;
}

/*
 * Two writers, because the page has two: the Continue watching row and the
 * feed below it are sibling components, not one tree. Each owns its own slot
 * here and the reader merges them, so neither can clobber the other's list.
 */
let continueVideos: VisibleVideo[] = [];
let feedVideos: VisibleVideo[] = [];
let activeCategory: string | null = null;

/** The merged result, rebuilt only when a slot actually changes — `useSyncExternalStore` requires a stable snapshot. */
let snapshot: VisibleFeed = { videos: [], activeCategory: null };
const listeners = new Set<() => void>();

function republish(): void {
  snapshot = { videos: [...continueVideos, ...feedVideos], activeCategory };
  for (const listener of listeners) listener();
}

/** Published by the feed below Continue watching, in the order it renders. */
export function publishFeedVideos(videos: VisibleVideo[], category: string | null): void {
  if (videos === feedVideos && category === activeCategory) return;
  feedVideos = videos;
  activeCategory = category;
  republish();
}

/** Published by the Continue watching row. These lead the list — see `continueToVisible`. */
export function publishContinueWatching(videos: VisibleVideo[]): void {
  if (videos === continueVideos) return;
  continueVideos = videos;
  republish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVisibleFeed(): VisibleFeed {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/**
 * Discovery results carry a `YtVideo` plus its classification rather than a
 * `FeedVideo`; this is the one place that gap is bridged. Fields the feed view
 * computes for library videos and discovery genuinely lacks (topic scores,
 * matched terms, difficulty) are left empty rather than guessed — nothing
 * downstream reads them for a discovery item.
 */
export function discoveredToVisible(found: DiscoveredVideo): VisibleVideo {
  const { video, cls } = found;
  return {
    id: video.id,
    title: video.title,
    channelId: video.channelId ?? '',
    channelTitle: video.channelTitle,
    thumbnail: video.thumbnail,
    publishedAt: video.publishedAt ?? 0,
    views: video.views,
    durationSec: video.durationSec,
    relevance: cls.relevance,
    tier: cls.tier,
    topicId: found.topicId,
    topicScores: {},
    matched: [],
    difficulty: null,
    learning: 0,
    source: 'subscription',
    origin: 'discovery',
  };
}

/**
 * A "Continue watching" row. These are already the strongest thing on the
 * page — a lecture the learner is genuinely part-way through beats any fresh
 * recommendation — so they are published first and tiered accordingly.
 * `NextLearningItem` carries no publish date, view count or duration; those
 * stay null rather than being invented.
 */
export function continueToVisible(item: NextLearningItem): VisibleVideo {
  return {
    id: item.videoId,
    title: item.title,
    channelId: '',
    channelTitle: item.channelTitle,
    thumbnail: item.thumbnail,
    publishedAt: 0,
    views: null,
    durationSec: null,
    relevance: 1,
    tier: 'excellent',
    topicId: null,
    topicScores: {},
    matched: [],
    difficulty: null,
    learning: 0,
    source: 'subscription',
    origin: 'continue',
  };
}

/** A library (subscription/added) video, tagged with where it came from. */
export const libraryToVisible = (video: FeedVideo): VisibleVideo => ({ ...video, origin: 'subscription' });
