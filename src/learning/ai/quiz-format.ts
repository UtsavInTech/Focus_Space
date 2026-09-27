/**
 * "Quiz me" answers, read back into questions, options and answers so the panel can show each question
 * as a card instead of one block of text.
 *
 * The prompt asks for a fixed plain-text shape (actions.ts QUIZ): numbered questions, lettered options,
 * then an "Answers:" list. Models drift — bold markers, "A." instead of "A)", a code snippet inside a
 * question — so this is forgiving. When the text does not look like a quiz at all it returns null, and
 * the panel shows the answer as ordinary text, exactly as before.
 */

export interface QuizOption {
  letter: string;
  text: string;
}

export interface QuizQuestion {
  n: number;
  /** The question itself; may span lines (a code snippet to read). */
  text: string;
  options: QuizOption[];
  /** The correct letter and its one-line reason, when the answers list covers this question. */
  answer: { letter: string; reason: string } | null;
}

const QUESTION = /^(\d{1,2})[.)]\s+(.+)$/;
const OPTION = /^([A-Da-d])[).:]\s+(.+)$/;
const ANSWERS = /^answers?\s*:?\s*$/i;
const ANSWER = /^(\d{1,2})[.):]?\s*(?:answer\s*:?\s*)?\(?([A-Da-d])\)?(?:[).:]?\s*(?:[—–:,-]\s*)?(.*))?$/i;

/** Markdown emphasis the model sometimes adds around numbers, letters or headings. */
const plain = (line: string) => line.replace(/\*\*|__/g, '').trim();

export function parseQuiz(text: string): QuizQuestion[] | null {
  const lines = text.replace(/\r/g, '').split('\n');
  const questions: QuizQuestion[] = [];
  let inAnswers = false;
  let inCode = false;
  let current: QuizQuestion | null = null;

  for (const raw of lines) {
    const line = plain(raw);
    if (raw.trim().startsWith('```')) inCode = !inCode;
    if (inCode || raw.trim().startsWith('```')) {
      // A snippet belongs to the question being written; it is never an option or an answer.
      if (current && !inAnswers) current.text += `\n${raw}`;
      continue;
    }
    if (!line) continue;
    if (ANSWERS.test(line)) {
      inAnswers = true;
      continue;
    }
    if (inAnswers) {
      const m = line.match(ANSWER);
      const q = m && questions.find((x) => x.n === Number(m[1]));
      if (q && m) q.answer = { letter: m[2].toUpperCase(), reason: (m[3] ?? '').trim() };
      continue;
    }
    const option = line.match(OPTION);
    if (option && current) {
      current.options.push({ letter: option[1].toUpperCase(), text: option[2].trim() });
      continue;
    }
    const question = line.match(QUESTION);
    if (question) {
      current = { n: Number(question[1]), text: question[2].trim(), options: [], answer: null };
      questions.push(current);
      continue;
    }
    // Anything else continues the question (a second line, an inline snippet) before its options start.
    if (current && !current.options.length) current.text += `\n${line}`;
  }

  const usable = questions.filter((q) => q.options.length >= 2);
  return usable.length && usable.length === questions.length ? usable : null;
}

/**
 * Questions back into the plain-text shape `parseQuiz` reads, numbered from 1. The server uses it after
 * checking a round (server/quiz/check.ts): keys corrected, failed questions left out, and the extension
 * reads the result exactly as it reads any quiz.
 */
export function formatQuiz(questions: QuizQuestion[]): string {
  const body = questions.map((q, i) => [`${i + 1}. ${q.text}`, ...q.options.map((o) => `   ${o.letter}) ${o.text}`)].join('\n'));
  // One line per answer: the reader parses them line by line, so a line break inside a reason would cut it short.
  const answers = questions.map((q, i) => `${i + 1}. ${q.answer?.letter ?? ''}${q.answer?.reason ? `, ${q.answer.reason.replace(/\s+/g, ' ').trim()}` : ''}`);
  return `${body.join('\n\n')}\n\nAnswers:\n${answers.join('\n')}`;
}

const STOP = new Set('a an the of to in on for and or is are be it this that what which does do how when with by as at from if its will would than then there their these those after before code snippet following output print prints value'.split(' '));
const words = (text: string) => new Set((text.toLowerCase().match(/[a-z_][a-z0-9_]*|\d+/g) ?? []).filter((w) => !STOP.has(w)));
const codeOf = (text: string) => (text.match(/```[\s\S]*?```|`[^`\n]+`/g) ?? []).join(' ').replace(/```\w*|`/g, '').replace(/\s+/g, '');

/**
 * The same question asked again in other words: the same code to read, or mostly the same words. Catches
 * what an exact-match check missed ("What does this print?" twice over the same array), and leaves
 * questions that only share a topic alone.
 */
export function nearDuplicate(a: string, b: string): boolean {
  const ca = codeOf(a);
  if (ca.length >= 12 && ca === codeOf(b)) return true;
  const wa = words(a);
  const wb = words(b);
  if (wa.size < 3 || wb.size < 3) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared) >= 0.6;
}
