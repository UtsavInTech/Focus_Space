import { MIN_VISIBLE_CONFIDENCE, type KnowledgeMap, type KnowledgeNode } from './types';

/**
 * Maps a playback time to the concept being taught — locally, with a binary
 * search over a precomputed list. Called on every `timeupdate`; costs
 * microseconds and never touches the network.
 */

export interface ConceptStop {
  node: KnowledgeNode;
  /** Outermost first, excluding the node itself. */
  ancestors: KnowledgeNode[];
}

export interface ConceptPosition {
  /** Deepest concept containing the time; null before the first one starts. */
  current: KnowledgeNode | null;
  ancestors: KnowledgeNode[];
  /** Most recent last. */
  previous: KnowledgeNode[];
  upcoming: KnowledgeNode[];
  /** Seconds into the current concept. */
  offsetSec: number;
}

/** Visible concepts in playback order (a parent comes before its first child). */
export function conceptStops(map: KnowledgeMap, minConfidence = MIN_VISIBLE_CONFIDENCE): ConceptStop[] {
  const out: ConceptStop[] = [];
  const visit = (nodes: KnowledgeNode[], ancestors: KnowledgeNode[]) => {
    for (const node of nodes) {
      if (node.confidence < minConfidence) continue;
      out.push({ node, ancestors });
      visit(node.children, [...ancestors, node]);
    }
  };
  visit(map.nodes, []);
  return out.sort((a, b) => a.node.startSec - b.node.startSec || a.ancestors.length - b.ancestors.length);
}

export function locateConcept(stops: ConceptStop[], timeSec: number, around = 3): ConceptPosition {
  let lo = 0;
  let hi = stops.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (stops[mid].node.startSec <= timeSec) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found === -1) return { current: null, ancestors: [], previous: [], upcoming: stops.slice(0, around).map((s) => s.node), offsetSec: 0 };

  const stop = stops[found];
  const lineage = new Set(stop.ancestors.map((a) => a.id));
  const previous = stops
    .slice(0, found)
    .filter((s) => !lineage.has(s.node.id))
    .slice(-around)
    .map((s) => s.node);
  const upcoming = stops.slice(found + 1, found + 1 + around).map((s) => s.node);
  return { current: stop.node, ancestors: stop.ancestors, previous, upcoming, offsetSec: Math.max(0, timeSec - stop.node.startSec) };
}
