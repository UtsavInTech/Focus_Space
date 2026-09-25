import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildLearningContext, describeMoment, transcriptWindow } from '../context/context';
import { buildKnowledgeMap } from '../knowledge/fuse';
import { conceptStops, locateConcept } from '../knowledge/locate';
import type { TranscriptSegment } from '../knowledge/types';
import { buildLearningPath } from '../path/path';
import { buildPrompt, quizQuestions, reviewAnswer, reviewQuiz, transcriptLanguage, WINDOW_FOR } from './actions';
import { aiCacheKey, createAiService, type AiAvailability, type AiProvider, type AiRequest } from './service';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const map = buildKnowledgeMap({
  videoId: 'v18',
  durationSec: 3600,
  chapters: [],
  description: ['0:00 Introduction', '4:12 What is a Linked List', '12:40 Node structure', '17:32 Insertion at beginning', '21:00 Insertion at end', '25:10 Insertion in middle', '29:15 Deletion', '52:10 Reversal'].join('\n'),
  comments: null,
  transcript: null,
  now: 0,
});
const path = buildLearningPath(
  { id: 'PLjava', title: 'Java DSA Complete Series', kind: 'playlist', items: Array.from({ length: 22 }, (_, i) => ({ videoId: `v${i + 1}`, title: `Lecture ${i + 1}`, index: i + 1 })) },
  'playlist',
  'v18',
  new Map([['v17', 1]]),
);
/** A 3-hour transcript: a sentence every 5 seconds. */
const transcript: TranscriptSegment[] = Array.from({ length: 2160 }, (_, i) => ({ startSec: i * 5, durSec: 5, text: `Sentence ${i} about linked lists and pointers.` }));

const contextAt = (currentTime: number) =>
  buildLearningContext({ video: { id: 'v18', title: 'Lecture 18 — Linked List', channelTitle: 'Apna College' }, mode: dsa, topicId: 'linked-lists', path, map, transcript, currentTime });

describe('learning context', () => {
  it('describes the moment: concept, neighbours, course position and the learning path', () => {
    const ctx = contextAt(1052);
    expect(ctx).toMatchObject({
      videoId: 'v18',
      timestamp: '17:32',
      currentConcept: 'Insertion at beginning',
      conceptPath: ['Insertion', 'Insertion at beginning'],
      previousConcepts: ['Introduction', 'What is a Linked List', 'Node structure'],
      playlist: { title: 'Java DSA Complete Series', position: 18, total: 22, next: 'Lecture 19', nextLabel: 'Next in this playlist' },
      mode: { id: 'dsa', name: 'DSA' },
    });
    expect(ctx.upcomingConcepts[0]).toBe('Insertion at end');
    expect(ctx.learningPath.topics.length).toBeGreaterThan(3);
    // Unrelated to the space: no misleading topic path.
    const unrelated = buildLearningContext({ video: { id: 'bio', title: 'Photosynthesis', channelTitle: 'x' }, mode: dsa, topicId: null, path: null, map, transcript, currentTime: 1052 });
    expect(unrelated.learningPath).toEqual({ topics: [], currentTopic: null });
    expect(buildPrompt('quiz', unrelated).user).not.toContain('Learning path:');
  });

  it('answers "what am I learning?" locally', () => {
    const { headline, lines } = describeMoment(contextAt(1052));
    expect(headline).toBe('Insertion at beginning');
    expect(lines.join(' ')).toContain('#18 of 22');
    expect(lines.join(' ')).toContain('Coming up: Insertion at end');
  });

  it('selects a short transcript window around the moment, not the whole transcript', () => {
    const w = transcriptWindow(transcript, 1052)!;
    expect(w.startSec).toBeGreaterThanOrEqual(1052 - 95);
    expect(w.endSec).toBeLessThanOrEqual(1052 + 30);
    expect(w.text.length).toBeLessThanOrEqual(2400);
    // Never reaches far back into the previous concept.
    const tight = transcriptWindow(transcript, 1070, { conceptStartSec: 1052 })!;
    expect(tight.startSec).toBeGreaterThanOrEqual(1035);
    // Size-capped, keeping what was just said.
    const capped = transcriptWindow(transcript, 1052, { maxChars: 300 })!;
    expect(capped.text.length).toBeLessThanOrEqual(300);
    expect(capped.text).toContain('Sentence 210 ');
    expect(transcriptWindow(null, 10)).toBeNull();
  });

  it('builds prompts from the moment only', () => {
    const ctx = contextAt(1052);
    const prompt = buildPrompt('ask', ctx, 'Why is prev required here?');
    expect(prompt.user).toContain('Timestamp: 17:32');
    expect(prompt.user).toContain('Current concept: Insertion › Insertion at beginning');
    expect(prompt.user).toContain('Why is prev required here?');
    expect(prompt.user).toContain('Course: Java DSA Complete Series, video #18 of 22; next: Lecture 19');
    expect(prompt.user.length).toBeLessThan(4000); // 3 hours of transcript never reach the model
    expect(prompt.system).toMatch(/never invent/i);
    const quiz = buildPrompt('quiz', ctx).user;
    expect(quiz).toContain('3-question quiz');
    expect(quiz).toContain('Never ask about');
    expect(quiz.indexOf('[Orientation')).toBeLessThan(quiz.indexOf('Course: Java DSA'));
    expect(quiz.indexOf('[Being taught now]')).toBeLessThan(quiz.indexOf('Current concept:'));
  });
});

function fakeProvider(availability: AiAvailability = 'available', replies?: string[]) {
  const calls: AiRequest[] = [];
  const prompts: string[] = [];
  const provider: AiProvider = {
    id: 'endpoint',
    label: 'Test',
    availability: async () => availability,
    complete: async (prompt, request) => {
      calls.push(request);
      prompts.push(prompt.user);
      await new Promise((r) => setTimeout(r, 5));
      return replies?.[calls.length - 1] ?? `answer ${calls.length}`;
    },
  };
  return { provider, calls, prompts };
}

describe('AI service', () => {
  it('only calls the provider when asked, and caches the answer for that moment', async () => {
    const { provider, calls } = fakeProvider();
    const ai = createAiService({ providers: () => [provider] });
    const first = await ai.run({ action: 'explain', context: contextAt(1060) });
    const again = await ai.run({ action: 'explain', context: contextAt(1075) });
    expect(first).toMatchObject({ ok: true, answer: 'answer 1', cached: false });
    expect(again).toMatchObject({ ok: true, answer: 'answer 1', cached: true });
    expect(calls).toHaveLength(1);
    await ai.run({ action: 'ask', context: contextAt(1060), question: 'Why prev?' });
    await ai.run({ action: 'ask', context: contextAt(1060), question: '  why   PREV? ' });
    await ai.run({ action: 'ask', context: contextAt(1060), question: 'What is head?' });
    expect(calls).toHaveLength(3);
  });

  it('shares one request between identical concurrent asks', async () => {
    const { provider, calls } = fakeProvider();
    const ai = createAiService({ providers: () => [provider] });
    const [a, b] = await Promise.all([ai.run({ action: 'quiz', context: contextAt(1052) }), ai.run({ action: 'quiz', context: contextAt(1100) })]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('reports unavailability instead of calling anything', async () => {
    const { provider, calls } = fakeProvider('downloadable');
    const ai = createAiService({ providers: () => [provider] });
    expect(await ai.run({ action: 'explain', context: contextAt(1052) })).toMatchObject({ ok: false, code: 'unavailable' });
    expect(await ai.status()).toMatchObject({ provider: 'endpoint', availability: 'downloadable' });
    expect(await createAiService({ providers: () => [] }).status()).toMatchObject({ provider: null, availability: 'unavailable' });
    expect(await ai.run({ action: 'ask', context: contextAt(1052), question: '   ' })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it('keys answers by moment: nearby seconds share, other concepts and questions do not', () => {
    const at = (t: number, extra: Partial<AiRequest> = {}) => aiCacheKey({ action: 'explain', context: contextAt(t), ...extra });
    expect(at(1060)).toBe(at(1075));
    expect(at(1060)).not.toBe(at(1265));
    expect(aiCacheKey({ action: 'quiz', context: contextAt(1052) })).toBe(aiCacheKey({ action: 'quiz', context: contextAt(1250) }));
  });

  it('Layer 2C: a quota_exceeded error from the provider is surfaced with that code, not the generic "failed"', async () => {
    const provider: AiProvider = {
      id: 'endpoint',
      label: 'Test',
      availability: async () => 'available',
      complete: async () => {
        const err = new Error("You've used all 5 AI actions included this period.");
        (err as Error & { code?: string }).code = 'quota_exceeded';
        throw err;
      },
    };
    const ai = createAiService({ providers: () => [provider] });
    const result = await ai.run({ action: 'explain', context: contextAt(1052) });
    expect(result).toMatchObject({ ok: false, code: 'quota_exceeded', error: "You've used all 5 AI actions included this period." });

    const chatResult = await ai.chat({ context: contextAt(1052), history: [], question: 'hi' });
    expect(chatResult).toMatchObject({ ok: false, code: 'quota_exceeded' });
  });

  it('an ordinary provider failure (no code attached) still reports the generic "failed"', async () => {
    const provider: AiProvider = {
      id: 'endpoint',
      label: 'Test',
      availability: async () => 'available',
      complete: async () => {
        throw new Error('Network error');
      },
    };
    const ai = createAiService({ providers: () => [provider] });
    expect(await ai.run({ action: 'explain', context: contextAt(1052) })).toMatchObject({ ok: false, code: 'failed' });
  });

  it('playback never reaches the AI: an hour of timeupdates is resolved locally', async () => {
    const { provider, calls } = fakeProvider();
    createAiService({ providers: () => [provider] });
    const stops = conceptStops(map);
    const seen = new Set<string>();
    for (let t = 0; t < 3600; t += 0.25) seen.add(locateConcept(stops, t).current?.id ?? 'none');
    // A parent that starts with its first child is never itself "current".
    expect(seen.size).toBe(stops.filter((s) => !stops.some((o) => o.ancestors.some((a) => a.id === s.node.id) && o.node.startSec === s.node.startSec)).length);
    expect(calls).toHaveLength(0);
  });
});

/** The quiz FocusSpace produced for "Filtering Data" in the SQL course (on-device AI, 2:08:07). */
const METADATA_QUIZ = `Here are 3 questions to check understanding based on the transcript:

**Questions:**

1.  What SQL concept is introduced as the first topic in the intermediate level?
    (a) Data Definition Language (DDL)
    (b) Data Manipulation Language (DML)
    (c) Data Filtering
    (d) Transactions
2.  According to Baraa, what is the next chapter's focus in SQL?
    (a) Joins
    (b) Aggregation
    (c) Filtering Data
    (d) Indexes
3.  Which type of operator is mentioned after comparison operators?
    (a) Set Operators
    (b) Logical Operators
    (c) DDL Commands
    (d) Transactions

**Answers:**

1.  (c) Data Filtering
2.  (c) Filtering Data
3.  (b) Logical Operators`;

const CONCEPT_QUIZ = `1. Which SQL clause restricts rows based on a condition before any grouping happens?
   A) HAVING
   B) WHERE
   C) ORDER BY
   D) GROUP BY
2. Given employees(name, salary), which condition returns salaries from 40,000 to 60,000 inclusive?
   A) salary > 40000 AND salary < 60000
   B) salary BETWEEN 40000 AND 60000
   C) salary IN (40000, 60000)
   D) salary LIKE '4%'
3. Which logical operator requires both conditions to be true?
   A) OR
   B) NOT
   C) AND
   D) IN
Answers:
1. B — WHERE filters rows; HAVING filters groups.
2. B — BETWEEN is inclusive on both ends.
3. C — AND is true only when both sides are true.`;

describe('quiz quality: test the subject, not the course', () => {
  const sql = { ...contextAt(7687), videoTitle: 'SQL Full Course for Beginners (30 Hours) – From Zero to Hero', channel: 'Data with Baraa', conceptPath: ['Intermediate Level', 'Filtering Data'], currentConcept: 'Filtering Data', previousConcepts: ['DDL Commands', 'DML Commands'], upcomingConcepts: ['SQL Joins (Basics)'] };

  it('reads the questions of a quiz, not its options or answers', () => {
    expect(quizQuestions(METADATA_QUIZ).map((q) => q.n)).toEqual([1, 2, 3]);
    expect(quizQuestions(CONCEPT_QUIZ).map((q) => q.text)[1]).toContain('BETWEEN'.length ? 'salaries from 40,000' : '');
  });

  it('flags every question from the metadata quiz learners saw', () => {
    const issues = reviewQuiz(METADATA_QUIZ, sql);
    expect(issues.map((i) => i.question)).toEqual([1, 2, 3]);
    expect(issues[0].reason).toMatch(/level/);
    expect(issues[1].reason).toMatch(/course|what a person said|comes next|instructor/);
    expect(issues[2].reason).toMatch(/order/);
  });

  it('accepts questions about the concepts themselves', () => {
    expect(reviewQuiz(CONCEPT_QUIZ, sql)).toEqual([]);
    const fine = `1. According to Codd's rules, what must every table have?\n2. In Python, which function in the math module returns a square root?\n3. Which isolation level prevents dirty reads?\n4. What is the sum of the Taylor series for e^x at x = 0?\nAnswers:\n1. A`;
    expect(reviewQuiz(fine, sql)).toEqual([]);
  });

  it('allows questions about an ordering when the ordering is what is being taught', () => {
    const order = '1. Which clause comes after FROM in logical query processing?\nAnswers:\n1. WHERE';
    expect(reviewQuiz(order, sql)).toHaveLength(1);
    expect(reviewQuiz(order, { ...sql, conceptPath: ['SQL Query Execution Order'] })).toEqual([]);
  });

  it('asks the model once to replace metadata questions, and keeps the revised quiz', async () => {
    const { provider, calls, prompts } = fakeProvider('available', [METADATA_QUIZ, CONCEPT_QUIZ]);
    const ai = createAiService({ providers: () => [provider] });
    const result = await ai.run({ action: 'quiz', context: sql });
    expect(result).toMatchObject({ ok: true, answer: CONCEPT_QUIZ });
    expect(calls).toHaveLength(2);
    expect(prompts[1]).toContain('Draft:');
    expect(prompts[1]).toContain('Question 2');
    expect(reviewAnswer('quiz', CONCEPT_QUIZ, sql)).toBeNull();
    expect(reviewAnswer('explain', METADATA_QUIZ, sql)).toBeNull();
    // A good first draft costs one request.
    const good = fakeProvider('available', [CONCEPT_QUIZ]);
    await createAiService({ providers: () => [good.provider] }).run({ action: 'quiz', context: sql });
    expect(good.calls).toHaveLength(1);
  });

  it('gives quizzes the section being taught, not only the last seconds', () => {
    const at = (window?: typeof WINDOW_FOR.quiz) => buildLearningContext({ video: { id: 'v18', title: 'Lecture 18', channelTitle: 'x' }, mode: dsa, topicId: null, path, map, transcript, currentTime: 1060, window }).transcriptWindow!;
    expect(at().startSec).toBeGreaterThanOrEqual(1025);
    expect(at(WINDOW_FOR.quiz).startSec).toBeLessThanOrEqual(915);
    expect(at(WINDOW_FOR.quiz).text.length).toBeLessThanOrEqual(4500);
  });
});

describe('transcript language', () => {
  it('recognises Hindi captions, including ones that mix in English terms', () => {
    expect(transcriptLanguage('अब हम array के अंदर binary search लगाएंगे और देखेंगे कि mid कैसे निकलता है')).toBe('Hindi (Devanagari script)');
  });

  it('leaves English and romanised Hinglish unlabelled', () => {
    expect(transcriptLanguage('Now we apply binary search inside the array and see how mid is computed')).toBeNull();
    expect(transcriptLanguage('ab hum array ke andar binary search lagayenge aur dekhenge ki mid kaise nikalta hai')).toBeNull();
  });

  it('flags other non-Latin scripts without guessing their name', () => {
    expect(transcriptLanguage('今日は配列の中で二分探索を使って、真ん中の値をどうやって求めるかを見ていきます')).toBe('a language other than English');
  });

  it('asks for English output over a Hindi transcript when no response language is set', () => {
    const hindi: TranscriptSegment[] = Array.from({ length: 60 }, (_, i) => ({ startSec: i * 5, durSec: 5, text: `यहाँ हम पॉइंटर ${i} को अगले नोड पर ले जाते हैं।` }));
    const ctx = (language: 'en' | 'hi') =>
      buildLearningContext({ video: { id: 'v', title: 'Linked List', channelTitle: 'C' }, mode: DEFAULT_MODES[0], topicId: null, path: null, map: null, transcript: hindi, currentTime: 200, language });
    expect(buildPrompt('explain', ctx('en')).user).toMatch(/Respond in English, translating/);
    expect(buildPrompt('explain', ctx('hi')).user).not.toMatch(/Respond in English/);
  });
});
