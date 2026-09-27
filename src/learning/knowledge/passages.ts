import { normalizeText } from '../text';
import { isStopWord, stem, words } from './text';
import type { TranscriptSegment } from './types';

/**
 * Finding what the instructor said *elsewhere* in the current video, for chat.
 *
 * The moment window (context.ts transcriptWindow) only covers the last minute or two, and the outline
 * (learning/outline) only names topics — so "what did he say about collisions?" asked an hour after
 * the collisions part had no evidence to answer from. This searches the full transcript, locally, and
 * hands the chat prompt a few short passages with their times. The transcript never leaves the
 * browser; only what is picked here does.
 *
 * Plain lexical search (BM25 over stemmed words, a bonus for exact phrases and for the matching outline
 * section): no embeddings, no server, no dependency. It runs only when a chat question is sent — never
 * on playback — and the index is built once per transcript and held in memory.
 */

/** One stretch of speech, cut on segment boundaries. `from`/`to` index the transcript's segments (`to` exclusive). */
export interface TranscriptPassage {
  startSec: number;
  endSec: number;
  text: string;
  from: number;
  to: number;
}

/** What reaches the prompt: a short excerpt and exactly when it is said. */
export interface RelatedPassage {
  startSec: number;
  endSec: number;
  text: string;
}

/** A timed heading to rank by: an outline section or a Knowledge Map node. */
export interface PassageSection {
  startSec: number;
  endSec: number | null;
  title: string;
}

/** A passage closes after at least MIN_SEC at a sentence end or past TARGET_CHARS, and always by MAX_SEC or MAX_CHARS. */
const MIN_SEC = 45;
const MAX_SEC = 60;
const TARGET_CHARS = 500;
const MAX_CHARS = 800;

/** What goes into one chat prompt: at most three excerpts, ~1,800 characters in all. */
export const MAX_RELATED_PASSAGES = 3;
export const MAX_RELATED_CHARS = 1800;
const EXCERPT_CHARS = Math.floor(MAX_RELATED_CHARS / MAX_RELATED_PASSAGES);

/**
 * text.ts's stem() is deliberately tiny and not plural-stable: "collisions" → "collision" but
 * "collision" → "collis", so a plural question missed a singular transcript. Search singularises
 * first, then stems, so both forms land on the same term.
 */
function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ss|sh|ch|x|s)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

const term = (w: string) => stem(singular(w));

/** The comparable terms of a text: conceptTokens' rules, with stop words checked before singularising ("does" is not "doe"). */
function tokens(text: string): string[] {
  return words(text)
    .filter((w) => !isStopWord(w) && (w.length > 1 || /\d/.test(w)))
    .map(term);
}

/**
 * Words that say how a question is asked, not what it is about. The shared STOP list in text.ts
 * already drops "what", "how", "is", "the"; these are the rest of a chat question's scaffolding.
 * Everything else is weighed by how rare it is in this video (IDF), so no list needs to be complete.
 */
const QUESTION_FILLER = new Set(
  (
    'explain explained explaining say said saying tell told talk talked talking mention mentioned discuss discussed show showed shown teach taught ' +
    'teacher sir instructor speaker guy man woman lecture video part section point thing things stuff ' +
    'earlier later before after again once first last previous next ago still ' +
    'difference different between compare comparison meaning mean means work works working happen happens ' +
    'not no yes please thanks thank hi hello hey ok okay bye good morning evening ' +
    'give example examples some any all more most much many very really just also even ' +
    'there here then than so if but because should would could have has had been being get got'
  )
    .split(' ')
    .map(term),
);

/** BM25's usual constants: term-frequency saturation and length normalisation. */
const K1 = 1.2;
const B = 0.75;
/** Half the question's weight must be found in a passage (or an exact phrase), or it is not evidence. */
const MIN_COVERAGE = 0.5;
/** A passage scoring below this share of the best one is noise next to it. */
const RELATIVE_FLOOR = 0.35;
/** A passage more than half inside the moment window is already in the prompt. */
const MAX_WINDOW_OVERLAP = 0.5;
/** Nearness to the playhead only settles near-ties; it never outweighs relevance. */
const NEARNESS_WEIGHT = 0.03;
/** How much a passage inside the section the question names gains. */
const SECTION_WEIGHT = 0.6;
const PHRASE_WEIGHT = 0.6;
/**
 * Picks this far apart come first: "where did he explain binary search?" on a 5-hour course is taught
 * in several places, and three excerpts from one ten-minute stretch hid the others. Closer picks only
 * fill slots nothing farther away could.
 */
const SPREAD_SEC = 300;

const SENTENCE_END = /[.?!।]["')\]]?\s*$/;

/** Cuts the transcript into ~45–60 second passages on segment boundaries, preferring sentence ends. */
export function buildPassages(segments: TranscriptSegment[]): TranscriptPassage[] {
  const passages: TranscriptPassage[] = [];
  let from = 0;
  let chars = 0;
  const close = (to: number) => {
    const first = segments[from];
    const last = segments[to - 1];
    const text = segments
      .slice(from, to)
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(' ');
    if (text) passages.push({ startSec: first.startSec, endSec: Math.max(last.startSec + last.durSec, first.startSec), text, from, to });
    from = to;
    chars = 0;
  };
  for (let i = 0; i < segments.length; i++) {
    chars += segments[i].text.length + 1;
    const span = segments[i].startSec + segments[i].durSec - segments[from].startSec;
    const next = segments[i + 1];
    const nextSpan = next ? next.startSec + next.durSec - segments[from].startSec : 0;
    const settled = span >= MIN_SEC && (SENTENCE_END.test(segments[i].text) || chars >= TARGET_CHARS);
    // Close before the next segment would carry the passage past its hard limits.
    if (settled || nextSpan > MAX_SEC || chars >= MAX_CHARS) close(i + 1);
  }
  if (from < segments.length) close(segments.length);
  return passages;
}

/** The words a passage or question is matched on: the shared concept tokens, minus question scaffolding. */
function searchTokens(text: string): string[] {
  return tokens(text).filter((t) => !QUESTION_FILLER.has(t));
}

interface PassageIndex {
  passages: TranscriptPassage[];
  /** Term frequencies per passage. */
  tf: Map<string, number>[];
  /** Each passage's tokens in order, space-joined and padded, for exact phrase checks. */
  sequence: string[];
  lengths: number[];
  avgLength: number;
  df: Map<string, number>;
}

/**
 * One index per transcript array, for as long as the page holds that array — the watch page keeps
 * the same segments for a video, so the first question builds it and every later one reuses it.
 */
const indexes = new WeakMap<TranscriptSegment[], PassageIndex>();

function indexFor(segments: TranscriptSegment[]): PassageIndex {
  const cached = indexes.get(segments);
  if (cached) return cached;
  const passages = buildPassages(segments);
  const tf: Map<string, number>[] = [];
  const sequence: string[] = [];
  const lengths: number[] = [];
  const df = new Map<string, number>();
  for (const p of passages) {
    const terms = tokens(p.text);
    const counts = new Map<string, number>();
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(counts);
    sequence.push(` ${terms.join(' ')} `);
    lengths.push(terms.length);
  }
  const avgLength = lengths.reduce((n, l) => n + l, 0) / Math.max(1, lengths.length);
  const index = { passages, tf, sequence, lengths, avgLength, df };
  indexes.set(segments, index);
  return index;
}

/** Consecutive content words of the question ("binary search", "time complexity"), as stemmed pairs. */
function questionPhrases(question: string): string[] {
  const phrases: string[] = [];
  let run: string[] = [];
  const flush = () => {
    for (let i = 0; i + 1 < run.length; i++) phrases.push(`${run[i]} ${run[i + 1]}`);
    run = [];
  };
  for (const w of words(question)) {
    // Any filler or stop word breaks a phrase: "insert in a list" is not the phrase "insert list".
    const [t] = searchTokens(w);
    if (t) run.push(t);
    else flush();
  }
  flush();
  return [...new Set(phrases)];
}

/** How strongly the question names this heading: the share of the heading's words it contains. */
function sectionMatch(questionTerms: Set<string>, title: string): number {
  const terms = new Set(searchTokens(title));
  if (!terms.size) return 0;
  let shared = 0;
  for (const t of terms) if (questionTerms.has(t)) shared++;
  const share = shared / terms.size;
  return share >= 0.5 ? share : 0;
}

/** The part of a long passage around its best-matching segment, cut on segment boundaries. */
function excerpt(segments: TranscriptSegment[], passage: TranscriptPassage, terms: Set<string>, maxChars: number): RelatedPassage {
  if (passage.text.length <= maxChars) return { startSec: Math.round(passage.startSec), endSec: Math.round(passage.endSec), text: passage.text };
  let best = passage.from;
  let bestHits = -1;
  for (let i = passage.from; i < passage.to; i++) {
    const hits = tokens(segments[i].text).filter((t) => terms.has(t)).length;
    if (hits > bestHits) {
      best = i;
      bestHits = hits;
    }
  }
  let lo = best;
  let hi = best + 1;
  let chars = segments[best].text.length;
  // Grow around the hit — a little more of the lead-up than of what follows — until the budget is spent.
  for (let grew = true; grew; ) {
    grew = false;
    if (lo > passage.from && chars + segments[lo - 1].text.length + 1 <= maxChars) {
      chars += segments[--lo].text.length + 1;
      grew = true;
    }
    if (hi < passage.to && chars + segments[hi].text.length + 1 <= maxChars) {
      chars += segments[hi++].text.length + 1;
      grew = true;
    }
  }
  const text = segments
    .slice(lo, hi)
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ');
  const last = segments[hi - 1];
  return { startSec: Math.round(segments[lo].startSec), endSec: Math.round(last.startSec + last.durSec), text: text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text };
}

export interface RelatedPassageOptions {
  /** Where the learner is — only a tie-breaker. */
  currentTime?: number;
  /** The moment window already in the prompt; passages mostly inside it are skipped. */
  window?: { startSec: number; endSec: number } | null;
  /** Outline sections and Knowledge Map nodes; passages inside a heading the question names rank higher. */
  sections?: PassageSection[] | null;
  maxPassages?: number;
  maxChars?: number;
}

/**
 * The few passages of this transcript that answer `question`, in time order — or [] when nothing is
 * genuinely relevant ("hi", a general question, a term the video never uses). Never pads the result
 * with a weak match: an empty answer keeps chat exactly as it was.
 */
export function findRelatedPassages(segments: TranscriptSegment[] | null, question: string, options: RelatedPassageOptions = {}): RelatedPassage[] {
  if (!segments?.length || !normalizeText(question)) return [];
  const queryTerms = [...new Set(searchTokens(question))];
  if (!queryTerms.length) return [];

  const index = indexFor(segments);
  const N = index.passages.length;
  const idf = new Map(queryTerms.map((t) => [t, Math.log(1 + (N - (index.df.get(t) ?? 0) + 0.5) / ((index.df.get(t) ?? 0) + 0.5))] as const));
  // Terms the video never says carry no evidence either way; the rest decide coverage.
  const present = queryTerms.filter((t) => index.df.has(t));
  if (!present.length) return [];
  const totalWeight = queryTerms.reduce((n, t) => n + idf.get(t)!, 0);
  const phrases = questionPhrases(question).filter((p) => p.split(' ').every((t) => index.df.has(t)));
  const termSet = new Set(queryTerms);
  const headings = (options.sections ?? [])
    .map((s) => ({ startSec: s.startSec, endSec: s.endSec ?? s.startSec + 300, strength: sectionMatch(termSet, s.title) }))
    .filter((s) => s.strength > 0);
  const window = options.window ?? null;
  const now = options.currentTime ?? null;

  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < N; i++) {
    const p = index.passages[i];
    if (window) {
      const overlap = Math.max(0, Math.min(p.endSec, window.endSec) - Math.max(p.startSec, window.startSec));
      if (overlap / Math.max(1, p.endSec - p.startSec) > MAX_WINDOW_OVERLAP) continue;
    }
    const counts = index.tf[i];
    let score = 0;
    let matched = 0;
    for (const t of present) {
      const f = counts.get(t);
      if (!f) continue;
      const w = idf.get(t)!;
      matched += w;
      score += (w * f * (K1 + 1)) / (f + K1 * (1 - B + (B * index.lengths[i]) / index.avgLength));
    }
    if (!score) continue;
    const phraseHit = phrases.some((ph) => index.sequence[i].includes(` ${ph} `));
    if (matched / totalWeight < MIN_COVERAGE && !phraseHit) continue;
    for (const ph of phrases) {
      if (index.sequence[i].includes(` ${ph} `)) score += PHRASE_WEIGHT * ph.split(' ').reduce((n, t) => n + (idf.get(t) ?? 0), 0);
    }
    const mid = (p.startSec + p.endSec) / 2;
    const heading = headings.reduce((best, h) => (mid >= h.startSec && mid < h.endSec ? Math.max(best, h.strength) : best), 0);
    score *= 1 + SECTION_WEIGHT * heading;
    if (now !== null) score *= 1 + NEARNESS_WEIGHT / (1 + Math.abs(mid - now) / 600);
    scored.push({ i, score });
  }
  if (!scored.length) return [];

  scored.sort((a, b) => b.score - a.score);
  const floor = scored[0].score * RELATIVE_FLOOR;
  const maxPassages = options.maxPassages ?? MAX_RELATED_PASSAGES;
  const maxChars = options.maxChars ?? MAX_RELATED_CHARS;
  const perPassage = Math.min(EXCERPT_CHARS, Math.floor(maxChars / maxPassages));
  const picked: RelatedPassage[] = [];
  let used = 0;
  for (const spread of [SPREAD_SEC, 5]) {
    for (const { i, score } of scored) {
      if (picked.length >= maxPassages || score < floor) break;
      const p = index.passages[i];
      // Neighbours of an already-picked passage say the same thing twice; the budget is better spent elsewhere.
      if (picked.some((q) => p.startSec < q.endSec + spread && p.endSec > q.startSec - spread)) continue;
      const part = excerpt(segments, p, termSet, Math.min(perPassage, maxChars - used));
      if (!part.text || used + part.text.length > maxChars) break;
      picked.push(part);
      used += part.text.length;
    }
  }
  return picked.sort((a, b) => a.startSec - b.startSec);
}
