import { describe, expect, it } from 'vitest';
import { interleave, seriesSearchQuery } from './next';

describe('finding the next episode by search', () => {
  it('uses the series’ own word for an episode', () => {
    expect(seriesSearchQuery('Lecture 104: Deep Copy a Linked List || Linked List Series Day-27', 'CodeHelp - by Babbar', 105)).toBe('CodeHelp - by Babbar Lecture 105');
    expect(seriesSearchQuery('L18. Implement LRU Cache | Stack Playlist', 'take U forward', 19)).toBe('take U forward L 19');
    expect(seriesSearchQuery('Day 12 of 100 days of code', 'Someone', 13)).toBe('Someone Day 13');
  });

  it('gives up on titles that are not numbered episodes', () => {
    expect(seriesSearchQuery('Winning Speech (Music Video) Karan Aujla', 'Karan Aujla', 2)).toBeNull();
  });
});

describe('more than one series at once', () => {
  it('takes turns, so every series gets its next episode in', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });
});
