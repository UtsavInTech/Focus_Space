import type { NoteLanguage } from '@/types/notes';
import type { PageType } from '@/integrations/youtube/urls';
import type { FeedChannel, FeedVideo } from '../feed-view';
import { relativeTime } from '../library';

/**
 * What the AI can see when the learner is NOT on a specific video — the
 * homepage, search, or another browse page. This is a deliberately small,
 * structured summary, not a DOM dump: it reuses FocusSpace's own already-
 * computed, already-tested feed data (`learning/feed-view.ts`), the exact
 * same ranked videos and channel profiles the rail/SpaceHome already show —
 * never a fresh scrape of arbitrary page text, and never invented content.
 *
 * A separate shape from `LearningContext` (context/context.ts) on purpose:
 * the two are never confused. See `isHomepageContext` below and
 * docs/V5_CONTRACT.md-style separation — video pages keep the untouched
 * point-in-time pipeline; every other page gets this.
 */

export interface HomepageVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSec: number | null;
  views: number | null;
  publishedText: string | null;
  position: number;
  /** Why FocusSpace surfaced it — never a claim about the video's content, only its match reason. */
  reason: string;
}

/**
 * Where a video on the page came from. The AI needs this to answer "what
 * should I watch next" usefully — "from your subscriptions" and "found on
 * YouTube" are different recommendations, and "you are part-way through this"
 * outranks both.
 */
export type HomepageOrigin = 'subscription' | 'discovery' | 'continue';

export interface HomepageSubscription {
  channelId: string;
  channelTitle: string;
}

export interface HomepageContext {
  pageType: PageType;
  spaceName: string;
  activeCategory: string | null;
  categoryChips: string[];
  visibleVideos: HomepageVideo[];
  visibleSubscriptions: HomepageSubscription[];
  language: NoteLanguage;
}

/** Structural check — HomepageContext and LearningContext share no field names, so this is unambiguous. */
export function isHomepageContext(context: unknown): context is HomepageContext {
  return !!context && typeof context === 'object' && 'visibleVideos' in context && 'pageType' in context;
}

const MAX_VIDEOS = 12;
const MAX_SUBSCRIPTIONS = 10;

export interface BuildHomepageContextInputs {
  pageType: PageType;
  spaceName: string;
  activeCategory: string | null;
  /** Native YouTube chip labels, when they could be read — merged with the space's own topics, deduplicated. */
  nativeCategoryChips?: string[];
  topicNames: string[];
  /**
   * The videos actually on the page, in the order they are shown — the
   * composed feed (subscriptions + discovery) plus Continue watching, not
   * just the subscription half. Published by the home view as it renders
   * (content/data/visible-feed.ts) rather than re-derived here, so what the
   * AI sees and what the learner sees cannot drift apart.
   */
  feedVideos: (FeedVideo & { origin?: HomepageOrigin })[];
  /** Channel profiles from the same feed view, filtered to subscriptions by the caller-supplied predicate. */
  subscriptions: Pick<FeedChannel, 'id' | 'title'>[];
  language: NoteLanguage;
  now?: number;
}

const TIER_WORDS: Record<FeedVideo['tier'], string> = { excellent: 'Excellent match', strong: 'Strong match', relevant: 'Relevant', weak: 'Weak match', none: '' };
const ORIGIN_WORDS: Record<HomepageOrigin, string> = { subscription: 'from a channel you follow', discovery: 'found on YouTube', continue: 'you are part-way through this' };

/** Why this video is on the page — its match quality and where it came from. Never a claim about its content. */
function reasonFor(video: FeedVideo & { origin?: HomepageOrigin }): string {
  const tier = TIER_WORDS[video.tier];
  // No origin means an older caller that only ever passed library videos; keep its wording untouched.
  if (!video.origin) return tier || 'In your feed';
  const origin = ORIGIN_WORDS[video.origin];
  return tier ? `${tier} · ${origin}` : origin;
}

export function buildHomepageContext(inputs: BuildHomepageContextInputs): HomepageContext {
  const now = inputs.now ?? Date.now();
  const categoryChips = [...new Set([...inputs.topicNames, ...(inputs.nativeCategoryChips ?? [])])].filter(Boolean);

  const visibleVideos: HomepageVideo[] = inputs.feedVideos.slice(0, MAX_VIDEOS).map((v, i) => ({
    videoId: v.id,
    title: v.title,
    channelTitle: v.channelTitle,
    durationSec: v.durationSec,
    views: v.views,
    publishedText: relativeTime(v.publishedAt, now),
    position: i + 1,
    reason: reasonFor(v),
  }));

  const visibleSubscriptions: HomepageSubscription[] = inputs.subscriptions.slice(0, MAX_SUBSCRIPTIONS).map((c) => ({ channelId: c.id, channelTitle: c.title }));

  return {
    pageType: inputs.pageType,
    spaceName: inputs.spaceName,
    activeCategory: inputs.activeCategory,
    categoryChips,
    visibleVideos,
    visibleSubscriptions,
    language: inputs.language,
  };
}
