import type { Channel, LearningMode, VideoRecord } from '@/types/domain';
import type { ChannelAffinity } from '@/types/preferences';
import type { Classification, Tier, VideoMetadata } from './classifier';
import { FEED_MIN_SCORE } from './classifier';
import { getClassifier } from '@/ai/registry';
import { normalizeText } from './text';
import { detectBoilerplate } from './relevance/scorer';
import { hashString, stemToken, tokenStems } from './relevance/matcher';
import { compareChannelProfiles, profileChannel, type ChannelProfile } from './relevance/channels';

/**
 * Subscription intelligence: "Among channels I already follow, what matches
 * what I'm trying to learn?" Pure functions over the locally synced library.
 *
 *   videos → channel-independent scores → channel profiles
 *          → final scores (with channel context) → threshold → rank
 */

export interface LibraryItem {
  video: VideoRecord;
  cls: Classification;
}

export interface ChannelInsight {
  channel: Channel;
  profile: ChannelProfile;
}

export interface ModeLibrary {
  /** Main feed: Relevant tier and above, best first. Never padded. */
  items: LibraryItem[];
  /** Weak matches (0.45–0.6), hidden unless the user asks. */
  weakItems: LibraryItem[];
  /** On-topic news and announcements, kept out of the learning feed. */
  newsItems: LibraryItem[];
  /** Everything at weak or above (search runs over this). */
  searchable: LibraryItem[];
  tierCounts: Record<Tier, number>;
  topicCounts: Record<string, number>;
  relevantChannelIds: string[];
  totalVideos: number;
  /** Ranked for this mode: education, then sometimes-relevant, then news, then the rest. */
  channels: ChannelInsight[];
  profiles: Record<string, ChannelProfile>;
}

const TIER_RANK: Record<Tier, number> = { excellent: 4, strong: 3, relevant: 2, weak: 1, none: 0 };
const TOPIC_MIN = 0.5;

export const inTopic = (cls: Classification, topicId: string) => (cls.topicScores[topicId] ?? 0) >= TOPIC_MIN;

const boilerplateCache = new Map<string, Set<string>>();
function channelBoilerplate(channelId: string, videos: VideoRecord[]): Set<string> {
  const key = `${channelId}|${hashString(videos.map((v) => v.id).sort().join(','))}`;
  let set = boilerplateCache.get(key);
  if (!set) {
    set = detectBoilerplate(videos.map((v) => v.description));
    if (boilerplateCache.size > 2000) boilerplateCache.clear();
    boilerplateCache.set(key, set);
  }
  return set;
}

const metaOf = (video: VideoRecord, channel: Channel): VideoMetadata => ({
  videoId: video.id,
  title: video.title,
  description: video.description,
  channelId: video.channelId,
  channelTitle: video.channelTitle,
  channelHandle: channel.handle,
});

/**
 * Relevance first (by tier, then score in 0.02 steps), then exact topic phrase,
 * educational signal, channel relevance and finally recency.
 */
export function compareItems(profiles: Record<string, ChannelProfile>) {
  return (a: LibraryItem, b: LibraryItem) =>
    TIER_RANK[b.cls.tier] - TIER_RANK[a.cls.tier] ||
    Math.round(b.cls.relevance * 50) - Math.round(a.cls.relevance * 50) ||
    b.cls.exact - a.cls.exact ||
    b.cls.learning - a.cls.learning ||
    (profiles[b.video.channelId]?.score ?? 0) - (profiles[a.video.channelId]?.score ?? 0) ||
    b.video.publishedAt - a.video.publishedAt;
}

/** `affinity`: behavioral creator preference per channel id, blended into channel scoring (docs/V5_CONTRACT.md §D). Omit for unchanged V4 behaviour. */
export function buildModeLibrary(mode: LearningMode, videos: Record<string, VideoRecord>, channels: Record<string, Channel>, affinity?: Record<string, ChannelAffinity>): ModeLibrary {
  const classifier = getClassifier();
  const byChannel = new Map<string, VideoRecord[]>();
  for (const video of Object.values(videos)) {
    const channel = channels[video.channelId];
    if (!channel || channel.ignored) continue;
    byChannel.set(video.channelId, [...(byChannel.get(video.channelId) ?? []), video]);
  }

  // Pass 1: channel-independent scores → channel profiles.
  const profiles: Record<string, ChannelProfile> = {};
  const boilerplates = new Map<string, Set<string>>();
  for (const [channelId, list] of byChannel) {
    const boilerplate = channelBoilerplate(channelId, list);
    boilerplates.set(channelId, boilerplate);
    const baseResults = list.map((v) => classifier.classify(metaOf(v, channels[channelId]), mode, { boilerplate }));
    profiles[channelId] = profileChannel(channelId, baseResults, mode, affinity?.[channelId]);
  }

  // Pass 2: final scores with channel context.
  const items: LibraryItem[] = [];
  const weakItems: LibraryItem[] = [];
  const newsItems: LibraryItem[] = [];
  const tierCounts: Record<Tier, number> = { excellent: 0, strong: 0, relevant: 0, weak: 0, none: 0 };
  let totalVideos = 0;
  for (const [channelId, list] of byChannel) {
    const profile = profiles[channelId];
    for (const video of list) {
      totalVideos++;
      const cls = classifier.classify(metaOf(video, channels[channelId]), mode, { boilerplate: boilerplates.get(channelId), channelScore: profile.score });
      if (cls.strength === 'blocked') continue;
      tierCounts[cls.tier]++;
      const item = { video, cls };
      const newsy = cls.topical >= 0.6 && (cls.categories.includes('news') || cls.categories.includes('hype') || (profile.kind === 'news' && cls.learning < 0.6));
      if (cls.relevance >= FEED_MIN_SCORE && !(newsy && cls.relevance < 0.75)) items.push(item);
      else if (newsy) newsItems.push(item);
      else if (cls.tier === 'weak') weakItems.push(item);
    }
  }

  const compare = compareItems(profiles);
  items.sort(compare);
  weakItems.sort(compare);
  newsItems.sort((a, b) => b.video.publishedAt - a.video.publishedAt);

  const topicCounts: Record<string, number> = {};
  for (const { cls } of items) for (const topic of mode.topics) if (inTopic(cls, topic.id)) topicCounts[topic.id] = (topicCounts[topic.id] ?? 0) + 1;

  const insights: ChannelInsight[] = [...byChannel.keys()]
    .map((id) => ({ channel: channels[id], profile: profiles[id] }))
    .sort((a, b) => compareChannelProfiles(a.profile, b.profile));

  return {
    items,
    weakItems,
    newsItems,
    searchable: [...items, ...weakItems, ...newsItems],
    tierCounts,
    topicCounts,
    relevantChannelIds: [...new Set(items.map((i) => i.video.channelId))],
    totalVideos,
    channels: insights,
    profiles,
  };
}

export type LibrarySort = 'best' | 'newest';

/** Topic view: only videos with real evidence for that topic, ranked by topic fit and overall relevance. */
export function filterLibrary(library: ModeLibrary, topicId: string | null, sort: LibrarySort, source: LibraryItem[] = library.items): LibraryItem[] {
  let list = source;
  if (topicId) {
    const compare = compareItems(library.profiles);
    const fit = (i: LibraryItem) => 0.6 * (i.cls.topicScores[topicId] ?? 0) + 0.4 * i.cls.relevance;
    list = source.filter((i) => inTopic(i.cls, topicId)).sort((a, b) => Math.round(fit(b) * 50) - Math.round(fit(a) * 50) || compare(a, b));
  }
  return sort === 'newest' ? [...list].sort((a, b) => b.video.publishedAt - a.video.publishedAt) : list;
}

/* ─── Search inside a mode ─────────────────────────────────────────────────── */

const SEARCH_MIN_SCORE = 0.45;
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'why', 'to', 'in', 'of', 'a', 'an', 'on', 'is', 'vs', 'video', 'videos', 'tutorial']);

export interface SearchHit extends LibraryItem {
  score: number;
  queryMatch: number;
}

/**
 * Mode-aware search over the library: text match + mode relevance + topic
 * agreement. "transformers" in AI / ML also finds attention/BERT videos,
 * because the query itself is classified into the mode's topics.
 */
export function searchLibrary(library: ModeLibrary, mode: LearningMode, query: string, limit = 24): SearchHit[] {
  const tokens = (normalizeText(query).match(/[a-z0-9+#.]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(stemToken);
  if (!tokens.length) return [];
  const queryTopic = getClassifier().classify({ videoId: 'query', title: query }, mode).topicId;
  const needed = tokens.length <= 2 ? 1 : 0.6;
  const hits: SearchHit[] = [];
  for (const item of library.searchable) {
    const stems = tokenStems(normalizeText(item.video.title));
    const queryMatch = tokens.filter((t) => stems.has(t)).length / tokens.length;
    const topicAgrees = !!queryTopic && inTopic(item.cls, queryTopic);
    if (queryMatch < needed && !topicAgrees) continue;
    const score = 0.45 * queryMatch + 0.4 * item.cls.relevance + 0.15 * (topicAgrees ? 1 : 0);
    if (score < SEARCH_MIN_SCORE) continue;
    hits.push({ ...item, score: Math.round(score * 1000) / 1000, queryMatch });
  }
  return hits.sort((a, b) => b.score - a.score || b.cls.relevance - a.cls.relevance).slice(0, limit);
}

/** YouTube search that keeps the mode: add the mode's search hint unless the query already names the mode or a topic. */
export function searchQueryWithContext(mode: LearningMode, query: string): string {
  const q = query.trim();
  const hint = (mode.searchHint || mode.name).trim();
  if (!q || !hint) return q;
  const cls = getClassifier().classify({ videoId: 'query', title: q }, mode);
  // Only an unambiguous phrase or topic name scopes a query by itself ("transformers" alone is also a film).
  const alreadyScoped = (cls.exact === 1 && cls.topical >= 0.6) || normalizeText(q).includes(normalizeText(hint));
  return alreadyScoped ? q : `${q} ${hint}`;
}

/* ─── Formatting helpers ───────────────────────────────────────────────────── */

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function compactNumber(n: number | null): string {
  if (n === null) return '';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
