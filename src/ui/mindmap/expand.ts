import type { MindMapNode } from '@/types/notes';

/**
 * Which parts of a mind map are showing. A map opens as the subject and its main topics only; the
 * learner opens a topic to see what is inside it, one level at a time, and "+N more" reveals the rest of
 * a long list. Drawing everything at once — every branch of a 30-hour course — was a wall of crossing
 * lines, and "+20 more" could not be opened at all.
 *
 * Keys are index paths into the original tree ("r", "r.2", "r.2.0"), so a view survives re-rendering.
 */

export interface MapView {
  /** Nodes whose children are showing. The root always is. */
  open: ReadonlySet<string>;
  /** Nodes showing every child rather than the first few and "+N more". */
  all: ReadonlySet<string>;
}

export interface NodeMeta {
  key: string;
  /** Children this node has in the full map (after dropping filler). 0 for a leaf. */
  childCount: number;
  open: boolean;
  /** Set on a "+N more" node: the key of the parent whose list it completes. */
  moreOf?: string;
}

/** Most children shown under the subject, and under any other node, before "+N more". */
export const ROOT_BRANCHES = 8;
export const BRANCHES = 6;

export const ROOT_KEY = 'r';
export const initialView = (): MapView => ({ open: new Set([ROOT_KEY]), all: new Set() });

/** Lines a model sometimes emits that are not ideas: "next", "more", "etc." */
const FILLER = /^(?:next|more|etc\.?|misc\.?|others?|and more|continued|\.\.\.|…)$/i;

/** A node's real children: no filler, and nothing that only repeats the node itself. */
export function realChildren(node: MindMapNode): { child: MindMapNode; index: number }[] {
  const own = node.title.trim().toLowerCase();
  return node.children.map((child, index) => ({ child, index })).filter(({ child }) => !FILLER.test(child.title.trim()) && child.title.trim().toLowerCase() !== own);
}

/** The part of the map the view shows, and for each shown node, where it came from. */
export function visibleTree(root: MindMapNode, view: MapView): { tree: MindMapNode; meta: Map<MindMapNode, NodeMeta> } {
  const meta = new Map<MindMapNode, NodeMeta>();
  const build = (node: MindMapNode, key: string, depth: number): MindMapNode => {
    const kids = realChildren(node);
    const open = key === ROOT_KEY || view.open.has(key);
    const out: MindMapNode = { title: node.title, children: [] };
    meta.set(out, { key, childCount: kids.length, open: open && kids.length > 0 });
    if (!open || !kids.length) return out;
    const limit = depth === 0 ? ROOT_BRANCHES : BRANCHES;
    const shown = view.all.has(key) || kids.length <= limit ? kids : kids.slice(0, limit - 1);
    out.children = shown.map(({ child, index }) => build(child, `${key}.${index}`, depth + 1));
    const rest = kids.length - shown.length;
    if (rest > 0) {
      const more: MindMapNode = { title: `+${rest} more`, children: [] };
      meta.set(more, { key: `${key}.more`, childCount: 0, open: false, moreOf: key });
      out.children.push(more);
    }
    return out;
  };
  return { tree: build(root, ROOT_KEY, 0), meta };
}

/** Opening a node shows its children; closing it hides them (and remembers nothing below it). */
export function toggleNode(view: MapView, key: string): MapView {
  const open = new Set(view.open);
  if (open.has(key)) {
    for (const k of open) if (k === key || k.startsWith(`${key}.`)) open.delete(k);
  } else open.add(key);
  return { open, all: view.all };
}

export function showAll(view: MapView, key: string): MapView {
  return { open: view.open, all: new Set(view.all).add(key) };
}

/** Everything open, every list complete. */
export function expandAll(root: MindMapNode): MapView {
  const open = new Set<string>();
  const walk = (node: MindMapNode, key: string) => {
    open.add(key);
    for (const { child, index } of realChildren(node)) walk(child, `${key}.${index}`);
  };
  walk(root, ROOT_KEY);
  return { open, all: new Set(open) };
}
