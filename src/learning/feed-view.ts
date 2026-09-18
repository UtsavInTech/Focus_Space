import type { Channel, LearningMode, VideoRecord } from '@/types/domain';
import type { ChannelAffinity } from '@/types/preferences';
import { getClassifier } from '@/ai/registry';
import { fingerprintOf, type Difficulty, type Tier } from './classifier';
import { buildModeLibrary, inTopic, type LibraryItem } from './library';
import type { ChannelKind } from './relevance/channels';
import { CLASSIFIER_VERSION } from './relevance/lexicon';
import { stemToken, tokenStems } from './relevance/matcher';
import { normalizeText } from './text';

/**
 * A compact, ready-to-render feed for one space, computed in the background
 * from the full library. YouTube pages read this (tens of KB) instead of
 * loading and classifying the whole library (MBs) on every page load.
 */

export interface FeedVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: number;
  views: number | null;
  durationSec: number | null;
  relevance: number;
  tier: Tier;
  topicId: string | null;
  topicScores: Record<string, number>;
  matched: string[];
  difficulty: Difficulty | null;
  learning: number;
  source: 'subscription' | 'added';
}

export interface FeedChannel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  score: number;
  kind: ChannelKind;
  relevant: number;
  total: number;
  source: 'subscription' | 'added';
}

export interface FeedView {
  modeId: string;
  fingerprint: string;
  computedAt: number;
  items: FeedVideo[];
  news: FeedVideo[];
  weakCount: number;
  topicCounts: Record<string, number>;
  channels: FeedChannel[];
  totalVideos: number;
  channelCount: number;
}

export interface FeedViewStore {
  version: number;
  /** Every channel in the library — discovery never repeats these. */
  channelIds: string[];
  modes: Record<string, FeedView>;
}

export const FEED_VIEW_LIMIT = 160;

const r2 = (v: number) => Math.round(v * 100) / 100;

function toFeedVideo({ video, cls }: LibraryItem, channels: Record<string, Channel>): FeedVideo {
  return {
    id: video.id,
    title: video.title,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    thumbnail: video.thumbnail,
    publishedAt: video.publishedAt,
    views: video.views,
    durationSec: video.durationSec ?? null,
    relevance: cls.relevance,
    tier: cls.tier,
    topicId: cls.topicId,
    topicScores: Object.fromEntries(Object.entries(cls.topicScores).filter(([, s]) => s >= 0.3).map(([k, s]) => [k, r2(s)])),
    matched: cls.matchedTerms.slice(0, 4),
    difficulty: cls.difficulty,
    learning: r2(cls.learning),
    source: channels[video.channelId]?.source === 'manual' ? 'added' : 'subscription',
  };
}

export function buildFeedView(mode: LearningMode, videos: Record<string, VideoRecord>, channels: Record<string, Channel>, affinity?: Record<string, ChannelAffinity>, now = Date.now()): FeedView {
  const lib = buildModeLibrary(mode, videos, channels, affinity);
  return {
    modeId: mode.id,
    fingerprint: fingerprintOf(mode),
    computedAt: now,
    items: lib.items.slice(0, FEED_VIEW_LIMIT).map((i) => toFeedVideo(i, channels)),
    news: lib.newsItems.slice(0, 6).map((i) => toFeedVideo(i, channels)),
    weakCount: lib.weakItems.length,
    topicCounts: lib.topicCounts,
    channels: lib.channels.slice(0, 30).map(({ channel, profile }) => ({
      id: channel.id,
      title: channel.title,
      handle: channel.handle ?? null,
      thumbnail: channel.thumbnail ?? null,
      score: profile.score,
      kind: profile.kind,
      relevant: profile.relevant,
      total: profile.total,
      source: channel.source === 'manual' ? 'added' : 'subscription',
    })),
    totalVideos: lib.totalVideos,
    channelCount: Object.keys(channels).length,
  };
}

export const emptyFeedStore = (): FeedViewStore => ({ version: CLASSIFIER_VERSION, channelIds: [], modes: {} });

/** Videos with real evidence for a topic, best fit first. */
export function topicItems(view: FeedView, topicId: string): FeedVideo[] {
  const fit = (v: FeedVideo) => 0.6 * (v.topicScores[topicId] ?? 0) + 0.4 * v.relevance;
  return view.items.filter((v) => (v.topicScores[topicId] ?? 0) >= 0.5).sort((a, b) => fit(b) - fit(a));
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'to', 'in', 'of', 'a', 'an', 'on', 'is', 'vs', 'video', 'videos', 'tutorial']);

/** Mode-aware search over a feed view: text match + relevance + topic agreement. */
export function searchFeedView(view: FeedView, mode: LearningMode, query: string, limit = 8): FeedVideo[] {
  const tokens = (normalizeText(query).match(/[a-z0-9+#.]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(stemToken);
  if (!tokens.length) return [];
  const queryCls = getClassifier().classify({ videoId: `query:${query}`, title: query }, mode);
  const needed = tokens.length <= 2 ? 1 : 0.6;
  return view.items
    .map((v) => {
      const stems = tokenStems(normalizeText(v.title));
      const match = tokens.filter((t) => stems.has(t)).length / tokens.length;
      const agrees = !!queryCls.topicId && (v.topicScores[queryCls.topicId] ?? 0) >= 0.5;
      return { v, match, agrees, score: 0.45 * match + 0.4 * v.relevance + 0.15 * (agrees ? 1 : 0) };
    })
    .filter((x) => (x.match >= needed || x.agrees) && x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.v);
}

export { inTopic };
