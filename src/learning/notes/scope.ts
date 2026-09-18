import type { NoteRange, NoteScopeKind } from '@/types/notes';
import { conceptStops, locateConcept } from '../knowledge/locate';
import type { KnowledgeMap } from '../knowledge/types';

/**
 * What part of the video a note is for. Resolving it to a concrete
 * `NoteRange` reuses the existing Knowledge Map lookup (`conceptStops` /
 * `locateConcept`, the same functions `context.ts` uses for the current
 * concept) rather than a second way of walking the map.
 */
export type NoteScope =
  | { kind: 'current-section' }
  | { kind: 'range'; range: NoteRange }
  | { kind: 'watched-so-far' }
  | { kind: 'full-video' }
  /** Condensed recap notes (docs/V5_CONTRACT.md §E) — defaults to watched-so-far when no range is given. */
  | { kind: 'revision'; range?: NoteRange };

export interface ResolvedScope {
  kind: NoteScopeKind;
  range: NoteRange | null;
}

/**
 * `durationSec` unknown + 'full-video' falls back to watched-so-far (0 →
 * currentTime): a note can't ground content that hasn't played yet.
 */
export function resolveScope(scope: NoteScope, map: KnowledgeMap | null, currentTime: number, durationSec: number | null): ResolvedScope {
  switch (scope.kind) {
    case 'range':
      return { kind: 'range', range: clampRange(scope.range, durationSec) };
    case 'watched-so-far':
      return { kind: 'watched-so-far', range: { startSec: 0, endSec: Math.max(0, currentTime) } };
    case 'full-video':
      return durationSec != null
        ? { kind: 'full-video', range: { startSec: 0, endSec: durationSec } }
        : { kind: 'full-video', range: { startSec: 0, endSec: Math.max(0, currentTime) } };
    case 'revision':
      return { kind: 'revision', range: scope.range ? clampRange(scope.range, durationSec) : { startSec: 0, endSec: Math.max(0, currentTime) } };
    case 'current-section': {
      if (!map) return { kind: 'current-section', range: null };
      const position = locateConcept(conceptStops(map), currentTime);
      if (!position.current) return { kind: 'current-section', range: null };
      const endSec = position.current.endSec ?? durationSec ?? Math.max(currentTime, position.current.startSec);
      return { kind: 'current-section', range: { startSec: position.current.startSec, endSec } };
    }
  }
}

function clampRange(range: NoteRange, durationSec: number | null): NoteRange {
  const endSec = durationSec != null ? Math.min(range.endSec, durationSec) : range.endSec;
  const startSec = Math.max(0, Math.min(range.startSec, endSec));
  return { startSec, endSec: Math.max(startSec, endSec) };
}
