import type { MindMapNode } from '@/types/notes';

/**
 * Parses the constrained outline format the mindmap prompt asks for: one
 * title per line, nested under its parent by 2-space indentation, no
 * markdown headers, no prose. Deterministic — the AI call only produces the
 * raw text; turning it into a tree needs no model.
 *
 * `MindMapNode` (src/types/notes.ts) is a single root, so multiple top-level
 * lines are wrapped under a synthetic root titled `rootTitle`.
 */
export function parseMindMap(text: string, rootTitle: string): MindMapNode | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;

  const roots: MindMapNode[] = [];
  const stack: { depth: number; node: MindMapNode }[] = [];
  for (const raw of lines) {
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const depth = Math.floor(indent / 2);
    const title = raw.trim().replace(/^[-*]\s*/, '');
    if (!title) continue;
    const node: MindMapNode = { title, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ depth, node });
  }
  if (!roots.length) return null;
  return roots.length === 1 ? roots[0] : { title: rootTitle, children: roots };
}
