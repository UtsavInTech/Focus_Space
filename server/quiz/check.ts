import { NO_DASH } from '@/learning/ai/actions';
import { formatQuiz, nearDuplicate, parseQuiz, type QuizQuestion } from '@/learning/ai/quiz-format';
import { ApiError } from '../http';

/**
 * Every quiz round is checked before anyone sees it. The writer (gpt-4o-mini) is fast and cheap, and it
 * sometimes writes a wrong key: it once said `printf("%d")` over {6, 2, 0, 4, 5} prints "6 2 0 4 5", and
 * offered two options that both meant "prints every element". A learner cannot tell, so it must never
 * reach them.
 *
 * 1. Judge: Jev (a decision model on OpenRouter; input is billed, output is free) solves each question on
 *    its own, without seeing the key, and says whether exactly one option is correct. A question passes
 *    when Jev gives the writer's key at least `PASS_PROBABILITY` and finds exactly one correct option.
 * 2. Settle: anything else (Jev disagrees, is unsure, finds no correct option or two, or cannot be
 *    reached) goes to a reasoning model, which traces it properly. One correct option: the question is
 *    kept with that key (corrected if it differed). Otherwise it is dropped.
 *
 * On 25 hand-made questions (12 broken) the judge flagged all 12 and sent one good question on to be
 * settled, where gpt-4o and gpt-4o-mini as checkers each missed two. The settle model needs the exact
 * output rule: without it, gpt-5-mini accepted "5 10 0 0 0" for a loop that prints "510000".
 */

export interface QuizCheckConfig {
  /** OpenRouter, for the judge. Without it every question goes straight to the settle model. */
  openRouterKey: string | null;
  openAiKey: string;
  judgeModel: string;
  settleModel: string;
}

export function loadQuizCheckConfig(env: NodeJS.ProcessEnv = process.env): QuizCheckConfig {
  return {
    openRouterKey: env.OPENROUTER_API_KEY || null,
    openAiKey: env.OPENAI_API_KEY ?? '',
    judgeModel: env.QUIZ_JUDGE_MODEL ?? 'typesafe/jev-1.13',
    settleModel: env.QUIZ_SETTLE_MODEL ?? 'gpt-5-mini',
  };
}

export interface QuizCheckResult {
  text: string;
  shown: number;
  /** Kept, with the key corrected. */
  fixed: number;
  /** Left out: no single correct option, a repeat, or unreadable. */
  dropped: number;
  /** Sent on to the settle model. */
  settled: number;
}

export const PASS_PROBABILITY = 0.8;
const SINGLE_ANSWER = 0.5;
/** The judge's context holds 32k tokens; the round's transcript is far below that, but never unbounded. */
const EXCERPT_CHARS = 16_000;
const NONE = 'NONE';
/**
 * How long each check may take. A judge that is slow counts as unsure (the question is settled instead);
 * a settle that is slow drops the question. Either way a stalled provider never holds the round open.
 */
export const JUDGE_TIMEOUT_MS = 15_000;
export const SETTLE_TIMEOUT_MS = 45_000;
const within = (ms: number, signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
/** The mistake the writer makes most: an output option that is nearly right ("5 10 0 0 0" for "510000"). */
const EXACT_OUTPUT = "An option that states a program's output is correct only if it matches the exact output character for character: spaces, commas and new lines matter.";

type Fetch = typeof fetch;

async function judge(q: QuizQuestion, excerpt: string, config: QuizCheckConfig, fetchFn: Fetch, signal?: AbortSignal): Promise<boolean> {
  if (!config.openRouterKey || !q.answer) return false;
  const options = Object.fromEntries(q.options.map((o) => [o.letter, o.text]));
  const res = await fetchFn('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openRouterKey}`, 'content-type': 'application/json', 'x-title': 'FocusSpace' },
    body: JSON.stringify({
      model: config.judgeModel,
      state: { transcript_excerpt: excerpt.slice(-EXCERPT_CHARS), question: q.text, options },
      questions: {
        answer: {
          type: 'choice',
          instructions: `Which option correctly answers the quiz question? Trace any code exactly as it executes. ${EXACT_OUTPUT} Choose ${NONE} if no option is correct.`,
          criteria: { ...Object.fromEntries(q.options.map((o) => [o.letter, `Option ${o.letter}: ${o.text}`])), [NONE]: 'None of the options is correct.' },
        },
        single: {
          type: 'noul',
          instructions: `Is exactly one of the options correct (not zero, not two or more)? ${EXACT_OUTPUT}`,
          criteria: { true: 'Exactly one option is correct.', false: 'No option is correct, or two or more are correct.' },
        },
      },
    }),
    signal: within(JUDGE_TIMEOUT_MS, signal),
  });
  if (!res.ok) return false;
  const json = (await res.json().catch(() => null)) as { answers?: { answer?: { probabilities?: Record<string, number> }; single?: { noul?: number } } } | null;
  const keyProbability = json?.answers?.answer?.probabilities?.[q.answer.letter] ?? 0;
  const single = json?.answers?.single?.noul ?? 0;
  return keyProbability >= PASS_PROBABILITY && single >= SINGLE_ANSWER;
}

const SETTLE_SYSTEM = [
  'You check a multiple-choice quiz question before learners see it.',
  'Work out the answer yourself: read the transcript excerpt, trace any code step by step exactly as the language executes it (output formatting, operator precedence and associativity, integer types, string terminators), and judge every option on its own.',
  EXACT_OUTPUT,
  'Reply with JSON only: {"correct_options":["<every letter that is fully correct>"],"reason":"<one or two short sentences: why the correct option is right and why the most tempting wrong one is wrong>"}.',
  NO_DASH,
].join(' ');

async function settle(q: QuizQuestion, excerpt: string, config: QuizCheckConfig, fetchFn: Fetch, signal?: AbortSignal): Promise<{ letter: string; reason: string } | null> {
  const user = `Transcript excerpt:\n"""${excerpt.slice(-EXCERPT_CHARS)}"""\n\nQuestion:\n${q.text}\n\nOptions:\n${q.options.map((o) => `${o.letter}) ${o.text}`).join('\n')}`;
  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openAiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.settleModel,
      reasoning_effort: 'low',
      max_completion_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SETTLE_SYSTEM },
        { role: 'user', content: user },
      ],
    }),
    signal: within(SETTLE_TIMEOUT_MS, signal),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  try {
    const out = JSON.parse(json?.choices?.[0]?.message?.content ?? '') as { correct_options?: unknown; reason?: unknown };
    const letters = Array.isArray(out.correct_options) ? out.correct_options.map((l) => String(l).trim().toUpperCase()) : [];
    const valid = letters.filter((l) => q.options.some((o) => o.letter === l));
    if (valid.length !== 1 || letters.length !== 1) return null;
    return { letter: valid[0], reason: typeof out.reason === 'string' ? out.reason.replace(/\s+/g, ' ').trim() : '' };
  } catch {
    return null;
  }
}

/** Only case and spacing: "4,5,6", "4 5 6" and "456" are different outputs and stay different options. */
const optionKey = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The same option offered twice ("4 5 6" as B and as D) is fixed without a model: the repeat goes and the
 * letters close up, the key following its option. When the key itself is repeated, two options are the
 * right answer and the question is dropped.
 */
export function distinctOptions(q: QuizQuestion): QuizQuestion | null {
  const first = new Map<string, string>();
  const kept = q.options.filter((o) => {
    const key = optionKey(o.text);
    if (first.has(key)) return false;
    first.set(key, o.letter);
    return true;
  });
  if (kept.length === q.options.length) return q;
  const keyOption = q.options.find((o) => o.letter === q.answer?.letter);
  if (keyOption && q.options.filter((o) => optionKey(o.text) === optionKey(keyOption.text)).length > 1) return null;
  if (kept.length < 2) return null;
  const letters = 'ABCDEFGH';
  const at = kept.findIndex((o) => o.letter === q.answer?.letter);
  return { ...q, options: kept.map((o, i) => ({ letter: letters[i], text: o.text })), answer: q.answer && at >= 0 ? { ...q.answer, letter: letters[at] } : null };
}

/** Checks one round as written by the quiz writer. Throws when nothing in it survives, rather than showing an unchecked quiz. */
export async function checkQuiz(answer: string, excerpt: string, config: QuizCheckConfig, signal?: AbortSignal, fetchFn: Fetch = fetch): Promise<QuizCheckResult> {
  const nothing = () => new ApiError(502, 'upstream_error', 'FocusSpace couldn’t write questions that passed its check this time. Try again.');
  const parsed = parseQuiz(answer);
  if (!parsed) throw nothing();

  // Readable, answered, and not the same question twice in one round.
  const candidates: QuizQuestion[] = [];
  for (const written of parsed) {
    const q = distinctOptions(written);
    if (!q || !q.answer || !q.options.some((o) => o.letter === q.answer!.letter)) continue;
    if (candidates.some((c) => nearDuplicate(c.text, q.text))) continue;
    candidates.push(q);
  }

  let fixed = 0;
  let settled = 0;
  const checked = await Promise.all(
    candidates.map(async (q): Promise<QuizQuestion | null> => {
      const passed = await judge(q, excerpt, config, fetchFn, signal).catch(() => false);
      if (passed) return q;
      settled++;
      const verdict = await settle(q, excerpt, config, fetchFn, signal).catch(() => null);
      if (!verdict) return null;
      if (verdict.letter === q.answer!.letter) return q;
      fixed++;
      return { ...q, answer: { letter: verdict.letter, reason: verdict.reason } };
    }),
  );
  const kept = checked.filter((q): q is QuizQuestion => !!q);
  if (!kept.length) throw nothing();
  return { text: formatQuiz(kept), shown: kept.length, fixed, dropped: parsed.length - kept.length, settled };
}
