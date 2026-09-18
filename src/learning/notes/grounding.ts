import type { NoteRange } from '@/types/notes';
import { conceptStops } from '../knowledge/locate';
import type { KnowledgeMap, KnowledgeSource } from '../knowledge/types';
import type { TranscriptWindow } from '../context/context';

/**
 * What evidence actually backs a range, before any prompt is built or any
 * provider is called. Reuses `conceptStops` (the same flattened, confidence-
 * filtered walk `context.ts`/playback use) instead of a second map walker.
 *
 * Knowledge Map structure (chapter/description/comment-derived titles) is
 * context for organising a note — `outline` — never the note's content.
 * Content comes from `transcriptWindow`'s text, or, when there is none, is
 * refused rather than invented (see `hasEvidence`).
 */
export interface Grounding {
  conceptIds: string[];
  conceptTitles: string[];
  sources: KnowledgeSource[];
  mentions: string[];
  hasTranscript: boolean;
  hasStructure: boolean;
  /** False when there is nothing at all to ground a note in — the caller must not generate one. */
  hasEvidence: boolean;
  /** Indented concept titles in the range, for the prompt's orientation — not the note content. */
  outline: string;
}

const overlaps = (node: { startSec: number; endSec: number | null }, range: NoteRange) => node.startSec < range.endSec && (node.endSec ?? Infinity) > range.startSec;

export function groundingFor(map: KnowledgeMap | null, range: NoteRange | null, transcriptWindow: TranscriptWindow | null): Grounding {
  const stops = map && range ? conceptStops(map).filter((s) => overlaps(s.node, range)) : [];
  const conceptIds = stops.map((s) => s.node.id);
  const conceptTitles = stops.map((s) => s.node.title);
  const sources = [...new Set(stops.map((s) => s.node.source))];
  const mentions = map?.mentions ?? [];
  const hasTranscript = !!transcriptWindow?.text;
  const hasStructure = stops.length > 0;
  const outline = stops.map((s) => `${'  '.repeat(s.ancestors.length)}- ${s.node.title}`).join('\n');
  return { conceptIds, conceptTitles, sources, mentions, hasTranscript, hasStructure, hasEvidence: hasTranscript || hasStructure || mentions.length > 0, outline };
}
