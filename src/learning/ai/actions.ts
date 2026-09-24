import type { NoteLanguage } from '@/types/notes';
import type { LearningContext } from '../context/context';
import { formatTimestamp } from '../knowledge/timestamps';

/**
 * The AI actions a learner can take on a moment, and the prompts behind them.
 * Prompts carry the compact LearningContext (the current concept, its
 * neighbours, the path, and a transcript window) — never a whole transcript.
 * Later actions (notes, flashcards, interview questions…) are new entries here.
 *
 * Course structure (playlist position, section names, previous/next topics,
 * instructor) tells the model *what* is being studied. It is orientation only
 * and never the subject of a question — see QUIZ rules and reviewQuiz().
 */

export type AiAction = 'what' | 'explain' | 'example' | 'ask' | 'quiz';

export interface AiActionSpec {
  id: AiAction;
  label: string;
  /** Needs the learner to type a question. */
  needsQuestion: boolean;
  /** Can be answered from local data when no AI provider is available. */
  local: boolean;
}

export const AI_ACTIONS: AiActionSpec[] = [
  { id: 'what', label: 'What am I learning?', needsQuestion: false, local: true },
  { id: 'explain', label: 'Explain this', needsQuestion: false, local: false },
  { id: 'example', label: 'Give an example', needsQuestion: false, local: false },
  { id: 'quiz', label: 'Quiz me', needsQuestion: false, local: false },
  { id: 'ask', label: 'Ask about this moment', needsQuestion: true, local: false },
];

/**
 * How much transcript each action sees. Quizzes and explanations need the
 * section being taught, not only the last seconds: a longer lead-up, still
 * starting inside the current concept when it began long enough ago.
 */
export const WINDOW_FOR: Record<AiAction, { beforeSec?: number; afterSec?: number; maxChars?: number; minLeadSec?: number }> = {
  what: {},
  ask: { beforeSec: 120 },
  example: { beforeSec: 120 },
  explain: { beforeSec: 180, maxChars: 3200, minLeadSec: 60 },
  quiz: { beforeSec: 420, afterSec: 15, maxChars: 4500, minLeadSec: 150 },
};

export interface AiPrompt {
  system: string;
  user: string;
}

export const SYSTEM = [
  'You are FocusSpace, a learning companion shown next to a YouTube video.',
  'Answer about the exact moment described in the context. Use the transcript excerpt as the primary evidence of what the instructor is teaching.',
  'If the context does not contain enough information, say so briefly instead of guessing. Never invent what the video says.',
  'The course position, section names, previous and upcoming topics and the instructor are orientation only: use them to understand what is being studied, not as subject matter.',
  'Be concise and concrete. Plain text; short lists and small code blocks are fine.',
].join(' ');

/**
 * Same rule WS2 uses for notes (src/learning/notes/language.ts), expressed
 * for a spoken-answer/chat context rather than written notes: translate the
 * explanation naturally, never the technical terms. Reused by chat.ts so the
 * whole AI companion — actions, notes, chat — agrees on language handling.
 */
export const LANGUAGE_RULE: Record<NoteLanguage, string> = {
  en: '',
  hi: 'Respond in Hindi (Devanagari script). Keep technical terms — concept names, syntax, APIs, formulas, code — exactly as spoken, in English/Roman script; translate only the explanation around them naturally, the way a fluent bilingual instructor would.',
  hinglish: 'Respond in Hinglish (Roman-script conversational Hindi/English mix, the way Indian instructors commonly explain on YouTube). Keep technical terms in English exactly as spoken.',
};

const QUIZ = `Write a 3-question quiz that checks whether the learner understands the subject matter being taught at this moment — questions that would be useful in a university exam, a technical interview or a placement test.

What to test:
- The subject itself: what a concept does, how it behaves, differences between similar concepts, correct syntax or usage, reading a short code snippet or query and predicting its result, edge cases, applying the idea to a small problem.
- Ground every question in the transcript excerpt and the current concept. Do not test anything the context gives no evidence of. If the excerpt is short, use the current concept and the part it belongs to.
- Match the difficulty of the material: introductory material gets accessible questions, advanced material gets questions that need reasoning. At least one question must require reasoning (for example predicting a result or choosing the correct snippet), not just recall.

Never ask about:
- the course or video itself: chapter, lecture or section numbers or names, beginner/intermediate/advanced levels, what comes next or came before, the order topics are presented in, what the instructor or channel said or is called;
- anything that can be answered just by reading the list of concepts.
The only exception: when an ordering is itself the subject being taught (for example the order in which SQL clauses are executed), a question about that ordering is fine.

Before answering, silently check every question: Does it test understanding of the subject rather than the course? Would it help in an exam or interview? Is there exactly one defensible answer, with plausible distractors? Replace any question that fails.

Format (plain text, no markdown):
1. Question
   A) …
   B) …
   C) …
   D) …
2. …
3. …
Answers:
1. B — one-line reason
2. …
3. …`;

const TASK: Record<AiAction, string> = {
  what: 'In one sentence of at most 25 words, say what this part teaches in plain words. Do not mention previous or next topics, the course or the instructor.',
  explain: 'Explain what the instructor is explaining at this moment, simply, as if to a student seeing it for the first time. Under 150 words.',
  example: 'Give one small, concrete example that illustrates the concept being taught at this moment (a short code snippet if it is a programming topic). Under 150 words.',
  ask: 'Answer the learner’s question specifically in the context of this moment of the video. Under 180 words.',
  quiz: QUIZ,
};

/** Context as compact labelled lines, split into orientation vs. what is being taught. */
export function contextBlock(ctx: LearningContext): string {
  const orientation = [
    `Video: ${ctx.videoTitle}${ctx.channel ? ` — ${ctx.channel}` : ''}`,
    ctx.learningPath.currentTopic ? `Space: ${ctx.mode.name} (topic: ${ctx.learningPath.currentTopic})` : '',
    ctx.learningPath.topics.length ? `Learning path: ${ctx.learningPath.topics.join(' → ')}` : '',
    ctx.playlist ? `Course: ${ctx.playlist.title}${ctx.playlist.position ? `, video #${ctx.playlist.position} of ${ctx.playlist.total}` : ''}${ctx.playlist.next ? `; next: ${ctx.playlist.next}` : ''}` : '',
    ctx.previousConcepts.length ? `Previous concepts: ${ctx.previousConcepts.join(', ')}` : '',
    ctx.upcomingConcepts.length ? `Upcoming concepts: ${ctx.upcomingConcepts.join(', ')}` : '',
  ];
  const now = [
    `Timestamp: ${ctx.timestamp}`,
    ctx.conceptPath.length ? `Current concept: ${ctx.conceptPath.join(' › ')}` : 'Current concept: unknown',
    ctx.transcriptWindow
      ? `${ctx.transcriptSource === 'asr' ? 'Auto-generated captions (speech recognition — technical terms and names may be misheard)' : 'Transcript'} ${formatTimestamp(ctx.transcriptWindow.startSec)}–${formatTimestamp(ctx.transcriptWindow.endSec)}:\n"""${ctx.transcriptWindow.text}"""`
      : 'Transcript: not available for this moment',
  ];
  return ['[Orientation — context only, not subject matter]', ...orientation.filter(Boolean), '', '[Being taught now]', ...now].join('\n');
}

export function buildPrompt(action: AiAction, ctx: LearningContext, question?: string): AiPrompt {
  const ask = action === 'ask' ? `\n\nLearner's question: "${(question ?? '').trim().slice(0, 500)}"` : '';
  const language = LANGUAGE_RULE[ctx.language] ? `\n\n${LANGUAGE_RULE[ctx.language]}` : '';
  return { system: SYSTEM, user: `${contextBlock(ctx)}${ask}\n\nTask: ${TASK[action]}${language}` };
}

/* ─── Quiz review ──────────────────────────────────────────────────────────── */

export interface QuizIssue {
  question: number;
  text: string;
  reason: string;
}

const COURSE_WORDS = String.raw`(?:chapter|lecture|episode|playlist|course|video|tutorial)`;
/** Questions about the video/course instead of the subject. Kept narrow: "the module", "Taylor series", "isolation level" are subject matter. */
const METADATA: { re: RegExp; reason: string; ordering?: boolean }[] = [
  { re: new RegExp(String.raw`\b(?:this|the|next|previous|same|which)\s+${COURSE_WORDS}\b`, 'i'), reason: 'asks about the course or video rather than the subject' },
  { re: /\b(?:beginner|intermediate|advanced|basic)\s+(?:level|section|part|chapter|module)\b/i, reason: 'asks which level of the course a topic belongs to' },
  { re: /\b(?:what|which)\s+(?:level|difficulty)\s+(?:is|does|comes)\b/i, reason: 'asks what level or difficulty this part is, rather than testing the concept' },
  { re: /\b(?:chapter|lecture|episode|lesson|part)\s+(?:number|#?\d+)\b/i, reason: 'asks about chapter or lecture numbers' },
  { re: /\baccording to (?:the )?(?:instructor|teacher|tutor|speaker|creator|presenter|narrator|host|video|course|lecture|author)\b/i, reason: 'asks what the instructor said instead of testing the concept' },
  { re: /\b(?:instructor|teacher|tutor|speaker|presenter|youtuber|channel)\b/i, reason: 'is about the instructor or channel' },
  { re: /\bfirst topic\b|\bnext (?:topic|chapter|video|lecture|section|lesson|concept)\b|\bprevious (?:topic|chapter|video|lecture|section|lesson)\b/i, reason: 'asks what comes next or before in the course', ordering: true },
  { re: /\b(?:mentioned|discussed|covered|introduced|explained|taught|presented|shown)\s+(?:first|next|last|after|before|earlier|later)\b/i, reason: 'asks about the order topics are presented in', ordering: true },
  { re: /\b(?:comes?|came)\s+(?:next|after|before)\b/i, reason: 'asks what comes next or before in the course', ordering: true },
];
const ORDER_IS_SUBJECT = /\b(?:order|sequence|execution|lifecycle|life cycle|pipeline|phases?|stages?|steps?|precedence)\b/i;

/** Question lines of a quiz ("1. …", "Q2) …"), before the answers. */
export function quizQuestions(text: string): { n: number; text: string }[] {
  const body = text.split(/^\s*\**\s*answers?\s*(?:key)?\s*:?\s*\**\s*$/im)[0];
  const out: { n: number; text: string }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*\**\s*(?:q(?:uestion)?\s*)?(\d{1,2})\s*[.):]\s*\**\s*(.+)$/i);
    if (m && !/^[A-D]\)/.test(m[2])) out.push({ n: Number(m[1]), text: m[2].replace(/\*\*/g, '').trim() });
  }
  return out;
}

/** Name-based "According to Baraa, …" — but not "according to Codd's rules". */
function citesPerson(question: string): boolean {
  const m = question.match(/\baccording to ([A-Z][\w-]+)(?:'s)?\s*(\w+)?/);
  return !!m && !/^(?:law|laws|theorem|rule|rules|principle|algorithm|lemma|definition|model|theory|equation|formula|standard|normal)$/i.test(m[2] ?? '') && !/^(?:the|a|an|this|that)$/i.test(m[1]);
}

/**
 * Finds quiz questions that test the video's structure instead of the
 * learner's understanding. Heuristic safety net behind the prompt rules.
 */
export function reviewQuiz(text: string, ctx: LearningContext): QuizIssue[] {
  const orderingTaught = ORDER_IS_SUBJECT.test(ctx.conceptPath.join(' '));
  const issues: QuizIssue[] = [];
  for (const q of quizQuestions(text)) {
    const hit = METADATA.find((m) => m.re.test(q.text) && !(m.ordering && orderingTaught));
    const reason = hit?.reason ?? (citesPerson(q.text) ? 'asks what a person said instead of testing the concept' : null);
    if (reason) issues.push({ question: q.n, text: q.text, reason });
  }
  return issues;
}

/** A follow-up instruction when an answer needs one revision, else null. */
export function reviewAnswer(action: AiAction, answer: string, ctx: LearningContext): string | null {
  if (action !== 'quiz') return null;
  const issues = reviewQuiz(answer, ctx);
  if (!issues.length) return null;
  return [
    'Some questions in the draft quiz above test the course or video instead of understanding of the subject:',
    ...issues.map((i) => `- Question ${i.question} ${i.reason}: "${i.text}"`),
    'Rewrite the whole quiz following every rule in the task, replacing those questions with questions about the concepts themselves. Return only the quiz, in the same format.',
  ].join('\n');
}
