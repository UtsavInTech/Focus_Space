import { describe, expect, it } from 'vitest';
import { buildPassages, findRelatedPassages, MAX_RELATED_CHARS, MAX_RELATED_PASSAGES } from './passages';
import type { TranscriptSegment } from './types';

/** A lecture as caption lines: `lines` are spoken one per `every` seconds from `startSec`. */
const spoken = (startSec: number, lines: string[], every = 5): TranscriptSegment[] => lines.map((text, i) => ({ startSec: startSec + i * every, durSec: every, text }));

const filler = (n: number, topic: string) => Array.from({ length: n }, (_, i) => `Now in this part we keep going with ${topic}, step ${i}, so follow along with the code on screen.`);

// A two-hour DSA lecture: arrays, hashing (with collisions at ~40 min), sorting (quicksort stability at ~75 min), then graphs.
const lecture: TranscriptSegment[] = [
  ...spoken(0, filler(240, 'arrays and indexing')),
  ...spoken(1200, filler(120, 'hash tables and hash functions')),
  ...spoken(1800, filler(120, 'hash tables and buckets')),
  ...spoken(2400, [
    'When two keys land in the same bucket we get a collision.',
    'Collisions are handled with chaining, a linked list in each bucket.',
    'Open addressing is the other way to resolve a collision, by probing the next slot.',
    'With too many collisions the lookup degrades to linear time.',
  ]),
  ...spoken(2420, filler(236, 'hash maps in practice')),
  ...spoken(3600, filler(180, 'sorting algorithms')),
  ...spoken(4500, [
    'Quicksort is not a stable sort.',
    'Stable means equal elements keep their original relative order.',
    'Quicksort swaps elements across the pivot, so equal keys can change order, which is why quicksort is not stable.',
    'Merge sort, on the other hand, is stable.',
  ]),
  ...spoken(4520, filler(256, 'graphs and traversal')),
];

describe('buildPassages', () => {
  it('cuts ~45–60 second passages with exact times, covering every segment once', () => {
    const passages = buildPassages(lecture);
    for (const p of passages.slice(0, -1)) {
      // Long enough to hold an idea — 45 s, or ~500 characters when the speech is dense — and never past 60 s.
      expect(p.endSec - p.startSec >= 45 || p.text.length >= 500).toBe(true);
      expect(p.endSec - p.startSec).toBeLessThanOrEqual(60);
      expect(p.text.length).toBeLessThanOrEqual(900);
    }
    expect(passages[0].startSec).toBe(0);
    for (let i = 1; i < passages.length; i++) {
      expect(passages[i].from).toBe(passages[i - 1].to);
      expect(passages[i].startSec).toBe(lecture[passages[i].from].startSec);
    }
    expect(passages[passages.length - 1].to).toBe(lecture.length);
  });

  it('prefers to end a passage at the end of a sentence once it is long enough', () => {
    const lines = spoken(0, ['one two three', 'four five six', 'seven eight nine', 'ten eleven twelve', 'thirteen fourteen', 'fifteen sixteen', 'seventeen', 'eighteen', 'nineteen', 'the end of the idea.', 'next idea starts', 'and continues'], 5);
    const [first] = buildPassages(lines);
    expect(first.text.endsWith('the end of the idea.')).toBe(true);
  });

  it('keeps unpunctuated auto-captions bounded by time and size', () => {
    const asr = spoken(0, Array.from({ length: 600 }, (_, i) => `so here we look at the value number ${i} and move on`), 3);
    for (const p of buildPassages(asr)) {
      expect(p.endSec - p.startSec).toBeLessThanOrEqual(60);
      expect(p.text.length).toBeLessThanOrEqual(900);
    }
  });
});

describe('findRelatedPassages', () => {
  it('finds what was said about collisions, from a plural question', () => {
    const found = findRelatedPassages(lecture, 'What did he say about collisions?');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].startSec).toBeGreaterThanOrEqual(2380);
    expect(found[0].startSec).toBeLessThan(2440);
    expect(found[0].text).toContain('collision');
  });

  it('ranks the quicksort stability explanation first for "why is quicksort not stable?"', () => {
    const found = findRelatedPassages(lecture, 'why is quicksort not stable?');
    expect(found[0].text).toContain('Quicksort is not a stable sort');
    expect(found.every((p) => /quicksort|stable/i.test(p.text))).toBe(true);
  });

  it('returns nothing for a greeting, a general question, or words the video never uses', () => {
    expect(findRelatedPassages(lecture, 'hi')).toEqual([]);
    expect(findRelatedPassages(lecture, 'thanks, can you explain that again?')).toEqual([]);
    expect(findRelatedPassages(lecture, 'what is a red black tree rotation?')).toEqual([]);
    expect(findRelatedPassages(null, 'collisions')).toEqual([]);
    expect(findRelatedPassages(lecture, '   ')).toEqual([]);
  });

  it('never forces in a weak match: one rare question word is not enough when the rest are missing', () => {
    // "stable" appears, but "tree", "rotation" and "avl" never do — most of the question is unanswered here.
    expect(findRelatedPassages(lecture, 'is an avl tree rotation stable')).toEqual([]);
  });

  it('boosts passages inside the outline section the question names', () => {
    const twoPlaces: TranscriptSegment[] = [
      ...spoken(0, ['Insertion into an array shifts every later element.', ...filler(20, 'array basics')]),
      ...spoken(600, filler(20, 'more array basics')),
      ...spoken(1200, ['Insertion into a linked list only rewires the next pointer.', ...filler(20, 'pointer basics')]),
    ];
    const sections = [
      { startSec: 0, endSec: 1200, title: 'Arrays' },
      { startSec: 1200, endSec: 2000, title: 'Linked Lists' },
    ];
    const [top] = findRelatedPassages(twoPlaces, 'How does insertion work in a linked list?', { sections, maxPassages: 1 });
    expect(top.startSec).toBe(1200);
    const [plain] = findRelatedPassages(twoPlaces, 'How does insertion work?', { sections, maxPassages: 1 });
    expect(plain).toBeDefined();
  });

  it('skips a passage the moment window already covers', () => {
    const window = { startSec: 2380, endSec: 2460 };
    const found = findRelatedPassages(lecture, 'what did he say about collisions?', { window, currentTime: 2440 });
    for (const p of found) {
      const overlap = Math.max(0, Math.min(p.endSec, window.endSec) - Math.max(p.startSec, window.startSec));
      expect(overlap / (p.endSec - p.startSec)).toBeLessThanOrEqual(0.5);
    }
  });

  it('lets nearness break ties but never beat relevance', () => {
    const repeated: TranscriptSegment[] = [
      ...spoken(0, ['Binary search halves a sorted array each step.', ...filler(20, 'setup')]),
      ...spoken(3000, ['Binary search halves a sorted array each step.', ...filler(20, 'setup')]),
      ...spoken(6000, ['We also mention search once here.', ...filler(20, 'wrap up')]),
    ];
    const [nearEnd] = findRelatedPassages(repeated, 'how does binary search work', { currentTime: 3100, maxPassages: 1 });
    expect(nearEnd.startSec).toBe(3000);
    const [nearStart] = findRelatedPassages(repeated, 'how does binary search work', { currentTime: 50, maxPassages: 1 });
    expect(nearStart.startSec).toBe(0);
    const [stillRelevant] = findRelatedPassages(repeated, 'how does binary search work', { currentTime: 6010, maxPassages: 1 });
    expect(stillRelevant.text).toContain('Binary search halves');
  });

  it('spreads its picks across the video when a topic is taught in several places', () => {
    const places: TranscriptSegment[] = [
      ...spoken(0, filler(20, 'intro')),
      ...spoken(1000, ['Binary search halves the sorted list each time.', 'Binary search is faster than linear search on sorted data.', ...filler(20, 'binary details')]),
      ...spoken(1200, ['More on binary search and its midpoint.', ...filler(20, 'binary details')]),
      ...spoken(1400, ['Binary search again, the midpoint moves.', ...filler(20, 'binary details')]),
      ...spoken(8000, ['Here we implement binary search in code, recursively.', ...filler(20, 'code')]),
      ...spoken(15000, ['Finally binary search on a sorted list of names.', ...filler(20, 'names')]),
    ];
    const found = findRelatedPassages(places, 'where did he explain binary search?');
    expect(found).toHaveLength(3);
    for (let i = 1; i < found.length; i++) expect(found[i].startSec - found[i - 1].endSec).toBeGreaterThanOrEqual(300);
  });

  it('returns at most three passages within ~1,800 characters, in time order', () => {
    const everywhere = spoken(
      0,
      Array.from({ length: 2000 }, (_, i) => `Dynamic programming stores subproblem answers, table entry ${i}, and dynamic programming reuses them to avoid recomputation in memoization.`),
    );
    const found = findRelatedPassages(everywhere, 'dynamic programming memoization');
    expect(found.length).toBeLessThanOrEqual(MAX_RELATED_PASSAGES);
    expect(found.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(MAX_RELATED_CHARS);
    expect(found.map((p) => p.startSec)).toEqual([...found.map((p) => p.startSec)].sort((a, b) => a - b));
  });

  it('stays bounded on a 12-hour transcript: passages grow with length, the answer does not', () => {
    const marathon = spoken(
      0,
      Array.from({ length: 12 * 3600 / 4 }, (_, i) => (i === 7000 ? 'Dijkstra uses a priority queue to pick the closest unvisited node.' : `Lecture line ${i} about arrays, strings and loops in general.`)),
      4,
    );
    expect(buildPassages(marathon).length).toBeLessThanOrEqual((12 * 3600) / 40);
    const started = performance.now();
    const found = findRelatedPassages(marathon, 'how does dijkstra pick the next node?', { currentTime: 40_000 });
    expect(performance.now() - started).toBeLessThan(3000);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(MAX_RELATED_PASSAGES);
    expect(found[0].text).toContain('Dijkstra');
    expect(found[0].startSec).toBeLessThanOrEqual(28_000);
    expect(found[0].endSec).toBeGreaterThanOrEqual(28_000);
    expect(found.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(MAX_RELATED_CHARS);
  });
});
