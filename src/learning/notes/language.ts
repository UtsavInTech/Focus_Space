import type { NoteLanguage } from '@/types/notes';
import { normalizeText } from '../text';

/**
 * Language rules for note generation. Hindi/Hinglish notes translate the
 * explanatory prose naturally but keep technical terminology exactly as
 * spoken — the same principle already documented for saved notes
 * (src/types/notes.ts) and the product brief.
 */
export const LANGUAGE_INSTRUCTION: Record<NoteLanguage, string> = {
  en: 'Write the notes in English.',
  hi: 'Write the notes in Hindi (Devanagari script). Keep technical terms — concept names, data structures, syntax, APIs, formulas, code identifiers — exactly as spoken, in English/Roman script; translate only the explanatory prose around them naturally, the way a fluent bilingual instructor would. Do not transliterate or translate the technical terms themselves.',
  hinglish: 'Write the notes in Hinglish (Roman-script conversational Hindi/English mix, the way Indian instructors commonly explain on YouTube). Keep technical terms in English exactly as spoken.',
};

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'your', 'what', 'when', 'where', 'which', 'their', 'are', 'is']);

/**
 * Terms a note must keep untranslated — derived from what's actually being
 * taught (concept titles in range, plus mode topic names that literally
 * appear in the evidence), not a hardcoded glossary. Whole concept titles
 * are kept as phrases ("Linked List", not "Linked" + "List" separately).
 */
export function technicalTerms(conceptTitles: string[], modeTopicNames: string[], evidenceText: string): string[] {
  const text = normalizeText(evidenceText);
  const terms = new Set<string>();
  for (const title of conceptTitles) {
    const t = title.trim();
    if (t && !STOPWORDS.has(t.toLowerCase())) terms.add(t);
  }
  for (const name of modeTopicNames) {
    if (name.length >= 3 && text.includes(normalizeText(name))) terms.add(name);
  }
  return [...terms];
}

/** Which of `terms` literally appear in `text` — a deterministic check for tests, not a translation-quality judgement. */
export function termCoverage(text: string, terms: string[]): { present: string[]; missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];
  for (const term of terms) (text.includes(term) ? present : missing).push(term);
  return { present, missing };
}
