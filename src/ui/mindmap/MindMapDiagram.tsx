import { useMemo } from 'react';
import type { MindMapNode } from '@/types/notes';
import { connector, FONT, layoutMindMap, LINE_H, PAD_X, PAD_Y } from './mindmap-layout';

/**
 * A mind map drawn as an actual map: the video's subject at the left, its
 * branches fanning out to the right, each branch in its own colour.
 *
 * Inline SVG rather than a diagramming library. This renders inside a shadow
 * root on youtube.com under an extension CSP, where a library that injects
 * stylesheets or evaluates layout against `document` is a liability; the
 * layout (./mindmap-layout.ts) is a few dozen lines of arithmetic and gives exact
 * control over how it looks in both themes. Colours come from the FocusSpace
 * token set, so the diagram matches everything around it.
 *
 * The tree it draws is already built deterministically by `parseMindMap`
 * (learning/notes/mindmap.ts) — no extra AI call is made to produce the
 * picture, so the diagram costs nothing beyond the note itself.
 */

/** `scale` resizes the drawing itself (not a CSS transform), so text stays crisp at any zoom. */
export function MindMapDiagram({ root, scale = 1 }: { root: MindMapNode; scale?: number }) {
  const { nodes, width, height } = useMemo(() => layoutMindMap(root), [root]);
  const byParent = useMemo(() => nodes.flatMap((n) => n.children.map((c) => ({ from: n, to: c }))), [nodes]);

  return (
    <div className="fs-mindmap" role="img" aria-label={`Mind map: ${root.title}`}>
      <svg width={Math.round(width * scale)} height={Math.round(height * scale)} viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
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
