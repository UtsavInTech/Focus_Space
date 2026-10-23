import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_MODES } from '@/modes/templates';
import { QuizCards, QuizSession } from '@/content/ui/QuizCards';
import { buildLearningContext } from '../context/context';
import type { TranscriptSegment } from '../knowledge/types';
import { buildPrompt, buildQuizMorePrompt, QUIZ_QUESTIONS } from './actions';
import { formatQuiz, nearDuplicate, parseQuiz } from './quiz-format';
import { QUIZ_MAX_QUESTIONS, quizBlocks } from './quiz-plan';
import { aiCacheKey, createAiService, type AiProvider } from './service';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const video = { id: 'quizvid0001', title: 'Sorting — Full Course', channelTitle: 'C' };
const transcript: TranscriptSegment[] = Array.from({ length: 900 }, (_, i) => ({ startSec: i * 4, durSec: 4, text: `Line ${i}: merge sort splits the list, quicksort picks a pivot.` }));
const moment = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript, currentTime: 1200 });
const whole = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript, currentTime: 1200, range: { startSec: 0, endSec: 3600 }, window: { maxChars: 12000 } });

describe('quiz rounds', () => {
  it('asks for five questions, with a reason that explains the tempting wrong option', () => {
    const { user } = buildPrompt('quiz', moment);
    expect(QUIZ_QUESTIONS).toBe(5);
    expect(user).toContain('5-question quiz');
    expect(user).toContain('why the most tempting wrong option is wrong');
  });

  it('builds a "More questions" prompt over the whole video that never repeats what was asked', () => {
    const previous = Array.from({ length: 30 }, (_, i) => `Question number ${i} about pivots`);
    const { user } = buildQuizMorePrompt(whole, { scope: 'video', previous });
    expect(user).toContain('Write 5 NEW quiz questions on the whole video');
    expect(user).toContain('spread the questions across different topics');
    expect(user).toContain('- Question number 29 about pivots');
    // Only the newest 20 earlier questions are listed.
    expect(user).not.toContain('- Question number 9 about pivots');
    expect(user).toContain('Answers:');
    expect(user.length).toBeLessThan(24_000);
  });

  it('names the span for a round on the part being taught', () => {
    const section = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript, currentTime: 1200, range: { startSec: 900, endSec: 1800 }, window: { maxChars: 9000 } });
    expect(buildQuizMorePrompt(section, { scope: 'section', previous: [] }).user).toContain('the whole part of the video being taught around this moment (15:00–30:00)');
  });

  it('keeps each round its own answer in the cache', async () => {
    const first = aiCacheKey({ action: 'quiz', context: moment });
    const more = aiCacheKey({ action: 'quiz', context: moment, quiz: { scope: 'video', previous: ['a'] } });
    const later = aiCacheKey({ action: 'quiz', context: moment, quiz: { scope: 'video', previous: ['a', 'b'] } });
    expect(new Set([first, more, later]).size).toBe(3);

    const prompts: string[] = [];
    const provider: AiProvider = { id: 'endpoint', label: 'Test', availability: async () => 'available', complete: async (p) => (prompts.push(p.user), '1. Q?\nA) x\nB) y\nAnswers:\n1. A — because') };
    const ai = createAiService({ providers: () => [provider] });
    await ai.run({ action: 'quiz', context: whole, quiz: { scope: 'video', previous: ['What is a pivot?'] } });
    expect(prompts[0]).toContain('NEW quiz questions');
    expect(prompts[0]).toContain('- What is a pivot?');
  });

  it('walks a video five questions per 15 minutes, never more than 100 questions', () => {
    expect(quizBlocks(0, 30)).toEqual([]);
    expect(quizBlocks(0, 600)).toEqual([{ startSec: 0, endSec: 600 }]);
    expect(quizBlocks(0, 3600)).toHaveLength(4);
    expect(quizBlocks(0, 3600)[1]).toEqual({ startSec: 900, endSec: 1800 });
    const sixHours = quizBlocks(0, 6 * 3600);
    expect(sixHours.length * 5).toBe(QUIZ_MAX_QUESTIONS);
    expect(sixHours[sixHours.length - 1].endSec).toBe(6 * 3600);
  });

  it('asks a round about its own span, at the chosen difficulty, with one checked key', () => {
    const block = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript, currentTime: 900, range: { startSec: 900, endSec: 1800 }, window: { maxChars: 12000 } });
    const { user } = buildQuizMorePrompt(block, { scope: 'span', previous: [], difficulty: 'hard' });
    expect(user).toContain('this part of the video (15:00–30:00)');
    expect(user).toContain('Difficulty: hard');
    expect(user).toContain('Exactly one option is correct');
    expect(buildQuizMorePrompt(block, { scope: 'span', previous: [] }).user).not.toContain('Difficulty:');
    // Two spans with nothing asked yet are still two answers.
    const other = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript, currentTime: 0, range: { startSec: 0, endSec: 900 }, window: { maxChars: 12000 } });
    expect(aiCacheKey({ action: 'quiz', context: block, quiz: { scope: 'span', previous: [] } })).not.toBe(aiCacheKey({ action: 'quiz', context: other, quiz: { scope: 'span', previous: [] } }));
  });

  it('writes a checked quiz back in the shape the panel reads', () => {
    const quiz = parseQuiz('1. What does this print?\n```c\nprintf("%d", 7 / 2);\n```\nA) 3.5\nB) 3\nAnswers:\n1. B, integer division.')!;
    expect(parseQuiz(formatQuiz(quiz))).toEqual(quiz);
  });

  it('spots the same question asked again in other words, not two questions on one topic', () => {
    const a = 'What does this print?\n```c\nint a[] = {6, 2, 0, 4, 5};\nfor (int i = 0; i < 5; i++) printf("%d", a[i]);\n```';
    const b = 'What is the output of the loop below?\n```c\nint a[] = {6, 2, 0, 4, 5};\nfor (int i = 0; i < 5; i++) printf("%d", a[i]);\n```';
    expect(nearDuplicate(a, b)).toBe(true);
    expect(nearDuplicate('Which index holds the first element of an array?', 'Which index holds the first element of a C array?')).toBe(true);
    expect(nearDuplicate('What is the time complexity of reading arr[i]?', 'Why must binary search run on a sorted array?')).toBe(false);
  });

  it('renders options as buttons, with the answer held back until one is picked', () => {
    const quiz = parseQuiz('1. Is quicksort stable?\nA) Yes\nB) No\nAnswers:\n1. B, equal keys can swap.')!;
    const html = renderToStaticMarkup(createElement(QuizCards, { questions: quiz, picked: {}, onPick: () => undefined }));
    expect(html.match(/class="fs-quiz-option /g)).toHaveLength(2);
    expect(html).not.toContain('equal keys can swap');
  });

  it('asks where to quiz from first, needs an account on FocusSpace AI, and keeps difficulty for paid plans', () => {
    const base = { watchedSec: 1500, durationSec: 3600, needsAccount: true, onRound: async () => ({ ok: true as const, text: '' }) };
    expect(renderToStaticMarkup(createElement(QuizSession, { ...base, signedIn: false, extras: false }))).toContain('Sign in to use Quiz me');
    const free = renderToStaticMarkup(createElement(QuizSession, { ...base, signedIn: true, extras: false }));
    expect(free).toContain('Watched so far');
    expect(free).toContain('2 parts of 15 questions');
    expect(free).toContain('Full video');
    expect(free).toContain('4 parts of 15 questions');
    // The length chooser is for everyone; the difficulty chooser is not.
    expect(free).toContain('How many questions?');
    expect(free).not.toContain('aria-label="Difficulty"');
    expect(free).toContain('come with Plus');
    const paid = renderToStaticMarkup(createElement(QuizSession, { ...base, signedIn: true, extras: true }));
    expect(paid).toContain('Hard');
    expect(paid).not.toContain('come with Plus');
    // Someone's own AI endpoint or the on-device model: no account involved.
    expect(renderToStaticMarkup(createElement(QuizSession, { ...base, needsAccount: false, signedIn: false, extras: false }))).toContain('Watched so far');
  });

  it('lets the learner choose 5–20 questions, within the plan on FocusSpace AI and freely on-device', () => {
    const base = { watchedSec: 1500, durationSec: 3600, needsAccount: true, signedIn: true, extras: false, onRound: async () => ({ ok: true as const, text: '' }) };
    const free = renderToStaticMarkup(createElement(QuizSession, { ...base, remaining: 5 }));
    expect(free.match(/role="radio"[^>]*disabled=""/g)).toHaveLength(3); // 10, 15 and 20 are past this month's allowance
    expect(free).toContain('5 left this month');
    const onDevice = renderToStaticMarkup(createElement(QuizSession, { ...base, needsAccount: false, onDevice: true, remaining: null }));
    expect(onDevice).not.toContain('disabled=""');
    expect(onDevice).toContain('as many as you like, free');
  });
});
