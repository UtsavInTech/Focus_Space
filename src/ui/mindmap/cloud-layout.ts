import type { MindMapNode } from '@/types/notes';
import { BRANCH_COLORS, CHAR_W } from './mindmap-layout';
import { realChildren } from './expand';
import { descendants, tidyMindMap } from './tidy';

/**
 * Layout for the "Cloud" view of a mind map: the subject in the middle, and each main topic as a soft
 * bubble around it holding its sub-topics as chips. The Tree view shows how ideas nest; this one shows
 * what belongs together, and stays readable however many details a topic has, because details wrap
 * inside their bubble instead of adding columns. Same tree, same note — no extra AI call.
 *
 * Bubbles sit in two columns either side of the subject and read clockwise: down the right, then up
 * the left. Pure arithmetic, like ./mindmap-layout.ts, so it is tested without rendering anything.
 */

export const CARD_W = 236;
export const CARD_PAD = 12;
export const TITLE_FONT = 13;
export const TITLE_LINE = 17;
/** A one-line chip; a long sub-topic wraps to two lines rather than being cut off. */
export const CHIP_H = 24;
export const CHIP_LINE = 15;
export const CHIP_PAD_X = 9;
const CHIP_GAP = 6;
const TITLE_TO_CHIPS = 8;
const COL_GAP = 56;
const ROW_GAP = 16;
const MARGIN = 12;
const ROOT_FONT_CHARS = 20;
const ROOT_W = 176;

export interface CloudChip {
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  /** A "+N more" chip: the key (./expand.ts) of the list it completes when clicked. */
  moreOf?: string;
}

export interface CloudCard {
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  side: 'left' | 'right';
  chips: CloudChip[];
  /** A "+N more" bubble standing for the subject's other topics: clicking it shows them all. */
  moreOf?: string;
}

export interface CloudLayout {
  root: { lines: string[]; x: number; y: number; w: number; h: number };
  cards: CloudCard[];
  width: number;
  height: number;
}

/** Word wrap to `maxLines`, the last line ellipsised when something did not fit. */
export function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let used = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      used++;
      continue;
    }
    if (line) lines.push(line);
    if (lines.length === maxLines) break;
    line = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
    used++;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (used < words.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  return lines.length ? lines : [text.slice(0, maxChars)];
}

function chipLines(node: MindMapNode, maxChars: number): string[] {
  const extra = descendants(node);
  const lines = wrapWords(node.title, maxChars, 2);
  if (!extra) return lines;
  // The count of undrawn detail rides on the last line, making room for it if it has to.
  const suffix = ` · ${extra}`;
  const last = lines[lines.length - 1];
  lines[lines.length - 1] = last.length + suffix.length <= maxChars ? `${last}${suffix}` : `${last.slice(0, Math.max(1, maxChars - suffix.length - 1)).trimEnd()}…${suffix}`;
  return lines;
}

function card(branch: MindMapNode, color: string, side: 'left' | 'right', key: string | null): CloudCard {
  const inner = CARD_W - CARD_PAD * 2;
  const lines = wrapWords(branch.title, Math.floor(inner / (CHAR_W * (TITLE_FONT / 12))), 2);
  const chips: CloudChip[] = [];
  const top = CARD_PAD + lines.length * TITLE_LINE + TITLE_TO_CHIPS;
  const maxChars = Math.floor((inner - CHIP_PAD_X * 2) / CHAR_W);
  let x = 0;
  let y = top;
  let rowH = 0;
  for (const child of branch.children) {
    const text = chipLines(child, maxChars);
    // +6: CHAR_W is an average, and a chip whose text touches its edge looks broken.
    const w = Math.min(inner, Math.ceil(Math.max(...text.map((l) => l.length)) * CHAR_W) + CHIP_PAD_X * 2 + 6);
    const h = CHIP_H + (text.length - 1) * CHIP_LINE;
    if (x > 0 && x + w > inner) {
      y += rowH + CHIP_GAP;
      x = 0;
      rowH = 0;
    }
    chips.push({ lines: text, x: CARD_PAD + x, y, w, h, ...(key && /^\+\d+ more$/.test(child.title) ? { moreOf: key } : {}) });
    x += w + CHIP_GAP;
    rowH = Math.max(rowH, h);
  }
  const h = chips.length ? y + rowH + CARD_PAD : CARD_PAD * 2 + lines.length * TITLE_LINE;
  return { lines, x: 0, y: 0, w: CARD_W, h, color, side, chips, ...(key === null ? { moreOf: 'r' } : {}) };
}

export function layoutCloud(source: MindMapNode, opened: ReadonlySet<string> = new Set()): CloudLayout {
  // Two levels are drawn — topic and sub-topic; anything deeper is the "· n" count on its chip.
  const root = tidyMindMap(source, undefined, opened);
  // Each drawn topic's key in the full map; null for the subject's own "+N more".
  const keys = realChildren(source).map(({ index }) => `r.${index}`);
  // Topics overflow exactly when the map has more of them than bubbles drawn; then the last bubble is tidy's "+N more".
  const overflow = keys.length > root.children.length;
  const branches = root.children.map((b, i) => ({ ...b, color: BRANCH_COLORS[i % BRANCH_COLORS.length], key: overflow && i === root.children.length - 1 ? null : keys[i] }));
  const rightCount = Math.ceil(branches.length / 2);
  const right = branches.slice(0, rightCount).map((b) => card(b, b.color, 'right', b.key));
  // Clockwise: the left column continues from the bottom up.
  const left = branches
    .slice(rightCount)
    .map((b) => card(b, b.color, 'left', b.key))
    .reverse();

  const rootLines = wrapWords(source.title, ROOT_FONT_CHARS, 3);
  const rootH = rootLines.length * 18 + 22;
  const columnH = (cards: CloudCard[]) => cards.reduce((n, c) => n + c.h, 0) + Math.max(0, cards.length - 1) * ROW_GAP;
  const height = Math.max(columnH(left), columnH(right), rootH) + MARGIN * 2;

  const leftX = MARGIN;
  const rootX = left.length ? leftX + CARD_W + COL_GAP : MARGIN;
  const rightX = rootX + ROOT_W + COL_GAP;
  const stack = (cards: CloudCard[], x: number) => {
    let y = (height - columnH(cards)) / 2;
    for (const c of cards) {
      c.x = x;
      c.y = y;
      y += c.h + ROW_GAP;
    }
  };
  stack(right, rightX);
  stack(left, leftX);

  return {
    root: { lines: rootLines, x: rootX, y: (height - rootH) / 2, w: ROOT_W, h: rootH },
    cards: [...right, ...[...left].reverse()],
    width: (right.length ? rightX + CARD_W : rootX + ROOT_W) + MARGIN,
    height,
  };
}

/** A soft curve from the subject's edge to the facing edge of a bubble. */
export function cloudConnector(root: CloudLayout['root'], c: CloudCard): string {
  const cy = root.y + root.h / 2;
  const x1 = c.side === 'right' ? root.x + root.w : root.x;
  const x2 = c.side === 'right' ? c.x : c.x + c.w;
  const y2 = c.y + c.h / 2;
  const mid = (x1 + x2) / 2;
  return `M${x1},${cy} C${mid},${cy} ${mid},${y2} ${x2},${y2}`;
}
