import type { LearningMode, Topic } from '@/types/domain';
import type { ChannelAffinity } from '@/types/preferences';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { getClassifier } from '@/ai/registry';
import { FEED_MIN_SCORE, TIER_LABEL, type Classification, type Tier } from './classifier';
import { inTopic } from './library';
import { normalizeText } from './text';

/**
 * YouTube discovery: videos from all of YouTube (search results for the
 * space's intent, and YouTube's own recommendations) passed through the same
 * relevance engine as the user's library. Nothing is shown just because
 * YouTube suggested it.
 */

export interface DiscoveryCandidate {
  video: YtVideo;
  query: string | null;
  /** True when the query was generated from the space itself (counts as topic context). */
  fromSpaceQuery: boolean;
  /** The topic the query was built for, if any. */
  topicId: string | null;
}

export interface DiscoveredVideo {
  video: YtVideo;
  cls: Classification;
  topicId: string | null;
  reasons: string[];
}

const TIER_RANK: Record<Tier, number> = { excellent: 4, strong: 3, relevant: 2, weak: 1, none: 0 };
const MIN_DURATION_SEC = 90;

const unique = (list: string[]) => [...new Set(list.map((q) => q.trim()).filter(Boolean))];

/** Searches that express the space (or one topic of it) on YouTube. */
export function discoveryQueriesFor(mode: LearningMode, topic?: Topic | null): string[] {
  const hint = (mode.searchHint || mode.name).trim();
  const scoped = (text: string) => (normalizeText(text).includes(normalizeText(hint)) || normalizeText(hint).includes(normalizeText(text)) ? text : `${text} ${hint}`);
  if (topic) return unique([scoped(topic.name), mode.kind === 'learning' ? `${topic.name} explained` : topic.name]);
  return unique([
    mode.kind === 'learning' ? `${hint} tutorial` : hint,
    ...mode.topics.slice(0, 8).map((t) => scoped(t.name)),
    mode.kind === 'learning' ? `${hint} full course` : `best ${hint}`,
  ]);
}

/**
 * Discovery never trusts YouTube's reasons for showing a video, only the video's own words.
 *
 * - A recommendation (YouTube's home feed for this account) must name the subject in its title. Those
 *   follow the account's whole history, so someone who once watched SSC prep gets it everywhere.
 * - A result of the Space's own search must, in a learning Space, still say something about the
 *   subject in its title or description: the search alone is context, not evidence. Media Spaces keep
 *   trusting their search, since song titles rarely name the genre (docs/RELEVANCE.md, "Search context").
 * - Nothing off-domain (relevance/domains.ts) is ever discovered, even with a little evidence.
 */
export function hasOwnEvidence(cls: Classification, mode: LearningMode, fromSpaceQuery: boolean): boolean {
  if (cls.offDomain) return false;
  if (!fromSpaceQuery) return cls.exact > 0;
  if ((mode.kind ?? 'learning') !== 'learning') return true;
  return cls.exact > 0 || cls.description > 0;
}

/**
 * `affinity`: behavioral creator preference (docs/V5_CONTRACT.md §D), keyed
 * by channel id. This is the actual mechanism for unsubscribed-creator
 * preference: a channel found only here (not in the subscribed library) has
 * no rule-based channel profile at all, so its videos previously never got a
 * channel boost. A repeatedly-watched-but-unsubscribed creator now can.
 */
export function rankDiscovery(
  mode: LearningMode,
  candidates: DiscoveryCandidate[],
  exclude: { videoIds: ReadonlySet<string>; channelIds: ReadonlySet<string> },
  topicId: string | null = null,
  affinity?: Record<string, ChannelAffinity>,
): DiscoveredVideo[] {
  const classifier = getClassifier();
  const seen = new Set<string>();
  const out: DiscoveredVideo[] = [];
  const topicName = (id: string | null) => mode.topics.find((t) => t.id === id)?.name ?? null;

  for (const { video, query, fromSpaceQuery, topicId: queryTopic } of candidates) {
    if (seen.has(video.id)) continue;
    seen.add(video.id);
    if (video.isShort || video.isLive || exclude.videoIds.has(video.id)) continue;
    if (video.channelId && exclude.channelIds.has(video.channelId)) continue;
    if (video.durationSec !== null && video.durationSec < MIN_DURATION_SEC) continue;
    if ((video.watchedPercent ?? 0) >= 90) continue;

    const cls = classifier.classify(
      { videoId: video.id, title: video.title, description: video.description, channelId: video.channelId ?? undefined, channelTitle: video.channelTitle, channelHandle: video.channelHandle ?? undefined },
      mode,
      { sourceQuery: fromSpaceQuery && query ? query : undefined, channelScore: video.channelId ? affinity?.[video.channelId]?.score : undefined },
    );
    if (cls.strength === 'blocked' || cls.relevance < FEED_MIN_SCORE) continue;
    if (!hasOwnEvidence(cls, mode, fromSpaceQuery)) continue;

    // A topic view keeps videos with evidence for that topic, or found by that topic's own search.
    const assigned = cls.topicId ?? queryTopic;
    if (topicId && !inTopic(cls, topicId) && !(queryTopic === topicId && !cls.topicId)) continue;

    const scope = topicName(topicId ?? assigned) ?? mode.name;
    const reasons = [`${TIER_LABEL[cls.tier]} for ${scope}`];
    if (mode.kind === 'learning' && cls.learning >= 0.6) reasons.push('Teaches the topic');
    reasons.push('Not from your subscriptions');
    out.push({ video, cls, topicId: topicId ?? assigned, reasons });
  }

  const quality = (v: YtVideo) => Math.log10((v.views ?? 0) + 10);
  return out.sort(
    (a, b) =>
      TIER_RANK[b.cls.tier] - TIER_RANK[a.cls.tier] ||
      Math.round(b.cls.relevance * 50) - Math.round(a.cls.relevance * 50) ||
      b.cls.learning - a.cls.learning ||
      quality(b.video) - quality(a.video) ||
      (b.video.publishedAt ?? 0) - (a.video.publishedAt ?? 0),
  );
}
