import { describe, expect, it } from 'vitest';
import type { MindMapNode } from '@/types/notes';
import { expandAll, initialView, showAll, toggleNode, visibleTree } from './expand';

const leaf = (title: string): MindMapNode => ({ title, children: [] });
// The shape from the bug report: a course with 12 days, one of which has 20 sub-topics.
const course: MindMapNode = {
  title: 'Generative AI Full Course',
  children: Array.from({ length: 12 }, (_, d) => ({
    title: `Day ${d + 1}`,
    children: [...Array.from({ length: d === 0 ? 20 : 3 }, (_, i) => ({ title: `Day ${d + 1} topic ${i}`, children: [leaf('detail a'), leaf('detail b')] })), leaf('next')],
  })),
};
const titles = (n: MindMapNode) => n.children.map((c) => c.title);

describe('mind map view', () => {
  it('opens on the main topics only, each saying how much is inside', () => {
    const { tree, meta } = visibleTree(course, initialView());
    expect(titles(tree)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7', '+5 more']);
    expect(tree.children[0].children).toEqual([]);
    expect(meta.get(tree.children[0])).toMatchObject({ key: 'r.0', childCount: 20, open: false }); // "next" is not an idea
    expect(meta.get(tree.children[7])).toMatchObject({ moreOf: 'r' });
  });

  it('"+N more" really opens: it shows the rest of that list', () => {
    const { tree } = visibleTree(course, showAll(initialView(), 'r'));
    expect(titles(tree)).toHaveLength(12);
    expect(titles(tree).at(-1)).toBe('Day 12');
  });

  it('clicking a topic opens it one level, and a long list inside it can be opened too', () => {
    let view = toggleNode(initialView(), 'r.0');
    let day1 = visibleTree(course, view).tree.children[0];
    expect(titles(day1)).toEqual(['Day 1 topic 0', 'Day 1 topic 1', 'Day 1 topic 2', 'Day 1 topic 3', 'Day 1 topic 4', '+15 more']);
    expect(day1.children[0].children).toEqual([]); // one level at a time
    view = showAll(view, 'r.0');
    day1 = visibleTree(course, view).tree.children[0];
    expect(titles(day1)).toHaveLength(20);
  });

  it('closing a topic closes everything under it', () => {
    let view = toggleNode(toggleNode(initialView(), 'r.1'), 'r.1.0');
    expect(visibleTree(course, view).tree.children[1].children[0].children).toHaveLength(2);
    view = toggleNode(view, 'r.1');
    expect(visibleTree(course, view).tree.children[1].children).toEqual([]);
    view = toggleNode(view, 'r.1');
    expect(visibleTree(course, view).tree.children[1].children[0].children).toEqual([]);
  });

  it('expand all shows the whole map, filler aside', () => {
    const { tree } = visibleTree(course, expandAll(course));
    expect(titles(tree)).toHaveLength(12);
    expect(titles(tree.children[0])).toHaveLength(20);
    expect(titles(tree.children[0].children[0])).toEqual(['detail a', 'detail b']);
    expect(JSON.stringify(tree)).not.toContain('"next"');
  });
});
