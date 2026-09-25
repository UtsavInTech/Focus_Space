import type { MindMapNode } from '@/types/notes';

/**
 * Layout for `MindMapDiagram`: the subject at the left, branches fanning out
 * to the right. Pure arithmetic, kept apart from the component so it can be
 * tested without rendering anything.
 *
 * Vertical space is measured in pixels, not rows. Titles wrap to two lines,
 * and when every node was given the same one-line row, wrapped boxes spilled
 * into their neighbours and their text was covered — a real map from a real
 * lecture came out unreadable.
 */

export const PAD_X = 11;
export const PAD_Y = 7;
export const FONT = 12;
export const LINE_H = 15;
// Inter at 12px, averaged. 6.15 measured short on real titles ("Common mistakes" touched its box edge).
export const CHAR_W = 6.4;
const MAX_TEXT_W = 168;
const MAX_LINES = 2;
const COL_GAP = 46;
/** Space between sibling boxes. */
const GAP_Y = 8;
const MARGIN = 12;
const BADGE_ROOM = 36;

/** Branch colours, cycled per top-level branch so each limb of the map reads as one thing. */
export const BRANCH_COLORS = ['#dc2626', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

export interface LaidNode {
  title: string;
  lines: string[];
  depth: number;
  /** Left edge. */
  x: number;
  /** Vertical centre. */
  y: number;
  w: number;
  h: number;
  color: string;
  children: LaidNode[];
  /** The node this box draws — how a click on it is traced back to the map. */
  source: MindMapNode;
}

/** Greedy word wrap to at most `MAX_LINES`, ellipsising whatever does not fit. */
function wrap(title: string): string[] {
  const maxChars = Math.floor(MAX_TEXT_W / CHAR_W);
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === MAX_LINES) break;
  }
  if (line && lines.length < MAX_LINES) lines.push(line);
  if (!lines.length) return [title.slice(0, maxChars)];

  // Anything that did not fit is signalled, never silently dropped.
  const rendered = lines.join(' ');
  if (rendered.length < title.replace(/\s+/g, ' ').length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

interface Box {
  lines: string[];
  w: number;
  h: number;
}

function box(title: string): Box {
  const lines = wrap(title);
  return {
    lines,
    w: Math.min(MAX_TEXT_W, Math.max(...lines.map((l) => l.length)) * CHAR_W) + PAD_X * 2,
    h: lines.length * LINE_H + PAD_Y * 2,
  };
}

/** Height a subtree needs: its own box, or its children stacked, whichever is taller (gaps included). */
function span(node: MindMapNode, boxes: Map<MindMapNode, Box>): number {
  const own = boxes.get(node)!.h + GAP_Y;
  if (!node.children.length) return own;
  return Math.max(own, node.children.reduce((sum, child) => sum + span(child, boxes), 0));
}

export function layoutMindMap(root: MindMapNode): { nodes: LaidNode[]; width: number; height: number } {
  const boxes = new Map<MindMapNode, Box>();
  const widths: number[] = [];
  const measure = (node: MindMapNode, depth: number) => {
    const b = box(node.title);
    boxes.set(node, b);
    widths[depth] = Math.max(widths[depth] ?? 0, b.w);
    for (const child of node.children) measure(child, depth + 1);
  };
  measure(root, 0);

  // The widest box at each depth sets that column, so columns never overlap on long titles.
  const colX: number[] = [];
  let x = MARGIN;
  for (let d = 0; d < widths.length; d++) {
    colX[d] = x;
    x += widths[d] + COL_GAP;
  }

  const nodes: LaidNode[] = [];
  // A parent sits level with the middle of its children, which is what makes a mind map readable.
  const place = (node: MindMapNode, depth: number, top: number, color: string): LaidNode => {
    const b = boxes.get(node)!;
    const total = span(node, boxes);
    const laid: LaidNode = { title: node.title, lines: b.lines, depth, x: colX[depth], y: top + total / 2, w: b.w, h: b.h, color, children: [], source: node };
    nodes.push(laid);
    const childrenSpan = node.children.reduce((sum, child) => sum + span(child, boxes), 0);
    let childTop = top + (total - childrenSpan) / 2;
    node.children.forEach((child, i) => {
      laid.children.push(place(child, depth + 1, childTop, depth === 0 ? BRANCH_COLORS[i % BRANCH_COLORS.length] : color));
      childTop += span(child, boxes);
    });
    return laid;
  };
  place(root, 0, MARGIN, BRANCH_COLORS[0]);

  // BADGE_ROOM: the "+N" handle on a closed topic (MindMapDiagram) sits on its right edge, past the last column.
  return { nodes, width: x - COL_GAP + MARGIN + BADGE_ROOM, height: span(root, boxes) + MARGIN * 2 };
}

/** A soft S-curve from a parent's right edge to a child's left edge. */
export function connector(parent: LaidNode, child: LaidNode): string {
  const x1 = parent.x + parent.w;
  const x2 = child.x;
  const mid = x1 + (x2 - x1) / 2;
  return `M${x1},${parent.y} C${mid},${parent.y} ${mid},${child.y} ${x2},${child.y}`;
}
