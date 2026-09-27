import { describe, expect, it } from 'vitest';
import { parseQuiz } from '@/learning/ai/quiz-format';
import { checkQuiz, type QuizCheckConfig } from './check';

const config: QuizCheckConfig = { openRouterKey: 'or-test', openAiKey: 'oa-test', judgeModel: 'typesafe/jev-1.13', settleModel: 'gpt-5-mini' };

const QUIZ = `1. What does this print?
\`\`\`c
int a[] = {6, 2, 0, 4, 5};
for (int i = 0; i < 5; i++) printf("%d", a[i]);
\`\`\`
   A) 6 2 0 4 5
   B) 62045
   C) 6,2,0,4,5
2. What does \`7 / 2\` give in C?
   A) 3.5
   B) 3
3. Which loop visits all 5 elements?
   A) for (i = 0; i < 5; i++)
   B) for (i = 0; i <= 4; i++)
   C) for (i = 1; i <= 5; i++)
4. What is the output of the loop below?
\`\`\`c
int a[] = {6, 2, 0, 4, 5};
for (int i = 0; i < 5; i++) printf("%d", a[i]);
\`\`\`
   A) 62045
   B) 6 2 0 4 5

Answers:
1. A, it prints each number.
2. B, integer division drops the fraction.
3. A, it starts at 0 and stops before 5.
4. A, no separator is printed.`;

/** Jev and the settle model, answering as the real ones did in the evaluation. */
function fakeUpstream(calls: string[], judgeFails = false) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('openrouter.ai')) {
      calls.push('judge');
      if (judgeFails) return new Response('{}', { status: 402 });
      const q: string = body.state.question;
      const probabilities = q.includes('printf') ? { A: 0.01, B: 0.99, C: 0, NONE: 0 } : q.includes('7 / 2') ? { A: 0, B: 1, NONE: 0 } : { A: 0.98, B: 0.02, C: 0, NONE: 0 };
      const single = q.includes('Which loop') ? 0.06 : 0.97;
      return Response.json({ answers: { answer: { probabilities }, single: { noul: single } } });
    }
    calls.push('settle');
    const q: string = body.messages[1].content;
    const verdict = q.includes('printf') ? { correct_options: ['B'], reason: 'No space is printed, so the digits run together.' } : q.includes('Which loop') ? { correct_options: ['A', 'B'] } : { correct_options: ['B'], reason: 'Integer division.' };
    return Response.json({ choices: [{ message: { content: JSON.stringify(verdict) } }] });
  }) as typeof fetch;
}

describe('quiz check', () => {
  it('fixes a wrong key, drops a question with two right answers, drops a repeat, and passes the rest untouched', async () => {
    const calls: string[] = [];
    const result = await checkQuiz(QUIZ, 'transcript', config, undefined, fakeUpstream(calls));
    const shown = parseQuiz(result.text)!;
    expect(shown).toHaveLength(2);
    expect(shown[0].answer).toEqual({ letter: 'B', reason: 'No space is printed, so the digits run together.' });
    expect(shown[1].answer?.letter).toBe('B');
    expect(shown[1].answer?.reason).toBe('integer division drops the fraction.');
    expect(result).toMatchObject({ shown: 2, fixed: 1, dropped: 2, settled: 2 });
    // The repeat never reached a model; the settle model only saw what the judge flagged.
    expect(calls.filter((c) => c === 'judge')).toHaveLength(3);
    expect(calls.filter((c) => c === 'settle')).toHaveLength(2);
  });

  it('never shows an unchecked question: without the judge, everything is settled', async () => {
    const calls: string[] = [];
    const result = await checkQuiz(QUIZ, 'transcript', config, undefined, fakeUpstream(calls, true));
    expect(result.shown).toBe(2);
    expect(calls.filter((c) => c === 'settle')).toHaveLength(3);
    const noJudge = await checkQuiz(QUIZ, 'transcript', { ...config, openRouterKey: null }, undefined, fakeUpstream([]));
    expect(noJudge.shown).toBe(2);
  });

  it('fails rather than showing a quiz nothing in which survived', async () => {
    const broken = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    await expect(checkQuiz(QUIZ, 'transcript', config, undefined, broken)).rejects.toThrow(/passed its check/);
    await expect(checkQuiz('Sorry, no quiz today.', 'transcript', config, undefined, broken)).rejects.toThrow(/passed its check/);
  });
});

describe('repeated options', () => {
  const q = (options: string[], key: string) => ({ n: 1, text: 'Q', options: options.map((text, i) => ({ letter: 'ABCD'[i], text })), answer: { letter: key, reason: 'r' } });
  it('drops a repeated wrong option and moves the key with its option', async () => {
    const { distinctOptions } = await import('./check');
    const fixed = distinctOptions(q(['4 5 6', '456', '4\\n5\\n6', '4 5 6'], 'B'))!;
    expect(fixed.options.map((o) => o.text)).toEqual(['4 5 6', '456', '4\\n5\\n6']);
    expect(fixed.answer?.letter).toBe('B');
    const later = distinctOptions(q(['4 5 6', '4 5 6', '456'], 'C'))!;
    expect(later.options.map((o) => o.letter + o.text)).toEqual(['A4 5 6', 'B456']);
    expect(later.answer?.letter).toBe('B');
  });
  it('drops the question when the key is one of two identical options', async () => {
    const { distinctOptions } = await import('./check');
    expect(distinctOptions(q(['456', '4 5 6', '456'], 'C'))).toBeNull();
    expect(distinctOptions(q(['456', '4 5 6', '456'], 'A'))).toBeNull();
  });
});
