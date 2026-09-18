import { describe, expect, it } from 'vitest';
import type { SeriesSource } from '../next';
import { buildLearningPath } from './path';

const course = (n = 22, kind: SeriesSource['kind'] = 'playlist'): SeriesSource => ({
  id: 'PLjava',
  title: 'Java DSA Complete Series',
  kind,
  items: Array.from({ length: n }, (_, i) => ({ videoId: `v${i + 1}`, title: `Lecture ${i + 1}`, index: i + 1 })),
});
const watched = (entries: [number, number][]) => new Map(entries.map(([i, p]) => [`v${i}`, p] as [string, number]));
const states = (path: ReturnType<typeof buildLearningPath>) => Object.fromEntries(path.rows.map((r) => [r.item.index, r.state]));

describe('learning path: the creator playlist is the course', () => {
  it('finds the current video and the next one in playlist order', () => {
    const path = buildLearningPath(course(), 'playlist', 'v18', watched([[16, 1], [17, 0.9]]));
    expect(path.current?.index).toBe(18);
    expect(path.next?.index).toBe(19);
    expect(path.then.map((i) => i.index)).toEqual([20, 21, 22]);
    expect(path.nextLabel).toBe('Next in this playlist');
    expect(path.authoritative).toBe(true);
    expect(path.playlistId).toBe('PLjava');
    expect(states(path)).toMatchObject({ 16: 'watched', 17: 'watched', 18: 'current', 19: 'next', 20: 'unwatched' });
  });

  it('"next" is the next unwatched lecture, not index + 1', () => {
    const path = buildLearningPath(course(), 'playlist', 'v18', watched([[17, 1], [19, 0.95], [20, 0.88]]));
    expect(path.next?.index).toBe(21);
    expect(path.nextSkipsWatched).toBe(true);
    expect(path.nextLabel).toBe('Next unwatched in this playlist');
    expect(states(path)).toMatchObject({ 17: 'watched', 18: 'current', 19: 'watched', 20: 'watched', 21: 'next' });
  });

  it('opening a video is not watching it: partial progress stays unfinished', () => {
    const path = buildLearningPath(course(), 'playlist', 'v18', watched([[19, 0.3], [20, 0.02]]));
    expect(path.next?.index).toBe(19);
    expect(path.watchedCount).toBe(0);
  });

  it('marks lectures skipped before later ones were completed', () => {
    const progress = watched(Array.from({ length: 17 }, (_, i) => [i + 1, i + 1 === 15 ? 0 : 1] as [number, number]));
    const path = buildLearningPath(course(), 'playlist', 'v18', progress);
    expect(path.skipped.map((s) => s.index)).toEqual([15]);
    expect(states(path)[15]).toBe('skipped');
    // Rows are ordered by position and report what was hidden between them.
    expect(path.rows.map((r) => r.item.index)).toEqual([...path.rows.map((r) => r.item.index)].sort((a, b) => a - b));
    expect(path.rows[0].hiddenBefore).toBe(14);
  });

  it('starting mid-course is not "skipping"', () => {
    expect(buildLearningPath(course(), 'playlist', 'v18', new Map()).skipped).toEqual([]);
  });

  it('keeps the window short when the next unwatched lecture is far away', () => {
    const progress = watched(Array.from({ length: 10 }, (_, i) => [i + 5, 1] as [number, number]));
    const path = buildLearningPath(course(), 'playlist', 'v4', progress);
    expect(path.next?.index).toBe(15);
    expect(path.rows.length).toBeLessThanOrEqual(9);
    expect(path.rows.some((r) => r.hiddenBefore > 0)).toBe(true);
  });

  it('a creator playlist found from the description is still a real playlist', () => {
    expect(buildLearningPath(course(), 'creator-playlist', 'v3', new Map()).nextLabel).toBe('Next in this playlist');
  });
});

describe('learning path: guessed series are labelled as guesses', () => {
  it('numbered titles with neighbours → "Next in this series"', () => {
    const path = buildLearningPath(course(8, 'numbered'), 'series', 'v4', new Map());
    expect(path.authoritative).toBe(false);
    expect(path.playlistId).toBeNull();
    expect(path.nextLabel).toBe('Next in this series');
  });

  it('sparse numbering → "Appears to be next"', () => {
    const sparse: SeriesSource = { ...course(0, 'numbered'), items: [3, 9, 14].map((n) => ({ videoId: `v${n}`, title: `Lecture ${n}`, index: n })) };
    expect(buildLearningPath(sparse, 'series', 'v9', new Map()).nextLabel).toBe('Appears to be next');
  });
});
