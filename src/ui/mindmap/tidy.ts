import type { MindMapNode } from '@/types/notes';
import { BRANCHES, realChildren, ROOT_BRANCHES } from './expand';

export { BRANCHES, ROOT_BRANCHES };

/**
 * What a mind map *drawing* shows: at most a handful of branches under any node and a few levels deep.
 * A map with fifteen limbs off one node, or six levels of nesting, is technically complete and
 * impossible to read — the lines cross and the boxes shrink to nothing. Extra branches fold into one
 * "+N more" node instead of vanishing, and the Text view (MindMapOutline) still shows every line.
 *
 * Applied at render time only, so saved notes keep everything the model wrote.
 */

/** Levels below the root. */
export const DEPTH = 3;

export function tidyMindMap(root: MindMapNode, depth = DEPTH, unlimited: ReadonlySet<string> = new Set()): MindMapNode {
  // Keys match ./expand.ts ("r", "r.2"), so a Cloud bubble's "+N more" opens with the same key scheme.
  const tidy = (node: MindMapNode, key: string, level: number): MindMapNode => {
    if (level >= depth) return { title: node.title, children: [] };
    const limit = level === 0 ? ROOT_BRANCHES : BRANCHES;
    const children = realChildren(node);
    const shown = unlimited.has(key) || children.length <= limit ? children : children.slice(0, limit - 1);
    const rest = children.length - shown.length;
    return {
      title: node.title,
      children: [...shown.map(({ child, index }) => tidy(child, `${key}.${index}`, level + 1)), ...(rest > 0 ? [{ title: `+${rest} more`, children: [] }] : [])],
    };
  };
  return tidy(root, 'r', 0);
}

/** Every title under a node, counted — the "· 4" a Cloud chip shows for detail it does not draw. */
export function descendants(node: MindMapNode): number {
  return node.children.reduce((n, c) => n + 1 + descendants(c), 0);
}
