import { useMemo } from 'react';
import type { MindMapNode } from '@/types/notes';

/**
 * A mind map drawn as an actual map: the video's subject at the left, its
 * branches fanning out to the right, each branch in its own colour.
 *
 * Inline SVG rather than a diagramming library. This renders inside a shadow
 * root on youtube.com under an extension CSP, where a library that injects
 * stylesheets or evaluates layout against `document` is a liability; the
 * layout here is a few dozen lines of arithmetic and it gives us exact
 * control over how it looks in both themes. Colours come from the FocusSpace
 * token set, so the diagram matches everything around it.
 *
 * The tree it draws is already built deterministically by `parseMindMap`
 * (learning/notes/mindmap.ts) — no extra AI call is made to produce the
 * picture, so the diagram costs nothing beyond the note itself.
 */

const ROW_H = 30;
const COL_GAP = 46;
const PAD_X = 11;
const PAD_Y = 7;
const FONT = 12;
const LINE_H = 15;
const CHAR_W = 6.15; // Inter at 12px, averaged — good enough for box sizing
const MAX_TEXT_W = 168;
const MAX_LINES = 2;
const MARGIN = 12;

/** Branch colours, cycled per top-level branch so each limb of the map reads as one thing. */
const BRANCH_COLORS = ['#6d5dfc', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

interface Laid {
  title: string;
  lines: string[];
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  children: Laid[];
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

/** Rows a subtree occupies — a leaf is one row, a parent is the sum of its children. */
function rowsIn(node: MindMapNode): number {
  if (!node.children.length) return 1;
  return node.children.reduce((sum, child) => sum + rowsIn(child), 0);
}

/**
 * Lays the tree out left-to-right: x by depth, y by the vertical centre of the
 * rows the subtree occupies. A parent always sits level with the middle of its
 * children, which is what makes a mind map readable.
 */
function layout(node: MindMapNode, depth: number, topRow: number, colX: number[], color: string): Laid {
  const lines = wrap(node.title);
  const w = Math.min(MAX_TEXT_W, Math.max(...lines.map((l) => l.length)) * CHAR_W) + PAD_X * 2;
  const h = lines.length * LINE_H + PAD_Y * 2;

  let row = topRow;
  const children = node.children.map((child, i) => {
    const laid = layout(child, depth + 1, row, colX, depth === 0 ? BRANCH_COLORS[i % BRANCH_COLORS.length] : color);
    row += rowsIn(child);
    return laid;
  });

  const rows = rowsIn(node);
  const centreRow = topRow + rows / 2;
  return { title: node.title, lines, depth, x: colX[depth] ?? 0, y: centreRow * ROW_H, w, h, color, children };
}

/** The widest box at each depth, so columns do not overlap on long titles. */
function columnWidths(node: MindMapNode, depth: number, widths: number[]): void {
  const lines = wrap(node.title);
  const w = Math.min(MAX_TEXT_W, Math.max(...lines.map((l) => l.length)) * CHAR_W) + PAD_X * 2;
  widths[depth] = Math.max(widths[depth] ?? 0, w);
  for (const child of node.children) columnWidths(child, depth + 1, widths);
}

function flatten(node: Laid, out: Laid[] = []): Laid[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

/** A soft S-curve from a parent's right edge to a child's left edge. */
function connector(parent: Laid, child: Laid): string {
  const x1 = parent.x + parent.w;
  const y1 = parent.y;
  const x2 = child.x;
  const y2 = child.y;
  const mid = x1 + (x2 - x1) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

export function MindMapDiagram({ root }: { root: MindMapNode }) {
  const { nodes, width, height } = useMemo(() => {
    const widths: number[] = [];
    columnWidths(root, 0, widths);

    const colX: number[] = [];
    let x = MARGIN;
    for (let d = 0; d < widths.length; d++) {
      colX[d] = x;
      x += widths[d] + COL_GAP;
    }

    const laid = layout(root, 0, 0, colX, BRANCH_COLORS[0]);
    const all = flatten(laid);
    return {
      nodes: all,
      width: x - COL_GAP + MARGIN,
      height: rowsIn(root) * ROW_H + MARGIN * 2,
    };
  }, [root]);

  const byParent = useMemo(() => nodes.flatMap((n) => n.children.map((c) => ({ from: n, to: c }))), [nodes]);

  return (
    <div className="fs-mindmap" role="img" aria-label={`Mind map: ${root.title}`}>
      <svg width={width} height={height} viewBox={`0 ${-ROW_H / 2 - MARGIN} ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
        {byParent.map(({ from, to }, i) => (
          <path key={i} d={connector(from, to)} fill="none" stroke={to.color} strokeWidth={to.depth === 1 ? 1.75 : 1.25} strokeOpacity={to.depth === 1 ? 0.7 : 0.45} strokeLinecap="round" />
        ))}
        {nodes.map((node, i) => (
          <g key={i} transform={`translate(${node.x}, ${node.y - node.h / 2})`}>
            <rect
              width={node.w}
              height={node.h}
              rx={node.depth === 0 ? 10 : 8}
              fill={node.depth === 0 ? node.color : 'var(--fs-surface-2)'}
              stroke={node.depth === 0 ? 'none' : node.color}
              strokeOpacity={node.depth === 1 ? 0.55 : 0.3}
            />
            {node.lines.map((line, li) => (
              <text
                key={li}
                x={PAD_X}
                y={PAD_Y + LINE_H * li + FONT}
                fontSize={FONT}
                fontWeight={node.depth === 0 ? 650 : node.depth === 1 ? 560 : 400}
                fill={node.depth === 0 ? '#ffffff' : 'var(--fs-text)'}
              >
                {line}
              </text>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * The same map as an indented outline. Kept alongside the diagram rather than
 * replaced by it: the outline is what you copy into your own notes, what a
 * screen reader reads sensibly, and what still works when a map is too deep to
 * take in as a picture.
 */
export function MindMapOutline({ node, depth = 0 }: { node: MindMapNode; depth?: number }) {
  return (
    <div className="fs-mindmap-row" style={{ paddingLeft: depth * 16 }}>
      <div className="fs-mindmap-title" data-depth={Math.min(depth, 2)}>
        {node.title}
      </div>
      {node.children.map((child, i) => (
        <MindMapOutline key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

/** Serialises the rendered diagram to a standalone .svg the learner can keep. */
export function downloadMindMapSvg(container: HTMLElement | null, filename: string): void {
  const svg = container?.querySelector('svg');
  if (!svg) return;

  // The live SVG references CSS custom properties from the shadow root, which a
  // standalone file will not have — resolve them against the rendered element
  // so the saved file looks like what was on screen.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const styles = getComputedStyle(container!);
  const resolve = (value: string) => {
    const match = /^var\((--[^)]+)\)$/.exec(value);
    return match ? styles.getPropertyValue(match[1]).trim() || '#000' : value;
  };
  for (const el of clone.querySelectorAll('*')) {
    for (const attr of ['fill', 'stroke']) {
      const value = el.getAttribute(attr);
      if (value?.startsWith('var(')) el.setAttribute(attr, resolve(value));
    }
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
