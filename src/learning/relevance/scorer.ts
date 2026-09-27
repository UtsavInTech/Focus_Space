import type { ChannelRef, LearningMode, SpaceKind } from '@/types/domain';
import { keywordPattern, normalizeText } from '../text';
import {
  AMBIGUITY_GUARDS,
  BROAD_TERMS,
  BROAD_TOKENS,
  CLASSIFIER_VERSION,
  DESCRIPTION_NOISE,
  LEARNING_PATTERNS,
  LEARNING_SIGNALS,
  LEARNING_WEIGHT,
  MEDIA_EXEMPT_NOISE,
  MEDIA_SIGNALS,
  NOISE_PATTERNS,
  NOISE_SIGNALS,
  SOFTENABLE_NOISE,
  type LearningStrength,
  type NoiseCategory,
} from './lexicon';
import { PhraseIndex, hashString, removeGuarded, selectNonOverlapping, stemToken, tokenStems, withoutOverlap, type Match } from './matcher';
import type { Classification, ClassifyContext, Difficulty, RelevanceResult, SignalLine, Tier, VideoMetadata } from './types';

/*
 * ─── Scoring model (all components 0–1) ──────────────────────────────────────
 *
 *   T  title topic evidence   noisy-OR of distinct, non-overlapping term matches,
 *                             weighted by specificity (phrase 0.9, specific word
 *                             0.6–0.75, acronym 0.7, broad 0.25). Broad-only → capped 0.3.
 *   D  description evidence   specific terms only, after removing links, promo lines
 *                             and the channel's boilerplate.
 *   TE topical = 1 − (1 − T)(1 − 0.55·D)(1 − Q)
 *   E  exact topic phrase     1 phrase / topic name, 0.5 specific word
 *   Q  search context         found by the space's own YouTube search (discovery):
 *                             learning 0.35 · general 0.55 · media 0.75
 *   L  learning signal        tutorial, lecture, explained… (media spaces: official video, album…)
 *                             (only counts with topic evidence)
 *   P  noise penalties        per category, capped; softened for clearly educational titles
 *
 *   base  = 0.62·TE + 0.10·E + 0.28·L·min(1, TE/0.6) − P
 *   final = base + 0.10·channelScore (when TE ≥ 0.3); rules (allowed/blocked) last.
 *
 *   So a topic phrase alone is "Relevant"; it takes a learning signal too to be Strong/Excellent.
 */

export const WEIGHTS = { topical: 0.62, exact: 0.1, learning: 0.28, descriptionShare: 0.55, channel: 0.1, learningGate: 0.6 } as const;

export const TIER_THRESHOLDS: [Exclude<Tier, 'none'>, number][] = [
  ['excellent', 0.9],
  ['strong', 0.75],
  ['relevant', 0.6],
  ['weak', 0.45],
];
/** The main feed shows this tier and above. */
export const FEED_MIN_SCORE = 0.6;

export const TIER_LABEL: Record<Tier, string> = {
  excellent: 'Excellent match',
  strong: 'Strong match',
  relevant: 'Relevant',
  weak: 'Weak match',
  none: 'Not relevant',
};

export function tierOf(score: number): Tier {
  for (const [tier, min] of TIER_THRESHOLDS) if (score >= min) return tier;
  return 'none';
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round = (v: number) => Math.round(v * 1000) / 1000;
const noisyOr = (weights: number[]) => 1 - weights.reduce((p, w) => p * (1 - clamp01(w)), 1);

/* ─── Term specificity ─────────────────────────────────────────────────────── */

export type TermKind = 'phrase' | 'word' | 'acronym' | 'broad';

interface TopicTerm {
  term: string;
  topicId: string | null;
  isName: boolean;
  kind: TermKind;
  weight: number;
}

export function termSpecificity(term: string, isName = false): { kind: TermKind; weight: number } {
  const key = normalizeText(term);
  if (BROAD_TERMS.has(key)) return { kind: 'broad', weight: 0.25 };
  const tokens = key.split(/[\s-]+/).filter(Boolean);
  if (tokens.length > 1) {
    return tokens.every((t) => BROAD_TOKENS.has(t)) ? { kind: 'broad', weight: 0.45 } : { kind: 'phrase', weight: isName ? 0.95 : 0.9 };
  }
  const bare = stemToken(key).replace(/[^a-z0-9]/g, '');
  if (bare.length <= 3) return { kind: 'acronym', weight: isName ? 0.8 : 0.7 };
  const weight = key.length >= 7 ? 0.75 : 0.6;
  return { kind: 'word', weight: isName ? Math.max(weight, 0.8) : weight };
}

/* ─── Compiled lexicons ────────────────────────────────────────────────────── */

const LEARNING_INDEX = new PhraseIndex<LearningStrength>(
  (Object.entries(LEARNING_SIGNALS) as [LearningStrength, string[]][]).flatMap(([strength, terms]) => terms.map((term) => ({ term, data: strength }))),
);
const MEDIA_INDEX = new PhraseIndex<LearningStrength>(
  (Object.entries(MEDIA_SIGNALS) as [LearningStrength, string[]][]).flatMap(([strength, terms]) => terms.map((term) => ({ term, data: strength }))),
);
const NOISE_INDEX = new PhraseIndex<NoiseCategory>(
  (Object.entries(NOISE_SIGNALS) as [NoiseCategory, { terms: string[] }][]).flatMap(([category, { terms }]) => terms.map((term) => ({ term, data: category }))),
);
const GUARD_INDEX = new PhraseIndex<null>(AMBIGUITY_GUARDS.map((term) => ({ term, data: null })));

const DIFFICULTY_TERMS: Record<Difficulty, string[]> = {
  beginner: ['beginner', 'beginners', 'basics', 'introduction', 'intro to', 'crash course', 'from scratch', 'getting started', 'fundamentals', '101', 'for dummies'],
  intermediate: ['intermediate', 'medium level'],
  advanced: ['advanced', 'expert', 'deep dive', 'internals', 'hard problems', 'masterclass'],
};
const DIFFICULTY_PATTERNS = (Object.entries(DIFFICULTY_TERMS) as [Difficulty, string[]][]).map(([level, terms]) => ({
  level,
  patterns: terms.map(keywordPattern).filter((p): p is RegExp => !!p),
}));

interface CompiledMode {
  fingerprint: string;
  terms: PhraseIndex<TopicTerm>;
  blocked: PhraseIndex<string>;
  /** Normalised mode configuration text: noise phrases the mode itself asks for are not penalised. */
  configText: string;
}

const compiledModes = new Map<string, CompiledMode>();

/** Changes whenever anything that affects channel-independent scoring changes. */
export function modeFingerprint(mode: LearningMode): string {
  return hashString(
    JSON.stringify([CLASSIFIER_VERSION, mode.id, mode.kind, mode.name, mode.keywords, mode.blockedKeywords, mode.topics.map((t) => [t.id, t.name, t.keywords])]),
  );
}

export function compileMode(mode: LearningMode): CompiledMode {
  const fingerprint = modeFingerprint(mode);
  const cached = compiledModes.get(mode.id);
  if (cached?.fingerprint === fingerprint) return cached;

  const entries: { term: string; data: TopicTerm }[] = [];
  const add = (raw: string, topicId: string | null, isName: boolean) => {
    // "~keyword" marks a supporting signal: it helps, but never qualifies a video alone.
    const supporting = !isName && raw.trim().startsWith('~');
    const term = raw.replace(/^\s*~\s*/, '');
    if (!normalizeText(term)) return;
    const specificity = supporting ? { kind: 'broad' as const, weight: 0.35 } : termSpecificity(term, isName);
    entries.push({ term, data: { term, topicId, isName, ...specificity } });
  };
  add(mode.name, null, true);
  mode.keywords.forEach((k) => add(k, null, false));
  for (const topic of mode.topics) {
    add(topic.name, topic.id, true);
    topic.keywords.forEach((k) => add(k, topic.id, false));
  }
  const compiled: CompiledMode = {
    fingerprint,
    terms: new PhraseIndex(entries),
    blocked: new PhraseIndex(mode.blockedKeywords.map((term) => ({ term, data: term }))),
    configText: normalizeText([mode.name, ...mode.keywords, ...mode.topics.flatMap((t) => [t.name, ...t.keywords])].join(' | ').replace(/~/g, ' ')),
  };
  compiledModes.set(mode.id, compiled);
  return compiled;
}

/* ─── Description hygiene ──────────────────────────────────────────────────── */

export const normalizeLine = (line: string) => normalizeText(line).replace(/\d+/g, '#');

const splitLines = (description: string) =>
  description
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((l) => l.trim())
    .filter(Boolean);

/** Lines a channel repeats across many uploads (about text, links, course plugs). */
export function detectBoilerplate(descriptions: string[]): Set<string> {
  const usable = descriptions.filter(Boolean);
  if (usable.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const description of usable) {
    for (const line of new Set(splitLines(description).map(normalizeLine))) {
      if (line.length >= 12) counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const min = Math.max(2, Math.ceil(usable.length * 0.4));
  return new Set([...counts].filter(([, n]) => n >= min).map(([line]) => line));
}

export function cleanDescription(description: string, boilerplate?: ReadonlySet<string>): string {
  return splitLines(description.slice(0, 1500))
    .filter((line) => !DESCRIPTION_NOISE.test(line) && !boilerplate?.has(normalizeLine(line)))
    .join(' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .slice(0, 400);
}

/* ─── Scoring ──────────────────────────────────────────────────────────────── */

function topicMatches(text: string, compiled: CompiledMode): Match<TopicTerm>[] {
  const stems = tokenStems(text);
  const guards = GUARD_INDEX.find(text, stems);
  const candidates = removeGuarded(compiled.terms.find(text, stems), guards);
  return selectNonOverlapping(candidates, (m) => (m.phrase.data.topicId ? 2 : 0) + (m.phrase.data.isName ? 1 : 0) + m.phrase.data.weight);
}

const exactness = (m: Match<TopicTerm>) => {
  const { kind, isName } = m.phrase.data;
  if (kind === 'broad') return 0;
  if (kind === 'phrase' || isName) return 1;
  return 0.5;
};

export const QUERY_EVIDENCE: Record<SpaceKind, number> = { learning: 0.35, general: 0.55, media: 0.75 };

export interface ScoreOptions {
  boilerplate?: ReadonlySet<string>;
  /** The space's own search query that surfaced the video. */
  sourceQuery?: string;
  explain?: boolean;
}

/** Channel-independent score for one video in one mode. */
export function scoreVideo(video: VideoMetadata, mode: LearningMode, options: ScoreOptions = {}): { result: RelevanceResult; signals: SignalLine[] } {
  const { boilerplate, sourceQuery, explain = false } = options;
  const kind: SpaceKind = mode.kind ?? 'learning';
  const compiled = compileMode(mode);
  const signals: SignalLine[] = [];
  const topicName = (id: string | null) => mode.topics.find((t) => t.id === id)?.name;

  // Title topic evidence
  const title = normalizeText(video.title ?? '');
  const titleStems = tokenStems(title);
  const titleMatches = topicMatches(title, compiled);
  const specific = titleMatches.filter((m) => m.phrase.data.kind !== 'broad');
  let T = noisyOr(titleMatches.map((m) => m.phrase.data.weight));
  if (titleMatches.length && !specific.length) T = Math.min(T, 0.3);
  const E = Math.max(0, ...titleMatches.map(exactness));

  // Description evidence (specific terms only, cleaned)
  const description = normalizeText(cleanDescription(video.description ?? '', boilerplate));
  const descMatches = description ? topicMatches(description, compiled).filter((m) => m.phrase.data.kind !== 'broad') : [];
  const D = noisyOr(descMatches.map((m) => m.phrase.data.weight * 0.6));
  const Q = sourceQuery ? QUERY_EVIDENCE[kind] : 0;
  const TE = 1 - (1 - T) * (1 - WEIGHTS.descriptionShare * D) * (1 - Q);

  // Topic assignment: title evidence first, description corroborates at half weight.
  const perTopic = new Map<string, number[]>();
  for (const m of titleMatches) if (m.phrase.data.topicId) perTopic.set(m.phrase.data.topicId, [...(perTopic.get(m.phrase.data.topicId) ?? []), m.phrase.data.kind === 'broad' ? 0.2 : m.phrase.data.weight]);
  for (const m of descMatches) if (m.phrase.data.topicId) perTopic.set(m.phrase.data.topicId, [...(perTopic.get(m.phrase.data.topicId) ?? []), m.phrase.data.weight * 0.4]);
  const topicScores: Record<string, number> = {};
  let topicId: string | null = null;
  for (const [id, ws] of perTopic) {
    topicScores[id] = round(noisyOr(ws));
    if (topicScores[id] >= 0.5 && (!topicId || topicScores[id] > topicScores[topicId])) topicId = id;
  }

  // Learning signal (never from words that are themselves topic terms)
  const cueIndex = kind === 'media' ? MEDIA_INDEX : LEARNING_INDEX;
  const learningMatches = selectNonOverlapping(withoutOverlap(removeGuarded(cueIndex.find(title, titleStems), GUARD_INDEX.find(title, titleStems)), titleMatches));
  const learningWeights = learningMatches.map((m) => LEARNING_WEIGHT[m.phrase.data]);
  const learningLabels = learningMatches.map((m) => m.phrase.key);
  for (const { label, pattern, strength } of kind === 'media' ? [] : LEARNING_PATTERNS) {
    if (pattern.test(title) && !learningLabels.includes(label)) {
      learningWeights.push(LEARNING_WEIGHT[strength]);
      learningLabels.push(label);
    }
  }
  const L = noisyOr(learningWeights);
  const gate = Math.min(1, TE / WEIGHTS.learningGate);

  // Noise penalties (disabled for words the mode itself asks for, e.g. a "news" mode)
  const isWanted = (key: string) => !!keywordPattern(key)?.test(compiled.configText);
  const noiseMatches = withoutOverlap(removeGuarded(NOISE_INDEX.find(title, titleStems), GUARD_INDEX.find(title, titleStems)), titleMatches).filter((m) => !isWanted(m.phrase.key) && !(kind === 'media' && MEDIA_EXEMPT_NOISE.has(m.phrase.data)));
  const categoryHits = new Map<NoiseCategory, string>();
  for (const m of noiseMatches) if (!categoryHits.has(m.phrase.data)) categoryHits.set(m.phrase.data, m.phrase.key);
  for (const { label, pattern, category } of NOISE_PATTERNS) if (!categoryHits.has(category) && pattern.test(title)) categoryHits.set(category, label);
  // Only a strongly educational, on-topic title softens podcast/news/story penalties.
  const softened = TE >= 0.7 && L >= 0.9;
  const penaltyOf = (c: NoiseCategory) => NOISE_SIGNALS[c].penalty * (softened && SOFTENABLE_NOISE.has(c) ? 0.4 : 1);
  const P = Math.min(0.45, [...categoryHits.keys()].reduce((sum, c) => sum + penaltyOf(c), 0));

  const base = clamp01(WEIGHTS.topical * TE + WEIGHTS.exact * E + WEIGHTS.learning * L * gate - P);

  const blockedTerms = compiled.blocked.find(title, titleStems).map((m) => m.phrase.data);
  const difficulty = DIFFICULTY_PATTERNS.find(({ patterns }) => patterns.some((p) => p.test(title)))?.level ?? null;

  if (explain) {
    for (const m of titleMatches) {
      const d = m.phrase.data;
      signals.push({ kind: 'topic', label: `title: “${d.term}”, ${d.kind === 'broad' && d.weight === 0.35 ? 'supporting' : d.kind}${d.topicId ? ` · ${topicName(d.topicId)}` : ' · mode signal'}`, value: round(d.weight) });
    }
    if (Q) signals.push({ kind: 'topic', label: `found by this space's YouTube search “${sourceQuery}”`, value: Q });
    if (titleMatches.length && !specific.length) signals.push({ kind: 'note', label: 'only broad terms in title → topic evidence capped at 0.3', value: 0 });
    for (const m of descMatches) signals.push({ kind: 'description', label: `description: “${m.phrase.data.term}”`, value: round(m.phrase.data.weight * 0.6) });
    signals.push({ kind: 'topic', label: `topic evidence ${round(TE)} × ${WEIGHTS.topical}`, value: round(WEIGHTS.topical * TE) });
    if (E) signals.push({ kind: 'exact', label: E === 1 ? 'exact topic phrase in title' : 'specific topic word in title', value: round(WEIGHTS.exact * E) });
    if (learningLabels.length) signals.push({ kind: 'learning', label: `${kind === 'media' ? 'media cue' : 'learning'}: ${learningLabels.join(', ')}${gate < 1 ? ` (weakened: little topic evidence)` : ''}`, value: round(WEIGHTS.learning * L * gate) });
    else signals.push({ kind: 'note', label: 'no educational signal in title', value: 0 });
    for (const [category, hit] of categoryHits) signals.push({ kind: 'penalty', label: `${category}: “${hit}”${penaltyOf(category) < NOISE_SIGNALS[category].penalty ? ' (softened: clearly educational)' : ''}`, value: -round(penaltyOf(category)) });
  }

  return {
    result: {
      base: round(base),
      topical: round(TE),
      exact: E,
      learning: round(L),
      description: round(D),
      penalty: round(P),
      topicId,
      topicScores,
      categories: [...categoryHits.keys()],
      matchedTerms: [...new Set([...titleMatches, ...descMatches].map((m) => m.phrase.data.term))],
      blockedTerms,
      difficulty,
    },
    signals,
  };
}

/* ─── Channel context & rules ──────────────────────────────────────────────── */

const channelMatches = (refs: ChannelRef[], video: VideoMetadata) =>
  refs.some(
    (ref) =>
      (!!ref.id && ref.id === video.channelId) ||
      (!!ref.handle && !!video.channelHandle && ref.handle.toLowerCase() === video.channelHandle.toLowerCase()) ||
      (!video.channelId && !ref.handle && !!video.channelTitle && ref.title.toLowerCase() === video.channelTitle.toLowerCase()),
  );

export function finalizeClassification(result: RelevanceResult, video: VideoMetadata, mode: LearningMode, context: ClassifyContext = {}): { classification: Classification; signals: SignalLine[] } {
  const signals: SignalLine[] = [];
  const channelRule = channelMatches(mode.blockedChannels, video) ? 'blocked' : channelMatches(mode.allowedChannels, video) ? 'allowed' : null;
  const channelBoost = result.topical >= 0.3 && context.channelScore ? round(WEIGHTS.channel * clamp01(context.channelScore)) : 0;
  let relevance = clamp01(result.base + channelBoost);
  if (channelBoost) signals.push({ kind: 'channel', label: `channel relevance ${round(context.channelScore ?? 0)}`, value: channelBoost });

  let strength: Classification['strength'];
  if (channelRule === 'blocked' || (result.blockedTerms.length > 0 && channelRule !== 'allowed')) {
    relevance = 0;
    strength = 'blocked';
    signals.push({ kind: 'rule', label: channelRule === 'blocked' ? 'channel blocked in this mode' : `blocked keyword: ${result.blockedTerms.join(', ')}`, value: 0 });
  } else {
    if (channelRule === 'allowed' && relevance < 0.62) {
      signals.push({ kind: 'rule', label: 'channel always allowed in this mode', value: round(0.62 - relevance) });
      relevance = 0.62;
    }
    strength = tierOf(relevance);
  }
  relevance = round(relevance);
  return {
    classification: {
      ...result,
      modeId: mode.id,
      relevance,
      tier: strength === 'blocked' ? 'none' : strength,
      strength,
      channelRule,
      channelBoost,
      method: 'rules',
      version: CLASSIFIER_VERSION,
    },
    signals,
  };
}
