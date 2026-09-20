import { normalizeText } from '../text';

/** Concept-level text helpers: comparable tokens, label similarity, stable hashes. */

const STOP = new Set(
  'a an the of in on to for and or with by at from is are was be this that it its as into how what why when where which who we you i he she they our your my me us do does did can will lets let about video part using use vs'.split(' '),
);

/** insertion/inserting → insert, lists → list, sorted → sort. Deliberately tiny. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 6 && w.endsWith('ation')) w = w.slice(0, -5);
  else if (w.length > 5 && (w.endsWith('ing') || w.endsWith('ion') || w.endsWith('ive'))) w = w.slice(0, -3);
  else if (w.length > 5 && w.endsWith('al')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && /(?:ss|sh|ch|x)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

export function words(text: string): string[] {
  return normalizeText(text)
    // Marks are kept: in Devanagari (and every other Indic script) the vowel signs are combining marks, and
    // dropping them turns करना into करन — mangled fragments that then looked like the video's key concepts.
    .replace(/[^\p{L}\p{N}\p{M}+#]+/gu, ' ')
    .replace(/(?<=\p{L})(?=\d)/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

export function conceptTokens(text: string): string[] {
  return words(text)
    .filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
    .map(stem);
}

/** 0–1. Jaccard over concept tokens; a label contained in the other scores at least 0.6. */
export function labelSimilarity(a: string, b: string): number {
  const A = new Set(conceptTokens(a));
  const B = new Set(conceptTokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const jaccard = shared / (A.size + B.size - shared);
  const contained = shared === Math.min(A.size, B.size);
  return contained ? Math.max(jaccard, 0.6) : jaccard;
}

/** FNV-1a, base36 — cache signatures, not security. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
