import { describe, expect, it } from 'vitest';
import type { MindMapNode } from '@/types/notes';
import { layoutMindMap, type LaidNode } from './mindmap-layout';

const n = (title: string, children: MindMapNode[] = []): MindMapNode => ({ title, children }) as MindMapNode;

// Shaped like a real map the old one-row-per-node layout drew unreadably: long leaf titles that wrap.
const LINKED_LIST = n('Insert in a Linked List (First & Last)', [
  n('Overview of Linked List Class', [n('A Linked List class is already created'), n('Contains nodes that hold data')]),
  n('Operations on Linked List', [n('Four main operations discussed:', [n('Insert (add an element)'), n('Print the linked list'), n('Delete a node'), n('Check the size of the list')])]),
  n('Inserting at the First Position', [n('Create a new node with the desired data'), n("Point the new node's next to the current head"), n('Update the head to the new node')]),
  n('Important Consideration', [n('The head pointer should not be manipulated directly'), n('Keep the head constant to maintain the structure of the list')]),
]);

const overlaps = (a: LaidNode, b: LaidNode) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y - a.h / 2 < b.y + b.h / 2 && b.y - b.h / 2 < a.y + a.h / 2;

describe('mind map layout', () => {
  const { nodes, width, height } = layoutMindMap(LINKED_LIST);

  it('never lets two boxes overlap, even when titles wrap to two lines', () => {
    expect(nodes.some((node) => node.lines.length === 2)).toBe(true); // the case that used to break
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(overlaps(nodes[i], nodes[j]), `"${nodes[i].title}" overlaps "${nodes[j].title}"`).toBe(false);
      }
    }
  });

  it('keeps every box inside the drawing', () => {
    for (const node of nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.w).toBeLessThanOrEqual(width);
      expect(node.y - node.h / 2).toBeGreaterThanOrEqual(0);
      expect(node.y + node.h / 2).toBeLessThanOrEqual(height);
    }
  });

  it('centres each parent on its children', () => {
    for (const node of nodes.filter((x) => x.children.length > 1)) {
      const first = node.children[0].y;
      const last = node.children[node.children.length - 1].y;
      expect(node.y).toBeCloseTo((first + last) / 2, 0);
    }
  });
});
