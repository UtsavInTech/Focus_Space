import type { LearningMode } from '@/types/domain';
import type { NoiseCategory } from './lexicon';

export interface VideoMetadata {
  videoId: string;
  title: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  channelHandle?: string;
}

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type Tier = 'excellent' | 'strong' | 'relevant' | 'weak' | 'none';
export type MatchStrength = Tier | 'blocked';

/** One line of the "why did this score what it scored" breakdown. */
export interface SignalLine {
  kind: 'topic' | 'exact' | 'learning' | 'description' | 'channel' | 'penalty' | 'rule' | 'note';
  label: string;
  /** Contribution to the final 0–1 score (negative for penalties). */
  value: number;
}

/**
 * Channel-independent scoring result. Serialisable, so it can be cached by
 * videoId + mode fingerprint + classifier version.
 */
export interface RelevanceResult {
  /** Score before channel context and rules, 0–1. */
  base: number;
  /** Topic evidence (title, corroborated by description and search context), 0–1. */
  topical: number;
  /** 1 = exact topic name / phrase in the title, 0.5 = specific word, 0 = none. */
  exact: number;
  /** Learning (or, for media spaces, media) cue strength, 0–1. */
  learning: number;
  description: number;
  penalty: number;
  topicId: string | null;
  topicScores: Record<string, number>;
  categories: NoiseCategory[];
  matchedTerms: string[];
  blockedTerms: string[];
  difficulty: Difficulty | null;
}

export interface Classification extends RelevanceResult {
  modeId: string;
  /** Final 0–1 score including channel context. */
  relevance: number;
  tier: Tier;
  strength: MatchStrength;
  channelRule: 'allowed' | 'blocked' | null;
  channelBoost: number;
  method: 'rules' | 'ai';
  version: number;
}

export interface ClassifyContext {
  /** Channel relevance for this mode (0–1), from channel profiles. */
  channelScore?: number;
  /** Normalised description lines this channel repeats on every video. */
  boilerplate?: ReadonlySet<string>;
  /** The space's own YouTube search that surfaced this video (discovery) — counts as topic context. */
  sourceQuery?: string;
}

export interface VideoClassifier {
  readonly id: string;
  readonly version: number;
  classify(video: VideoMetadata, mode: LearningMode, context?: ClassifyContext): Classification;
  /** Same as classify, plus a human-readable signal breakdown (debug/tuning). */
  explain(video: VideoMetadata, mode: LearningMode, context?: ClassifyContext): { classification: Classification; signals: SignalLine[] };
}
