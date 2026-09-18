import { cleanLabel, isProgressNoise, isTopicLabel, timestampLines } from './timestamps';

/**
 * A timestamped outline written in free text (a description or a comment):
 *
 *   🎮 SESSION 1: Playing a Counting Game        ← header (no timestamp)
 *   00:00:20 ▶ What Is an Algorithm? — Intro      ← item, nested under the header
 *   Worts Case Scenario - 25:21                    ← label before the time works too
 *   (Start time: 01:57:44)                         ← places the header itself
 */

export interface TextOutlineItem {
  title: string;
  startSec: number;
  depth: number;
  /** Header this item is nested under. */
  parent?: string;
  line: number;
}

export interface TextOutline {
  items: TextOutlineItem[];
  /** Timestamped lines rejected as noise (progress logs, dates, sentences). */
  noiseLines: number;
  /** Share of consecutive items in ascending time order (1 = perfectly ordered). */
  ascending: number;
}

const DECORATION = /^[\s━═─—_*~=#-]+$/u;
const NAV_HINT = /^(?:skip|jump|go)\s+(?:directly\s+)?to\s+/i;
const START_MARKER = /^(?:start(?:ing)?(?: time)?|starts? at|begins? at|from)$/i;
/** List labels, not concepts: "Topics covered:", "Timestamps", "In this video". */
const GENERIC_HEADER = /^(?:topics?(?: covered| discussed)?|timestamps?|time ?stamps|chapters?|contents?|table of contents|index|in this (?:video|lecture|lesson)|what you(?:'ll| will) learn|agenda|syllabus|outline)$/i;
const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'vs']);

/** "What Is an Algorithm? — Intro & fundamentals" → "What Is an Algorithm?" */
function mainTitle(label: string): string {
  const [head, ...rest] = label.split(/\s+[—–]\s+|\s+\|\s+/);
  return rest.length && head.split(/\s+/).length >= 2 ? head.trim() : label;
}

/** "SESSION 1: Playing a Counting Game" → "Playing a Counting Game" */
function headerTitle(label: string): string {
  return label.replace(/^(?:session|section|part|module|chapter|unit|week)\s*\d+\s*[:.)-]\s*/i, '').trim() || label;
}

/** Trailing sentence punctuation off; SHOUTED HEADERS → Title Case. */
export function tidyTitle(label: string): string {
  const title = label.replace(/[.;,]+$/, '').trim().replace(/^(?:__|\*\*)(.+?)(?:__|\*\*)$/, '$1').trim();
  const letters = title.replace(/[^\p{L}]/gu, '');
  if (letters.length <= 3 || letters !== letters.toUpperCase()) return title;
  return title
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function textOutline(text: string, durationSec: number | null): TextOutline {
  const lines = text.split(/\r?\n/);
  const raw: (TextOutlineItem & { hint: boolean; header: boolean })[] = [];
  let noiseLines = 0;
  let header: { title: string; used: boolean } | null = null;

  lines.forEach((line, index) => {
    const parsed = timestampLines(line)[0];
    if (!parsed) {
      if (DECORATION.test(line)) return;
      const label = cleanLabel(line);
      if (!label) return;
      const headerLike = label.split(/\s+/).length <= 8 && isTopicLabel(label) && !/[.!?]$/.test(label);
      if (headerLike && GENERIC_HEADER.test(label)) header = null;
      else if (headerLike) header = { title: tidyTitle(headerTitle(label)), used: false };
      // Prose ends a header that never got items; a note under an item doesn't end its group.
      else if (header && !header.used) header = null;
      return;
    }
    const group = header as { title: string; used: boolean } | null;
    const inRange = durationSec === null || parsed.startSec <= durationSec + 5;
    if (group && START_MARKER.test(parsed.label)) {
      if (!group.used && inRange) raw.push({ title: group.title, startSec: parsed.startSec, depth: 0, line: index, hint: false, header: true });
      header = null;
      return;
    }
    if (isProgressNoise(parsed) || !inRange || !isTopicLabel(parsed.label)) {
      noiseLines++;
      return;
    }
    const hint = NAV_HINT.test(parsed.label);
    const title = tidyTitle(mainTitle(parsed.label.replace(NAV_HINT, '')));
    if (group && !group.used) {
      raw.push({ title: group.title, startSec: parsed.startSec, depth: 0, line: index, hint: false, header: true });
      group.used = true;
    }
    raw.push({ title, startSec: parsed.startSec, depth: group ? 1 : parsed.depth, parent: group?.title, line: index, hint, header: false });
  });

  // The same time twice ("Skip to X - 41:01" and later "41:01 X"): keep the real outline line.
  const items = raw.filter((item) => !(item.hint && raw.some((o) => o !== item && !o.hint && !o.header && o.startSec === item.startSec)));
  const ordered = items.filter((i) => !i.hint);
  let asc = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i].startSec >= ordered[i - 1].startSec) asc++;
  return {
    items: items.map(({ title, startSec, depth, parent, line }) => ({ title, startSec, depth, parent, line })),
    noiseLines,
    ascending: ordered.length > 1 ? asc / (ordered.length - 1) : 1,
  };
}
