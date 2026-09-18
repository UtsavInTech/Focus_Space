import { keywordPattern, normalizeText } from '../text';

/**
 * Fast phrase matching with span bookkeeping.
 *
 * - Token prefilter: a phrase's regex only runs when its first token appears
 *   in the text, so hundreds of configured keywords stay cheap per video.
 * - Spans: every match keeps its position, so overlapping terms ("llm" inside
 *   "llms", "binary search" inside "binary search tree") count once, and a
 *   repeated phrase ("machine learning machine learning") counts once.
 */

export interface Phrase<T> {
  key: string;
  pattern: RegExp;
  data: T;
}

export interface Match<T> {
  phrase: Phrase<T>;
  start: number;
  end: number;
}

const TOKEN_RE = /[a-z0-9]+/g;

export const stemToken = (token: string) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token);

export function tokenStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const token of text.match(TOKEN_RE) ?? []) {
    stems.add(token);
    stems.add(stemToken(token));
  }
  return stems;
}

export class PhraseIndex<T> {
  private readonly byStem = new Map<string, Phrase<T>[]>();
  readonly size: number;

  constructor(entries: { term: string; data: T }[]) {
    let size = 0;
    for (const { term, data } of entries) {
      const key = normalizeText(term);
      const pattern = keywordPattern(term);
      const first = key.match(TOKEN_RE)?.[0];
      if (!pattern || !first) continue;
      const stem = stemToken(first);
      const list = this.byStem.get(stem) ?? [];
      list.push({ key, pattern, data });
      this.byStem.set(stem, list);
      size++;
    }
    this.size = size;
  }

  /** All phrases found in `text` (first occurrence of each). `text` must be normalised. */
  find(text: string, stems: Set<string>): Match<T>[] {
    const out: Match<T>[] = [];
    const seen = new Set<Phrase<T>>();
    for (const stem of stems) {
      const candidates = this.byStem.get(stem);
      if (!candidates) continue;
      for (const phrase of candidates) {
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        const m = phrase.pattern.exec(text);
        if (m) out.push({ phrase, start: m.index, end: m.index + m[0].length });
      }
    }
    return out;
  }
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Keep the longest (then highest-priority) match for every overlapping region. */
export function selectNonOverlapping<T>(matches: Match<T>[], priority: (m: Match<T>) => number = () => 0): Match<T>[] {
  const sorted = [...matches].sort((a, b) => b.end - b.start - (a.end - a.start) || priority(b) - priority(a) || a.start - b.start);
  const accepted: Match<T>[] = [];
  for (const m of sorted) if (!accepted.some((a) => overlaps(a, m))) accepted.push(m);
  return accepted.sort((a, b) => a.start - b.start);
}

/** Drop matches that sit strictly inside a longer guard phrase. */
export function removeGuarded<T>(matches: Match<T>[], guards: { start: number; end: number }[]): Match<T>[] {
  if (!guards.length) return matches;
  return matches.filter((m) => !guards.some((g) => g.start <= m.start && m.end <= g.end && g.end - g.start > m.end - m.start));
}

export function withoutOverlap<T, U>(matches: Match<T>[], blockers: Match<U>[]): Match<T>[] {
  return blockers.length ? matches.filter((m) => !blockers.some((b) => overlaps(b, m))) : matches;
}

/** Small stable hash (FNV-1a) for cache keys and fingerprints. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
