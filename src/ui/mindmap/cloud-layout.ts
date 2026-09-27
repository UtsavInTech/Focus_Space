import type { MindMapNode } from '@/types/notes';
import { BRANCH_COLORS, CHAR_W } from './mindmap-layout';
import { BRANCHES, realChildren, ROOT_BRANCHES } from './expand';
import { descendants } from './tidy';

/**
 * Layout for the "Cloud" view of a mind map: the subject in a round cloud in the middle, and each main
 * topic as a cloud around it — a ring, read clockwise from the top — holding its sub-topics as chips.
 * The Tree view shows how ideas nest; this one shows what belongs together. Same tree, same note — no
 * extra AI call.
 *
 * Nothing is out of reach: a chip with more inside it ("· 3") opens to list that detail inside its
 * cloud, and "+N more" opens the rest of a long list. The earlier version drew two levels only, in two
 * columns, so the third level could never be seen and "Expand all" did nothing.
 *
 * Pure arithmetic, like ./mindmap-layout.ts, so it is tested without rendering anything.
 */

export const CARD_W = 252;
export const CARD_PAD = 16;
export const TITLE_FONT = 13;
export const TITLE_LINE = 17;
/** A one-line chip; a long sub-topic wraps to two lines rather than being cut off. */
export const CHIP_H = 24;
export const CHIP_LINE = 15;
export const CHIP_PAD_X = 9;
export const DETAIL_FONT = 11.5;
export const DETAIL_LINE = 15;
const CHIP_GAP = 6;
const TITLE_TO_CHIPS = 8;
const DETAIL_GAP = 4;
/** Room between clouds, and between a cloud and the subject. */
const RING_GAP = 22;
const MARGIN = 14;
const ROOT_CHARS = 18;
const ROOT_W = 188;
/** Bump size of a cloud's scalloped edge. */
const BUMP = 11;

export interface CloudChip {
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  /** A chip with detail inside it: the key that opens it, and whether it is open. */
  key?: string;
  open?: boolean;
  /** When open: the detail, as wrapped lines placed under the chip (card coordinates). */
  details?: { lines: string[]; y: number }[];
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
  /** Angle from the subject, radians — where the connector leaves the subject. */
  angle: number;
  chips: CloudChip[];
  /** A "+N more" cloud standing for the subject's other topics: clicking it shows them all. */
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

function chipLines(title: string, extra: number, open: boolean, maxChars: number): string[] {
  const lines = wrapWords(title, maxChars, 2);
  if (!extra) return lines;
  // What is inside rides on the last line: "· 3" to open it, "−" once it is open.
  const suffix = open ? ' −' : ` · ${extra}`;
  const last = lines[lines.length - 1];
  lines[lines.length - 1] = last.length + suffix.length <= maxChars ? `${last}${suffix}` : `${last.slice(0, Math.max(1, maxChars - suffix.length - 1)).trimEnd()}…${suffix}`;
  return lines;
}

interface Topic {
  title: string;
  /** Key in the full map ("r.2"); null for the subject's own "+N more". */
  key: string | null;
  node: MindMapNode | null;
}

function card(topic: Topic, color: string, opened: ReadonlySet<string>): CloudCard {
  const inner = CARD_W - CARD_PAD * 2;
  const lines = wrapWords(topic.title, Math.floor(inner / (CHAR_W * (TITLE_FONT / 12))), 2);
  const chips: CloudChip[] = [];
  const top = CARD_PAD + lines.length * TITLE_LINE + TITLE_TO_CHIPS;
  const maxChars = Math.floor((inner - CHIP_PAD_X * 2) / CHAR_W);
  const detailChars = Math.floor((inner - 12) / (CHAR_W * (DETAIL_FONT / 12)));
  let x = 0;
  let y = top;
  let rowH = 0;
  const newRow = () => {
    if (x > 0) y += rowH + CHIP_GAP;
    x = 0;
    rowH = 0;
  };

  if (topic.node && topic.key) {
    const kids = realChildren(topic.node);
    const all = opened.has(topic.key) || kids.length <= BRANCHES;
    const shown = all ? kids : kids.slice(0, BRANCHES - 1);
    const items: { title: string; key?: string; node?: MindMapNode; moreOf?: string }[] = [
      ...shown.map(({ child, index }) => ({ title: child.title, key: `${topic.key}.${index}`, node: child })),
      ...(shown.length < kids.length ? [{ title: `+${kids.length - shown.length} more`, moreOf: topic.key }] : []),
    ];
    for (const item of items) {
      const detail = item.node ? realChildren(item.node) : [];
      const open = !!item.key && detail.length > 0 && opened.has(item.key);
      const text = chipLines(item.title, item.node ? descendants(item.node) : 0, open, maxChars);
      // +6: CHAR_W is an average, and a chip whose text touches its edge looks broken.
      const w = Math.min(inner, Math.ceil(Math.max(...text.map((l) => l.length)) * CHAR_W) + CHIP_PAD_X * 2 + 6);
      const h = CHIP_H + (text.length - 1) * CHIP_LINE;
      // An open chip takes a row of its own, with its detail listed under it.
      if (open || (x > 0 && x + w > inner)) newRow();
      const chip: CloudChip = { lines: text, x: CARD_PAD + x, y, w, h };
      if (item.moreOf) chip.moreOf = item.moreOf;
      if (item.key && detail.length) Object.assign(chip, { key: item.key, open });
      chips.push(chip);
      x += w + CHIP_GAP;
      rowH = Math.max(rowH, h);
      if (open) {
        let dy = y + h + DETAIL_GAP;
        chip.details = detail.map(({ child }) => {
          const extra = descendants(child);
          const wrapped = wrapWords(`${child.title}${extra ? ` · ${extra}` : ''}`, detailChars, 3);
          const at = { lines: wrapped, y: dy };
          dy += wrapped.length * DETAIL_LINE + 2;
          return at;
        });
        rowH = dy - y;
        newRow();
      }
    }
  }
  const last = chips.length ? y + rowH : top - TITLE_TO_CHIPS;
  const h = chips.length ? last + CARD_PAD : CARD_PAD * 2 + lines.length * TITLE_LINE;
  return { lines, x: 0, y: 0, w: CARD_W, h: Math.max(h, 56), color, angle: 0, chips, ...(topic.key === null ? { moreOf: 'r' } : {}) };
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export function layoutCloud(source: MindMapNode, opened: ReadonlySet<string> = new Set()): CloudLayout {
  const kids = realChildren(source);
  const all = opened.has('r') || kids.length <= ROOT_BRANCHES;
  const shown = all ? kids : kids.slice(0, ROOT_BRANCHES - 1);
  const topics: Topic[] = [...shown.map(({ child, index }) => ({ title: child.title, key: `r.${index}`, node: child })), ...(shown.length < kids.length ? [{ title: `+${kids.length - shown.length} more`, key: null, node: null }] : [])];
  const cards = topics.map((t, i) => card(t, BRANCH_COLORS[i % BRANCH_COLORS.length], opened));

  const rootLines = wrapWords(source.title, ROOT_CHARS, 3);
  const rootH = rootLines.length * 18 + 44;
  // Centred on (0, 0) while placing; moved into view at the end.
  const root = { lines: rootLines, x: -ROOT_W / 2, y: -rootH / 2, w: ROOT_W, h: rootH };

  // A ring read clockwise from the top; one topic sits to the right, two either side.
  const n = cards.length;
  const angles = cards.map((_, i) => (n === 1 ? 0 : n === 2 ? (i === 0 ? 0 : Math.PI) : -Math.PI / 2 + (2 * Math.PI * i) / n));
  const place = (r: number) =>
    cards.forEach((c, i) => {
      c.angle = angles[i];
      // Wider than tall: clouds are wide, and a round ring left gaps at the sides and crowding at the poles.
      c.x = Math.cos(angles[i]) * r * 1.45 - c.w / 2;
      c.y = Math.sin(angles[i]) * r - c.h / 2;
    });
  const clear = () => cards.every((c, i) => !overlaps(c, root, RING_GAP) && cards.every((d, j) => j <= i || !overlaps(c, d, RING_GAP)));
  // The smallest ring on which nothing touches: a handful of clouds, so a simple search is instant.
  let radius = 90;
  for (place(radius); !clear() && radius < 4000; place(radius)) radius += 12;

  const boxes = [root, ...cards];
  const minX = Math.min(...boxes.map((b) => b.x)) - MARGIN;
  const minY = Math.min(...boxes.map((b) => b.y)) - MARGIN;
  for (const b of boxes) {
    b.x -= minX;
    b.y -= minY;
  }
  return {
    root,
    cards,
    width: Math.max(...boxes.map((b) => b.x + b.w)) + MARGIN,
    height: Math.max(...boxes.map((b) => b.y + b.h)) + MARGIN,
  };
}

/** Where the ray from a box's centre towards (tx, ty) leaves the box. */
function edgePoint(b: { x: number; y: number; w: number; h: number }, tx: number, ty: number): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/** A gentle curve from the subject's cloud to a topic's cloud, edge to edge. */
export function cloudConnector(root: CloudLayout['root'], c: CloudCard): string {
  const [x1, y1] = edgePoint(root, c.x + c.w / 2, c.y + c.h / 2);
  const [x2, y2] = edgePoint(c, root.x + root.w / 2, root.y + root.h / 2);
  // Bend slightly to one side so lines read as drawn, not ruled.
  const mx = (x1 + x2) / 2 - (y2 - y1) * 0.12;
  const my = (y1 + y2) / 2 + (x2 - x1) * 0.12;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

/**
 * A cloud's outline: bumps all the way round a box, each an arc bulging outward, so the edge reads as a
 * cloud rather than a card. `round` follows an ellipse (the subject); otherwise a rounded rectangle
 * (a topic, which holds chips and needs its straight room). Stays inside the w × h box.
 */
export function cloudPath(w: number, h: number, round = false, bump = BUMP): string {
  const r = bump / 2;
  const iw = w - bump;
  const ih = h - bump;
  const points: [number, number][] = [];
  if (round) {
    const count = Math.max(10, Math.round((Math.PI * (iw + ih)) / 2 / (bump * 1.6)));
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / count;
      points.push([w / 2 + (Math.cos(a) * iw) / 2, h / 2 + (Math.sin(a) * ih) / 2]);
    }
  } else {
    // Walk the inset rectangle clockwise from the top-left, a point every ~1.6 bumps.
    const perimeter = 2 * (iw + ih);
    const count = Math.max(8, Math.round(perimeter / (bump * 1.6)));
    for (let i = 0; i < count; i++) {
      let d = (perimeter * i) / count;
      if (d < iw) points.push([r + d, r]);
      else if ((d -= iw) < ih) points.push([r + iw, r + d]);
      else if ((d -= ih) < iw) points.push([r + iw - d, r + ih]);
      else points.push([r, r + ih - (d - iw)]);
    }
  }
  const [sx, sy] = points[0];
  const arcs = points.map((_, i) => {
    const [x, y] = points[(i + 1) % points.length];
    const [px, py] = points[i];
    const radius = Math.max(r, Math.hypot(x - px, y - py) * 0.62);
    return `A${radius.toFixed(1)},${radius.toFixed(1)} 0 0 1 ${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M${sx.toFixed(1)},${sy.toFixed(1)} ${arcs.join(' ')} Z`;
}
