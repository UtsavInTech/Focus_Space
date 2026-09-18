/**
 * Notes / mind-map contract (V5).
 *
 * Workstream 2 generates `GeneratedNote` from a `LearningContext` (plus an
 * optional watched range) — pure content, grounded in what the learner
 * actually watched. Workstream 3 wraps it into a `SavedNote` and owns
 * persistence, listing and deletion. WS2 never writes to storage; WS3 never
 * builds prompts or calls a provider directly for notes — it calls WS2's
 * generator.
 *
 * Do not change these shapes without updating docs/V5_CONTRACT.md.
 */

import type { KnowledgeSource } from '@/learning/knowledge/types';

export const NOTES_VERSION = 1;

export type NoteLanguage = 'en' | 'hi' | 'hinglish';
export type NoteFormat = 'notes' | 'mindmap';

/** What span of the video a note was generated for — see docs/V5_CONTRACT.md §E. */
export type NoteScopeKind = 'current-section' | 'range' | 'watched-so-far' | 'full-video' | 'revision';

/** The watched span notes were generated for. Whole-video when range is null. */
export interface NoteRange {
  startSec: number;
  endSec: number;
}

export interface MindMapNode {
  title: string;
  children: MindMapNode[];
}

/**
 * Provenance a viewer (or WS3's saved-notes UI) can use to place a note
 * without re-deriving it: what it's about, and what it's actually grounded
 * in. `sources` lists which Knowledge Map evidence kinds
 * (src/learning/knowledge/types.ts KnowledgeSource) backed content inside the
 * generated range — course/playlist/chapter metadata is context for this,
 * never the content itself (docs/V5_CONTRACT.md §E).
 */
export interface NoteProvenance {
  videoTitle: string;
  channel: string;
  playlist: { id: string | null; title: string; position: number | null; total: number } | null;
  topic: string | null;
  scope: NoteScopeKind;
  sources: KnowledgeSource[];
  hasTranscript: boolean;
  generatedAt: number;
}

/** WS2's output: pure content, no id or persistence metadata. */
export interface GeneratedNote {
  format: NoteFormat;
  language: NoteLanguage;
  videoId: string;
  range: NoteRange | null;
  /** Markdown for 'notes'; null for 'mindmap'. Technical terms (e.g. "linked list", "isolation level") are kept in their original form even when the surrounding prose is Hindi. */
  markdown: string | null;
  mindmap: MindMapNode | null;
  /** KnowledgeNode ids (src/learning/knowledge/types.ts) this note draws on, for grounding/traceability back to the map. */
  conceptIds: string[];
  /** LearningContext.version this was built from (src/learning/context/context.ts). */
  contextVersion: number;
  provenance: NoteProvenance;
}

/** WS3's persisted wrapper — one row in the notes store. */
export interface SavedNote extends GeneratedNote {
  id: string;
  createdAt: number;
  updatedAt: number;
}
