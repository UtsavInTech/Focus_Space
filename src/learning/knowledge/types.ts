/**
 * Video Knowledge Map — what a video teaches and when.
 *
 * Built locally from evidence of different quality (official chapters,
 * description timestamps, the transcript, viewer comments). Every node keeps
 * its evidence and an internal confidence; the UI never shows the number, only
 * where an outline came from ("From chapters", "From viewer comments").
 *
 * Nothing here knows YouTube's response formats — see
 * src/integrations/youtube/knowledge-parse.ts for extraction.
 */

/** Bump when extraction, fusion or segmentation rules change: cached maps rebuild. */
export const KNOWLEDGE_VERSION = 2;

export type KnowledgeSource = 'chapters' | 'auto-chapters' | 'description' | 'transcript' | 'comments' | 'ai';

/** Base confidence per source (before agreement bonuses/conflict penalties). */
export const SOURCE_CONFIDENCE: Record<KnowledgeSource, number> = {
  chapters: 0.98,
  'auto-chapters': 0.9,
  description: 0.9,
  transcript: 0.9,
  comments: 0.62,
  ai: 0.5,
};

/** Nodes below this aren't shown to learners (still kept for debugging). */
export const MIN_VISIBLE_CONFIDENCE = 0.5;

export interface ChapterInput {
  title: string;
  startSec: number;
  /** YouTube's auto-generated chapters rather than the creator's. */
  auto: boolean;
}

export interface CommentInput {
  id: string;
  text: string;
  likes: number;
  isCreator: boolean;
  /** 0 = top-level comment. */
  replyLevel: number;
}

export interface TranscriptSegment {
  startSec: number;
  durSec: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  languageCode: string;
  /** Auto-generated speech recognition vs. uploaded captions. */
  kind: 'asr' | 'manual';
  segments: TranscriptSegment[];
}

/** One proposed outline item from a single source. */
export interface OutlineCandidate {
  title: string;
  /** null = the concept is mentioned but not placed in time. */
  startSec: number | null;
  source: KnowledgeSource;
  confidence: number;
  /** 0 = top level; 1+ = nested (indentation, "3.1", "a)"). */
  depth: number;
  /** Title of the group heading this candidate sits under in its source. */
  parent?: string;
  /** Independent supporters (e.g. agreeing comments). */
  support: number;
  note?: string;
}

export interface KnowledgeEvidence {
  source: KnowledgeSource;
  startSec: number | null;
  confidence: number;
  support: number;
  note?: string;
}

export interface KnowledgeNode {
  id: string;
  title: string;
  startSec: number;
  /** Exclusive; the next node's start or the video's end. null when unknown. */
  endSec: number | null;
  confidence: number;
  /** Strongest source behind this node. */
  source: KnowledgeSource;
  evidence: KnowledgeEvidence[];
  children: KnowledgeNode[];
}

export interface KnowledgeMap {
  videoId: string;
  version: number;
  durationSec: number | null;
  /** Top-level concepts in time order. */
  nodes: KnowledgeNode[];
  /** Concepts the video is said to cover, without a place in time. */
  mentions: string[];
  /** The source that shaped the outline, or null when nothing usable was found. */
  backbone: KnowledgeSource | null;
  /** How many candidates each source contributed. */
  sources: Partial<Record<KnowledgeSource, number>>;
  /** Hash of the inputs; a different signature means the map is stale. */
  signature: string;
  builtAt: number;
}
