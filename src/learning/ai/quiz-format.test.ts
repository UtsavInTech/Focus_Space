import { describe, expect, it } from 'vitest';
import { parseQuiz } from './quiz-format';

const QUIZ = `1. What does binary search require of its input?
   A) A linked list
   B) A sorted collection
   C) Unique values
   D) An even number of items
2. What does this print?
\`\`\`python
print(len([1, 2, 3]) // 2)
\`\`\`
   A) 1
   B) 1.5
   C) 2
   D) An error
Answers:
1. B — it halves a sorted range each step.
2. A — integer division of 3 by 2 is 1.`;

describe('parseQuiz', () => {
  it('reads questions, options and answers in the prompt’s format', () => {
    const quiz = parseQuiz(QUIZ)!;
    expect(quiz).toHaveLength(2);
    expect(quiz[0]).toEqual({
      n: 1,
      text: 'What does binary search require of its input?',
      options: [
        { letter: 'A', text: 'A linked list' },
        { letter: 'B', text: 'A sorted collection' },
        { letter: 'C', text: 'Unique values' },
        { letter: 'D', text: 'An even number of items' },
      ],
      answer: { letter: 'B', reason: 'it halves a sorted range each step.' },
    });
  });

  it('keeps a code snippet with its question, never as options', () => {
    const [, second] = parseQuiz(QUIZ)!;
    expect(second.text).toContain('```python');
    expect(second.text).toContain('print(len([1, 2, 3]) // 2)');
    expect(second.options.map((o) => o.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(second.answer).toEqual({ letter: 'A', reason: 'integer division of 3 by 2 is 1.' });
  });

  it('forgives the ways models drift: bold, "A." options, "**Answers:**", "1) Answer: C"', () => {
    const quiz = parseQuiz(['**1. Which is O(1)?**', 'A. Array index', 'B. Linear scan', '**Answers:**', '1) Answer: A - direct access'].join('\n'))!;
    expect(quiz[0].text).toBe('Which is O(1)?');
    expect(quiz[0].answer).toEqual({ letter: 'A', reason: 'direct access' });
  });

  it('still shows questions whose answers are missing', () => {
    expect(parseQuiz('1. Q?\nA) x\nB) y')![0].answer).toBeNull();
  });

  it('returns null for anything that is not a quiz, so it shows as ordinary text', () => {
    expect(parseQuiz('Binary search halves the range each time.')).toBeNull();
    expect(parseQuiz('1. First point\n2. Second point')).toBeNull();
    expect(parseQuiz('1. Q?\nA) x\nB) y\n2. A question with no options')).toBeNull();
  });
});
