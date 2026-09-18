import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildLearningContext } from '../context/context';
import { reviewQuiz } from './actions';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const ctx = { ...buildLearningContext({ video: { id: 'v1', title: 'x', channelTitle: 'y' }, mode: dsa, topicId: null, path: null, map: null, transcript: null, currentTime: 0 }), conceptPath: ['Linked Lists', 'Insertion'] };

describe('quiz quality guard (docs/V5_CONTRACT.md WS3 §7): metadata questions are rejected, real ones are not', () => {
  it('rejects every example from the user-specified "Bad" list', () => {
    const bad = [
      '1. What chapter comes next?',
      '2. What level is this?',
      '3. What lecture number is this?',
      '4. According to the creator, what is the next section?',
    ].join('\n');
    const issues = reviewQuiz(bad, ctx);
    expect(issues.map((i) => i.question)).toEqual([1, 2, 3, 4]);
  });

  it('accepts questions that test the concept: recall, distinction, reasoning, code, edge cases', () => {
    const good = [
      '1. What is the time complexity of inserting at the head of a singly linked list?',
      "2. What is the key difference between a singly and a doubly linked list?",
      '3. Given head -> A -> B -> C, what does head.next.next.value return?',
      '4. Write the code to insert a new node at the beginning of a linked list.',
      '5. What happens if you forget to update the head pointer after inserting at the beginning?',
    ].join('\n');
    expect(reviewQuiz(good, ctx)).toEqual([]);
  });

  it("a bare 'what level is this' is now caught even without naming beginner/intermediate/advanced", () => {
    const issues = reviewQuiz('1. What level is this section?', ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toMatch(/level|difficulty/);
  });
});
