import type { LearningMode } from '@/types/domain';
import type { ChannelAffinity } from '@/types/preferences';
import { FEED_MIN_SCORE } from './scorer';
import type { Classification } from './types';

/**
 * Channel relevance for a mode, derived from the videos we know about —
 * never from the channel's name.
 *
 *   Channel → recent videos → share relevant, mean relevance, educational
 *   consistency, topic coverage, topical share → score (0–1) + kind
 *
 * Kinds are mode-relative presentation hints, not permanent labels: the same
 * channel can be "educational" for AI / ML and "general" for DSA.
 */

export type ChannelKind = 'educational' | 'adjacent' | 'news' | 'occasional' | 'general' | 'entertainment' | 'unknown';
export type ChannelTier = 'excellent' | 'strong' | 'relevant' | 'low';

export interface ChannelProfile {
  channelId: string;
  total: number;
  relevant: number;
  strong: number;
  relevantShare: number;
  meanRelevance: number;
  educationalShare: number;
  topicalShare: number;
  newsShare: number;
  entertainmentShare: number;
  coverage: number;
  topics: string[];
  score: number;
  kind: ChannelKind;
  tier: ChannelTier;
}

export const CHANNEL_WEIGHTS = { relevantShare: 0.4, meanRelevance: 0.2, educationalShare: 0.15, coverage: 0.1, topicalShare: 0.15 } as const;

export const CHANNEL_TIER_LABEL: Record<ChannelTier, string> = {
  excellent: 'Excellent match',
  strong: 'Strong match',
  relevant: 'Relevant',
  low: 'Rarely relevant',
};

const round = (v: number) => Math.round(v * 1000) / 1000;
const share = (n: number, d: number) => (d > 0 ? n / d : 0);

/**
 * `results` must be channel-independent (no channel boost), or the score
 * would feed on itself.
 *
 * `affinity` blends in behavioral preference (docs/V5_CONTRACT.md §D):
 * `score = max(rule-based score, behavioral affinity)`. It only ever raises
 * the score — a channel with no or weak affinity keeps exactly its
 * rule-based score, so existing subscription relevance never regresses.
 * `kind` (educational/adjacent/news/…) stays purely content-based; affinity
 * never recategorises a channel, only re-ranks within/across categories via
 * `score`.
 */
export function profileChannel(channelId: string, results: Classification[], mode: LearningMode, affinity?: ChannelAffinity): ChannelProfile {
  const scored = results.filter((r) => r.strength !== 'blocked');
  const total = results.length;
  const relevantResults = scored.filter((r) => r.base >= FEED_MIN_SCORE);
  const strong = scored.filter((r) => r.base >= 0.75).length;
  const topical = scored.filter((r) => r.topical >= 0.6);
  const somewhatTopical = scored.filter((r) => r.topical >= 0.3);
  const newsLike = somewhatTopical.filter((r) => r.categories.includes('news') || r.categories.includes('hype'));
  const entertainment = scored.filter((r) => r.categories.some((c) => c === 'entertainment' || c === 'lifestyle' || c === 'story'));
  const topics = [...new Set(relevantResults.map((r) => r.topicId).filter((t): t is string => !!t))];

  const relevantShare = share(relevantResults.length, total);
  const meanRelevance = share(scored.reduce((sum, r) => sum + r.base, 0), total);
  // Any teaching cue counts for consistency (numbered lecture series rarely say "tutorial").
  const educationalShare = share(topical.filter((r) => r.learning >= 0.3).length, total);
  const topicalShare = share(topical.length, total);
  const newsShare = share(newsLike.length, somewhatTopical.length);
  const entertainmentShare = share(entertainment.length, total);
  const coverage = share(topics.length, Math.max(1, Math.min(5, mode.topics.length)));

  // Small samples are less trustworthy (feeds carry ~15 uploads).
  const confidence = 0.6 + 0.4 * Math.min(1, total / 10);
  const ruleScore =
    confidence *
    (CHANNEL_WEIGHTS.relevantShare * relevantShare +
      CHANNEL_WEIGHTS.meanRelevance * meanRelevance +
      CHANNEL_WEIGHTS.educationalShare * educationalShare +
      CHANNEL_WEIGHTS.coverage * Math.min(1, coverage) +
      CHANNEL_WEIGHTS.topicalShare * topicalShare);
  // Behavioral affinity only ever raises the score (see docstring above).
  const score = Math.max(ruleScore, affinity?.score ?? 0);

  let kind: ChannelKind;
  if (total < 3) kind = 'unknown';
  else if (relevantShare >= 0.3 && educationalShare >= 0.15) kind = 'educational';
  else if (topicalShare >= 0.25 && newsShare >= 0.3) kind = 'news';
  else if (relevantShare >= 0.15 || (relevantResults.length > 0 && topicalShare >= 0.25)) kind = 'adjacent';
  else if (relevantResults.length > 0 || topicalShare >= 0.1) kind = 'occasional';
  else if (entertainmentShare >= 0.3) kind = 'entertainment';
  else kind = 'general';

  const tier: ChannelTier = score >= 0.55 ? 'excellent' : score >= 0.4 ? 'strong' : score >= 0.2 ? 'relevant' : 'low';

  return {
    channelId,
    total,
    relevant: relevantResults.length,
    strong,
    relevantShare: round(relevantShare),
    meanRelevance: round(meanRelevance),
    educationalShare: round(educationalShare),
    topicalShare: round(topicalShare),
    newsShare: round(newsShare),
    entertainmentShare: round(entertainmentShare),
    coverage: round(Math.min(1, coverage)),
    topics,
    score: round(score),
    kind,
    tier,
  };
}

const KIND_ORDER: Record<ChannelKind, number> = { educational: 0, adjacent: 1, news: 2, occasional: 3, general: 4, unknown: 5, entertainment: 6 };

/**
 * Learning modes rank education above topical relevance above news:
 * channels that teach → channels that often cover the topic → news →
 * channels that occasionally do → everything else. Within a group, by score.
 */
export function compareChannelProfiles(a: ChannelProfile, b: ChannelProfile): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.score - a.score || b.relevant - a.relevant;
}

export const channelKindLabel = (kind: ChannelKind, modeName: string): string =>
  ({
    educational: `${modeName} education`,
    news: `${modeName} news`,
    adjacent: `Often covers ${modeName}`,
    occasional: `Occasionally covers ${modeName}`,
    general: 'General',
    entertainment: 'Entertainment',
    unknown: 'Not enough videos yet',
  })[kind];
