import { normalizeText } from '@/learning/text';
import { inferModeIntent, knownSubjectPhrases, type IntentSuggestion } from './intent';

/**
 * "I want to learn system desing so add it as a space for now" → [System Design].
 *
 * The setup assistant asks the server's AI first; this is what runs when it can't be reached, so a
 * sentence never becomes a Space called "I Want To. Learn System Desing So Add It As A Space For Now".
 * It splits a request into subjects, drops the words that carry no subject (stop words and requests
 * like "add it as a space"), and corrects a small typo against the subjects FocusSpace knows.
 */

/** Words that say *how* someone is asking, never *what* for. "learn" stays: it is how languages are recognised. */
const STOP = new Set(
  (
    'i im i\'m me my we our you your hey hi hello ok okay so and also then just please pls kindly ' +
    'want wanna would like love need needs wish to going gonna get got be is are am will can could should ' +
    'add create make set setup up start starting build give put open it them this that these those ' +
    'as a an the for now right today some few following list all of about into with on at in by ' +
    'space spaces mode modes section sections category categories topic topics subject subjects ' +
    'better good really more stuff things thing one two three four five six'
  ).split(' '),
);

/** Where one subject ends and the next begins: commas, lines, bullets, "and", "&", "+". */
const SEPARATORS = /[,;\n•·|]+|\s(?:and|&|\+|aur|or)\s|\d+[.)]\s/gi;

export function subjectPhrases(raw: string): string[] {
  const chunks = raw.split(SEPARATORS);
  const out: string[] = [];
  for (const chunk of chunks) {
    const words = normalizeText(chunk.replace(/[.!?:"“”]/g, ' '))
      .split(' ')
      .filter((w) => /[\p{L}\p{N}]/u.test(w) && !STOP.has(w)); // a bare "-" bullet is not a word
    // "learn" on its own ("I want to learn") names nothing.
    const phrase = words.join(' ').replace(/^(learn|learning|study|studying)$/, '').trim();
    if (phrase.length >= 2 && !out.includes(phrase)) out.push(phrase);
  }
  return out;
}

/** Plain Levenshtein distance — the phrases are short, so the simple version is plenty. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

function closest(phrase: string): string | null {
  if (phrase.length < 4) return null;
  let best: { phrase: string; d: number } | null = null;
  for (const known of knownSubjectPhrases()) {
    if (known.length < 4) continue;
    const d = distance(phrase, known);
    if (d <= Math.max(1, Math.floor(known.length / 6)) && (!best || d < best.d)) best = { phrase: known, d };
  }
  return best?.phrase ?? null;
}

/**
 * "system desing" → "system design", "learn system desing" → "system design"; anything not close to a
 * known subject is left as it was. A leading "learn" is only dropped when what follows is a known
 * subject — the engine still sees "learn pottery" as a learning Space.
 */
export function correctSubject(phrase: string): string {
  const bare = phrase.replace(/^(learn|learning|study|studying)\s+/, '');
  return closest(phrase) ?? (bare !== phrase ? closest(bare) : null) ?? phrase;
}

/** Every Space a request asks for, deduplicated ("data structures and algorithms" is one DSA Space, not two). */
export function inferSubjects(raw: string): IntentSuggestion[] {
  const seen = new Set<string>();
  const out: IntentSuggestion[] = [];
  for (const phrase of subjectPhrases(raw)) {
    const suggestion = inferModeIntent(correctSubject(phrase));
    if (!suggestion) continue;
    const key = suggestion.templateId ?? suggestion.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
  }
  return out;
}
