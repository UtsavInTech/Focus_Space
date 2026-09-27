import { describe, expect, it } from 'vitest';
import type { MindMapNode } from '@/types/notes';
import { CARD_W, cloudPath, layoutCloud, wrapWords } from './cloud-layout';
import { expandAll } from './expand';
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
  const centre = (b: { x: number; y: number; w: number; h: number }) => [b.x + b.w / 2, b.y + b.h / 2];

  it('draws one cloud per main topic, in a ring read clockwise from the top', () => {
    expect(layout.cards.map((c) => c.lines.join(' '))).toEqual(['Insertion', 'Deletion', 'Traversal', 'Reversal', 'Complexity of every operation on a singly linked list']);
    const [rx, ry] = centre(layout.root);
    const [x0, y0] = centre(layout.cards[0]);
    expect(y0).toBeLessThan(ry); // the first topic is above the subject
    expect(Math.abs(x0 - rx)).toBeLessThan(5);
    const [x1] = centre(layout.cards[1]);
    expect(x1).toBeGreaterThan(rx); // then round to the right
  });

  it('never overlaps two clouds or the subject, and keeps every chip inside its cloud', () => {
    const boxes = [layout.root, ...layout.cards];
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    for (const c of layout.cards) {
      for (const chip of c.chips) {
        expect(chip.x).toBeGreaterThanOrEqual(0);
        expect(chip.x + chip.w).toBeLessThanOrEqual(CARD_W);
        expect(chip.y + chip.h).toBeLessThanOrEqual(c.h);
      }
    }
    expect(Math.min(...boxes.map((b) => Math.min(b.x, b.y)))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...boxes.map((b) => b.y + b.h))).toBeLessThanOrEqual(layout.height);
    expect(Math.max(...boxes.map((b) => b.x + b.w))).toBeLessThanOrEqual(layout.width);
  });

  it('counts the detail inside a chip, and opens it to list that detail', () => {
    const chip = layout.cards[0].chips[0];
    expect(chip).toMatchObject({ lines: ['Insertion detail 0 · 2'], key: 'r.0.0', open: false });
    expect(layout.cards[2].chips).toHaveLength(0);
    const opened = layoutCloud(root, new Set(['r.0.0']));
    const open = opened.cards[0].chips[0];
    expect(open).toMatchObject({ lines: ['Insertion detail 0 −'], open: true });
    expect(open.details?.map((d) => d.lines[0])).toEqual(['deep 0', 'deep 1']);
    // The cloud grows to hold it, and the detail sits inside.
    expect(opened.cards[0].h).toBeGreaterThan(layout.cards[0].h);
    for (const d of open.details!) expect(d.y).toBeLessThan(opened.cards[0].h);
  });

  it('opens everything with "Expand all" — nothing is left behind a count', () => {
    const all = layoutCloud(root, expandAll(root).all);
    const withDetail = all.cards.flatMap((c) => c.chips).filter((ch) => ch.key);
    expect(withDetail.length).toBeGreaterThan(0);
    expect(withDetail.every((ch) => ch.open && ch.details?.length)).toBe(true);
  });

  it('wraps a long sub-topic onto a second line instead of cutting it off', () => {
    const long = layoutCloud({ title: 'R', children: [{ title: 'B', children: [leaf('Nodes hold data and a next pointer to the following node')] }] });
    const chip = long.cards[0].chips[0];
    expect(chip.lines.length).toBe(2);
    expect(chip.lines.join(' ')).toBe('Nodes hold data and a next pointer to the following node');
    expect(chip.h).toBeGreaterThan(24);
  });

  it('makes "+N more" openable, for a cloud\'s chips and for the topics themselves', () => {
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

  it('puts a single topic to the right of the subject', () => {
    const one = layoutCloud({ title: 'Solo', children: [branch('Only', 2)] });
    expect(one.cards).toHaveLength(1);
    expect(one.cards[0].x).toBeGreaterThan(one.root.x + one.root.w);
  });
});

describe('cloudPath', () => {
  it('draws a closed, bumpy outline that stays inside its box', () => {
    for (const [w, h, round] of [[252, 140, false], [188, 80, true]] as const) {
      const d = cloudPath(w, h, round);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
      const arcs = d.match(/A/g)?.length ?? 0;
      expect(arcs).toBeGreaterThanOrEqual(8);
      const nums = [...d.matchAll(/ (-?[\d.]+),(-?[\d.]+)(?= |$)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (const [x, y] of nums) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe('wrapWords', () => {
  it('wraps, and marks what did not fit', () => {
    expect(wrapWords('one two three four five six', 9, 2)).toEqual(['one two', 'three…']);
    expect(wrapWords('short', 20, 2)).toEqual(['short']);
  });
});
