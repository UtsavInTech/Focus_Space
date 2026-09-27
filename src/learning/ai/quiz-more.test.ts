import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_MODES } from '@/modes/templates';
import { QuizCards, moreScope } from '@/content/ui/QuizCards';
import { buildLearningContext } from '../context/context';
import type { TranscriptSegment } from '../knowledge/types';
import { buildPrompt, buildQuizMorePrompt, QUIZ_QUESTIONS } from './actions';
import { parseQuiz } from './quiz-format';
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

  it('goes moment → this part → whole video, skipping "this part" when there is none', () => {
    expect(moreScope(1, true)).toBe('section');
    expect(moreScope(2, true)).toBe('video');
    expect(moreScope(1, false)).toBe('video');
  });

  it('renders options as buttons, with the answer held back until one is picked', () => {
    const quiz = parseQuiz('1. Is quicksort stable?\nA) Yes\nB) No\nAnswers:\n1. B — equal keys can swap.')!;
    const html = renderToStaticMarkup(createElement(QuizCards, { questions: quiz, onMore: async () => ({ ok: true as const, text: '' }), hasSection: true }));
    expect(html.match(/class="fs-quiz-option /g)).toHaveLength(2);
    expect(html).not.toContain('equal keys can swap');
    expect(html).toContain('More questions from this part');
  });
});
