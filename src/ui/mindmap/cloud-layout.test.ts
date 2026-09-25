import { describe, expect, it } from 'vitest';
import type { MindMapNode } from '@/types/notes';
import { CARD_W, layoutCloud, wrapWords } from './cloud-layout';
import { tidyMindMap } from './tidy';

const leaf = (title: string): MindMapNode => ({ title, children: [] });
const branch = (title: string, n: number, deeper = 0): MindMapNode => ({
  title,
  children: Array.from({ length: n }, (_, i) => ({ title: `${title} detail ${i}`, children: Array.from({ length: deeper }, (_, j) => leaf(`deep ${j}`)) })),
});

describe('tidyMindMap', () => {
  it('folds extra branches into "+N more" instead of dropping them silently', () => {
    const tidy = tidyMindMap({ title: 'Root', children: Array.from({ length: 12 }, (_, i) => branch(`B${i}`, 9)) });
    expect(tidy.children).toHaveLength(8);
    expect(tidy.children[7].title).toBe('+5 more');
    expect(tidy.children[0].children).toHaveLength(6);
    expect(tidy.children[0].children[5].title).toBe('+4 more');
  });

  it('stops three levels below the root and drops a child that repeats its parent', () => {
    const deep: MindMapNode = { title: 'R', children: [{ title: 'Arrays', children: [{ title: 'b', children: [{ title: 'x', children: [leaf('too deep')] }] }, leaf('arrays')] }] };
    const tidy = tidyMindMap(deep);
    expect(tidy.children[0].children.map((c) => c.title)).toEqual(['b']);
    expect(tidy.children[0].children[0].children[0]).toEqual({ title: 'x', children: [] });
  });
});

describe('cloud layout', () => {
  const root: MindMapNode = { title: 'Linked Lists — Complete Lecture', children: [branch('Insertion', 5, 2), branch('Deletion', 3), branch('Traversal', 0), branch('Reversal', 6), branch('Complexity of every operation on a singly linked list', 2)] };
  const layout = layoutCloud(root);

  it('draws one bubble per main topic, in reading order, split either side of the subject', () => {
    expect(layout.cards.map((c) => c.lines.join(' '))).toEqual(['Insertion', 'Deletion', 'Traversal', 'Reversal', 'Complexity of every operation on a singly linked list']);
    expect(layout.cards.filter((c) => c.side === 'right')).toHaveLength(3);
    for (const c of layout.cards) expect(c.side === 'right' ? c.x > layout.root.x + layout.root.w : c.x + c.w < layout.root.x).toBe(true);
  });

  it('never overlaps two bubbles, and keeps every chip inside its bubble', () => {
    for (const a of layout.cards) {
      for (const b of layout.cards) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
      for (const chip of a.chips) {
        expect(chip.x).toBeGreaterThanOrEqual(0);
        expect(chip.x + chip.w).toBeLessThanOrEqual(CARD_W);
        expect(chip.y + chip.h).toBeLessThanOrEqual(a.h);
      }
    }
    expect(Math.max(...layout.cards.map((c) => c.y + c.h))).toBeLessThanOrEqual(layout.height);
    expect(Math.max(...layout.cards.map((c) => c.x + c.w))).toBeLessThanOrEqual(layout.width);
  });

  it('counts the detail a chip does not draw', () => {
    expect(layout.cards[0].chips[0].lines).toEqual(['Insertion detail 0 · 2']);
    expect(layout.cards[2].chips).toHaveLength(0);
  });

  it('wraps a long sub-topic onto a second line instead of cutting it off', () => {
    const long = layoutCloud({ title: 'R', children: [{ title: 'B', children: [leaf('Nodes hold data and a next pointer to the following node')] }] });
    const chip = long.cards[0].chips[0];
    expect(chip.lines).toEqual(['Nodes hold data and a next', 'pointer to the following node']);
    expect(chip.h).toBeGreaterThan(24);
  });

  it('makes "+N more" openable, for a bubble\'s chips and for the topics themselves', () => {
    const big: MindMapNode = { title: 'R', children: Array.from({ length: 10 }, (_, i) => branch(`T${i}`, i === 0 ? 9 : 1)) };
    const closed = layoutCloud(big);
    expect(closed.cards).toHaveLength(8);
    const moreTopics = closed.cards.find((c) => c.moreOf);
    expect(moreTopics).toMatchObject({ moreOf: 'r', lines: ['+3 more'] });
    expect(closed.cards[0].chips.at(-1)).toMatchObject({ lines: ['+4 more'], moreOf: 'r.0' });
    const opened = layoutCloud(big, new Set(['r', 'r.0']));
    expect(opened.cards).toHaveLength(10);
    expect(opened.cards[0].chips).toHaveLength(9);
    expect(opened.cards.some((c) => c.moreOf)).toBe(false);
  });

  it('handles a map with a single topic', () => {
    const one = layoutCloud({ title: 'Solo', children: [branch('Only', 2)] });
    expect(one.cards).toHaveLength(1);
    expect(one.cards[0].x).toBeGreaterThan(one.root.x);
  });
});

describe('wrapWords', () => {
  it('wraps, and marks what did not fit', () => {
    expect(wrapWords('one two three four five six', 9, 2)).toEqual(['one two', 'three…']);
    expect(wrapWords('short', 20, 2)).toEqual(['short']);
  });
});
