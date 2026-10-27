import { describe, expect, it } from 'vitest';
import { belongsToSpace, interleave, seriesSearchQuery } from './next';

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

describe('Continue learning keeps to the Space', () => {
  const upsc = { id: 'upsc', kind: 'learning' as const };
  it('drops a song played while UPSC was on, since it matched no UPSC topic', () => {
    expect(belongsToSpace({ modeId: 'upsc', topicId: null }, upsc, () => false)).toBe(false);
  });
  it('keeps a lesson filed under a UPSC topic, and anything that matches UPSC on its own', () => {
    expect(belongsToSpace({ modeId: 'upsc', topicId: 'prelims-gs-polity' }, upsc, () => false)).toBe(true);
    expect(belongsToSpace({ modeId: 'dsa', topicId: null }, upsc, () => true)).toBe(true);
  });
  it('in a music Space, what was played there is enough', () => {
    expect(belongsToSpace({ modeId: 'music', topicId: null }, { id: 'music', kind: 'media' as const }, () => false)).toBe(true);
  });
});
