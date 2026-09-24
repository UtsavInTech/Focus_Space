import type { LearningMode } from '@/types/domain';
import type { YtChannel } from '@/integrations/youtube/innertube-parse';
import { keywordPattern, normalizeText } from '../text';
import { BROAD_TERMS, BROAD_TOKENS, LEARNING_SIGNALS } from './lexicon';

/**
 * Ranking for YouTube's channel search.
 *
 * YouTube's channel filter returns results ordered largely by *name* match, which is why searching
 * "Data Structures and Algorithms" hands back three channels literally called "Data Structures and
 * Algorithms" with 8, 13 and 6 subscribers before any of the people who actually teach the subject.
 * A name is the weakest possible evidence: it is the one thing anyone can set to anything.
 *
 * So relevance here is evidence-based — does the *description* corroborate the name, does the channel
 * read as someone who teaches, does it match the Space the learner is building — and audience size is a
 * multiplier on that evidence rather than a sort key of its own. A 5k-subscriber channel whose whole
 * description is about the subject still outranks a 2M-subscriber channel that merely mentions it, and
 * nothing is ever removed for being small: channels with no supporting evidence at all are pushed to
 * the end of the list, not out of it.
 *
 * What is *not* available here, and would make this better: YouTube's channel search returns no video
 * list, no upload recency and no per-video relevance, so "how many of this creator's videos are
 * actually about the topic" cannot be checked at search time. Every signal below is one this response
 * genuinely carries (see __fixtures__/innertube/channels.json). Once a channel is added to a Space its
 * uploads *are* fetched and scored per video (learning/relevance/channels.ts), which is the deeper
 * check this one can only approximate.
 */

export interface RankedChannel {
  channel: YtChannel;
  /** Roughly 0–1.2. Only meaningful relative to the other results of the same search. */
  score: number;
  /** Evidence the name match is corroborated by something. Drives ordering more than anything else. */
  relevance: number;
  /**
   * No evidence beyond the name: tiny or hidden audience, nothing in the description, no badge, not
   * already known to the learner. Kept, but always below every channel that has some.
   */
  lowSignal: boolean;
  /** Short, user-facing phrases explaining why this channel is being suggested. */
  reasons: string[];
}

export interface RankChannelsOptions {
  /** What was searched for — the Space's name/hint for suggestions, or what the learner typed. */
  query: string;
  /** The Space being built, when there is one: its keywords and topics are stronger evidence than the query alone. */
  mode?: Pick<LearningMode, 'name' | 'keywords' | 'topics' | 'searchHint'> | null;
  /** Channels already in the learner's library or Spaces — a creator they have already chosen once. */
  knownIds?: ReadonlySet<string>;
}

/** Below this, a subscriber count is not evidence of anything on its own. */
const SMALL_AUDIENCE = 1000;
/** A name match is capped here, so "named after the subject" can never on its own look like a strong result. */
const TITLE_WEIGHT = 0.45;
/** The description is the corroboration a name cannot give, so it is worth more. */
const DESCRIPTION_WEIGHT = 0.55;
/** A description this short ("", "Hi", "welcome") carries no information. */
const MIN_DESCRIPTION = 24;

interface Term {
  pattern: RegExp;
  weight: number;
  /** The words as typed, for the "why" line. */
  label: string;
}

const STOPWORDS = new Set(['the', 'and', 'for', 'of', 'with', 'your', 'a', 'an', 'to', 'in', 'on', 'how', 'learn', 'tutorial', 'tutorials', 'course', 'courses']);

const isBroad = (term: string) => {
  const t = normalizeText(term);
  if (BROAD_TERMS.has(t)) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => BROAD_TOKENS.has(token) || STOPWORDS.has(token));
};

function term(text: string, weight: number, seen: Set<string>): Term | null {
  const key = normalizeText(text);
  if (!key || key.length < 3 || seen.has(key)) return null;
  const pattern = keywordPattern(text);
  if (!pattern) return null;
  seen.add(key);
  return { pattern, weight, label: key };
}

/**
 * Evidence terms, strongest first: the whole query, then the Space's own keywords and topics, then the
 * query's individual words. A "~keyword" is a supporting signal in mode configuration and stays one here.
 */
function buildTerms(options: RankChannelsOptions): Term[] {
  const seen = new Set<string>();
  const terms: Term[] = [];
  const add = (text: string, weight: number) => {
    const t = term(text, weight, seen);
    if (t) terms.push(t);
  };

  const query = normalizeText(options.query);
  if (query.includes(' ')) add(query, 1);

  const mode = options.mode;
  if (mode) {
    add(mode.name, isBroad(mode.name) ? 0.35 : 0.7);
    if (mode.searchHint) add(mode.searchHint, 0.8);
    for (const keyword of mode.keywords) {
      const supporting = keyword.startsWith('~');
      const text = supporting ? keyword.slice(1) : keyword;
      add(text, supporting ? 0.3 : isBroad(text) ? 0.25 : text.includes(' ') ? 0.8 : 0.5);
    }
    for (const topic of mode.topics) {
      add(topic.name, isBroad(topic.name) ? 0.2 : 0.45);
      for (const keyword of topic.keywords) {
        const supporting = keyword.startsWith('~');
        const text = supporting ? keyword.slice(1) : keyword;
        add(text, supporting ? 0.2 : 0.35);
      }
    }
  }

  for (const word of query.split(/\s+/)) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    add(word, isBroad(word) ? 0.15 : 0.4);
  }

  return terms;
}

const TEACHING_CUES = [...LEARNING_SIGNALS.strong, ...LEARNING_SIGNALS.medium]
  .map((signal) => keywordPattern(signal))
  .filter((p): p is RegExp => p !== null);

/**
 * 0–1 from the subscriber count, on a log scale: 1k → 0.5, 10k → 0.67, 100k → 0.83, 1M+ → 1. A hidden
 * count is treated as mid-range rather than as zero — plenty of real teachers hide theirs.
 */
export function audienceWeight(subscribers: number | null): number {
  if (subscribers === null) return 0.5;
  if (subscribers <= 1) return 0;
  return Math.min(1, Math.log10(subscribers) / 6);
}

export function formatSubscribers(subscribers: number | null): string | null {
  if (subscribers === null) return null;
  if (subscribers >= 1_000_000) return `${(subscribers / 1_000_000).toFixed(subscribers >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M subscribers`;
  if (subscribers >= 1000) return `${(subscribers / 1000).toFixed(subscribers >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K subscribers`;
  return `${subscribers} subscriber${subscribers === 1 ? '' : 's'}`;
}

/**
 * True when the channel's name is essentially the search phrase and nothing more — "Data Structures and
 * Algorithms" for that query. On its own this is not a problem (a real educator may well be named after
 * their subject); combined with no description and no audience it is the signature of a channel that
 * ranks only because of its name.
 */
function nameIsQueryEcho(title: string, query: string): boolean {
  const t = normalizeText(title).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const q = normalizeText(query).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || !q || !t.includes(q)) return false;
  const rest = t.replace(q, ' ').split(/\s+/).filter(Boolean);
  return rest.every((word) => STOPWORDS.has(word) || word.length <= 2);
}

function scoreOne(channel: YtChannel, terms: Term[], options: RankChannelsOptions): RankedChannel {
  const title = normalizeText(channel.title);
  const description = normalizeText(channel.description);
  const hasDescription = channel.description.trim().length >= MIN_DESCRIPTION;

  let titleEvidence = 0;
  let descriptionEvidence = 0;
  const matched: string[] = [];
  for (const t of terms) {
    const inTitle = t.pattern.test(title);
    const inDescription = description ? t.pattern.test(description) : false;
    if (!inTitle && !inDescription) continue;
    if (inTitle) titleEvidence += t.weight;
    // A description match is the corroboration a title alone cannot provide, but it is a snippet, so it
    // is worth less per term than the name itself.
    if (inDescription) descriptionEvidence += t.weight * 0.6;
    if (matched.length < 3) matched.push(t.label);
  }

  /*
   * Each side saturates on its own before they are combined, which is what makes a name *alone* weak: a
   * channel whose only evidence is its title tops out at TITLE_WEIGHT no matter how exactly the name
   * matches, while a description that talks about the subject can carry a channel whose name says
   * nothing. Matching on both at once is the strongest case there is, so it earns a little extra.
   */
  const titleScore = Math.min(1, titleEvidence);
  const descriptionScore = Math.min(1, descriptionEvidence);
  const onTopic = titleScore > 0 || descriptionScore > 0;

  /*
   * TEACHING_CUES are subject-agnostic ("tutorial", "course", "explained"), so on their own they say
   * nothing about *this* search — a coding bootcamp's blurb is full of them in a cooking search. They
   * only count once something has already tied the channel to the topic, which is why this is gated on
   * `onTopic`: teaching is corroboration, never evidence.
   */
  const teaching = onTopic && description ? TEACHING_CUES.some((p) => p.test(description)) : false;
  const relevance = Math.min(
    1,
    TITLE_WEIGHT * titleScore + DESCRIPTION_WEIGHT * descriptionScore + (titleScore > 0 && descriptionScore > 0 ? 0.1 : 0) + (teaching ? 0.1 : 0),
  );

  const known = options.knownIds?.has(channel.id) === true || channel.subscribed;
  const audience = audienceWeight(channel.subscribers);
  const tiny = channel.subscribers !== null && channel.subscribers < SMALL_AUDIENCE;
  const echo = nameIsQueryEcho(channel.title, options.query);

  /*
   * Nothing but a matching name: no blurb, no badge, never chosen before, and an audience that is either
   * confirmed tiny or not reported at all. Both belong here — neither is evidence — but they are not the
   * same claim, and `audienceWeight` deliberately does not treat a hidden count as a small one, so the
   * reason shown to the learner must not either.
   */
  const lowSignal = !known && !channel.verified && !hasDescription && (tiny || channel.subscribers === null);

  /*
   * Audience never sorts on its own — it scales the evidence. The floor means a small channel with real
   * evidence still scores roughly two thirds of what an identical million-subscriber one would, so it
   * stays visible; the range means that between two equally relevant channels, the established one wins.
   */
  let score = relevance * (0.35 + 0.65 * audience);
  // A creator the learner already chose is the strongest evidence there is that they want them.
  if (known) score += 0.15;
  if (channel.verified) score += 0.05;
  if (!hasDescription) score -= 0.05;
  // The specific trap this ranking exists for: the name is the query, and nothing else backs it up.
  if (echo && lowSignal) score -= 0.25;

  const reasons: string[] = [];
  if (known) reasons.push(channel.subscribed ? 'You’re subscribed' : 'Already in your Spaces');
  if (matched.length) reasons.push(`Matches ${matched.map((m) => `“${m}”`).join(', ')}`);
  if (teaching) reasons.push('Describes itself as teaching this');
  const subs = formatSubscribers(channel.subscribers);
  if (subs) reasons.push(subs);
  if (channel.verified) reasons.push('Verified');
  if (lowSignal) reasons.push(tiny ? 'Very small channel — little to go on' : 'Nothing here but the name');
  // Every row explains itself, so a channel FocusSpace can say nothing about still says that much,
  // rather than rendering a blank line under its name.
  if (!reasons.length) reasons.push('From YouTube’s results for your search');

  return { channel, score: Math.max(0, score), relevance, lowSignal, reasons };
}

/**
 * Near-duplicate names ("Data Structures and Algorithms", "Data Structures & Algorithms") are almost
 * always the same low-effort channel repeated. The best-scoring one stands for the group.
 */
const dedupeKey = (title: string) => normalizeText(title).replace(/[^a-z0-9]+/g, '');

/**
 * Ranks channel-search results by evidence, then by audience — never by audience alone, and never by
 * name alone. Results with no supporting evidence keep their place at the end of the list rather than
 * being dropped, so a genuinely new creator the learner searched for by name is still reachable.
 */
export function rankChannels(channels: readonly YtChannel[], options: RankChannelsOptions): RankedChannel[] {
  const terms = buildTerms(options);
  const scored = channels.map((channel) => scoreOne(channel, terms, options));

  const best = new Map<string, RankedChannel>();
  for (const entry of scored) {
    const key = dedupeKey(entry.channel.title);
    const existing = best.get(key);
    const better = !existing || entry.score > existing.score || (entry.score === existing.score && (entry.channel.subscribers ?? 0) > (existing.channel.subscribers ?? 0));
    if (better) best.set(key, entry);
  }

  return [...best.values()].sort(
    (a, b) =>
      Number(a.lowSignal) - Number(b.lowSignal) ||
      b.score - a.score ||
      (b.channel.subscribers ?? 0) - (a.channel.subscribers ?? 0) ||
      a.channel.title.localeCompare(b.channel.title),
  );
}
