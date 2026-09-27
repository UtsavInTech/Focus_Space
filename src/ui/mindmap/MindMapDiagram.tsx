import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { MindMapNode } from '@/types/notes';
import { BRANCH_COLORS, connector, FONT, layoutMindMap, LINE_H, PAD_X, PAD_Y, type LaidNode } from './mindmap-layout';
import { CARD_PAD, CHIP_LINE, CHIP_PAD_X, cloudConnector, cloudPath, DETAIL_FONT, DETAIL_LINE, layoutCloud, TITLE_FONT, TITLE_LINE } from './cloud-layout';
import { initialView, showAll, toggleNode, visibleTree, type MapView, type NodeMeta } from './expand';

/** The subject's colour in both views — the tree's root uses the first branch colour too. */
const BRAND = BRANCH_COLORS[0];

/** Two drawings of the same map: how ideas nest (tree), and what belongs together (cloud). */
export type MindMapVariant = 'tree' | 'cloud';

/** What is open in each view (./expand.ts). Held by whoever needs to know the drawing's size — MindMapCanvas. */
export interface MapState {
  tree: MapView;
  /** Cloud: lists opened past "+N more", and chips opened to show their detail — the same keys. */
  cloud: ReadonlySet<string>;
}
export const initialMapState = (): MapState => ({ tree: initialView(), cloud: new Set() });

/** Map state that starts over whenever a different map is shown. */
export function useMapState(root: MindMapNode): [MapState, (next: MapState) => void] {
  const [state, setState] = useState(initialMapState);
  useEffect(() => setState(initialMapState()), [root]);
  return [state, setState];
}

/** Size of a variant's drawing in the given state, before any zoom — what MindMapCanvas fits to its frame. */
export function mindMapSize(root: MindMapNode, variant: MindMapVariant, state: MapState = initialMapState()): { width: number; height: number } {
  return variant === 'cloud' ? layoutCloud(root, state.cloud) : layoutMindMap(visibleTree(root, state.tree).tree);
}

/**
 * A mind map drawn as an actual map: the video's subject at the left, its
 * branches fanning out to the right, each branch in its own colour. It opens
 * showing the main topics only; a topic opens to show what is inside it
 * (./expand.ts), so a long course is explored one level at a time instead of
 * drawn as a wall of lines.
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
export function MindMapDiagram({
  root,
  scale = 1,
  variant = 'tree',
  state,
  onState,
  fit = false,
}: {
  root: MindMapNode;
  scale?: number;
  variant?: MindMapVariant;
  /** Shrink to the width available (never below FIT_FLOOR) — the narrow panel preview, where scrolling sideways to find the subject felt broken. */
  fit?: boolean;
  /** Pass both to control what is open (MindMapCanvas does, to size the frame); omit to let the diagram keep its own. */
  state?: MapState;
  onState?: (next: MapState) => void;
}) {
  const [own, setOwn] = useMapState(root);
  const current = state ?? own;
  const update = onState ?? setOwn;
  const box = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!fit || !el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);
  const natural = useMemo(() => (fit ? mindMapSize(root, variant, current).width : 0), [fit, root, variant, current]);
  const shown = fit && available && natural ? Math.min(scale, Math.max(FIT_FLOOR, available / natural)) : scale;
  const drawing = variant === 'cloud' ? (
    <CloudDiagram
      root={root}
      scale={shown}
      opened={current.cloud}
      onToggle={(key) => {
        const cloud = new Set(current.cloud);
        if (cloud.has(key)) cloud.delete(key);
        else cloud.add(key);
        update({ ...current, cloud });
      }}
    />
  ) : (
    <TreeDiagram root={root} scale={shown} view={current.tree} onView={(tree) => update({ ...current, tree })} />
  );
  return fit ? <div ref={box}>{drawing}</div> : drawing;
}

/** The smallest a fitted preview gets; below this the text is unreadable, and Expand is the way in. */
const FIT_FLOOR = 0.55;

const badgeText = (m: NodeMeta) => (m.open ? '−' : `+${m.childCount}`);
/** Sized to its text: "+4" and "+16" both sit inside their pill. */
const badgeWidth = (m: NodeMeta) => (m.open ? 18 : 10 + badgeText(m).length * 6.5);

/** Enter or Space on a focused node does what a click does. */
const onActivate = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
};

function TreeDiagram({ root, scale, view, onView }: { root: MindMapNode; scale: number; view: MapView; onView: (view: MapView) => void }) {
  const { nodes, width, height, meta } = useMemo(() => {
    const visible = visibleTree(root, view);
    return { ...layoutMindMap(visible.tree), meta: visible.meta };
  }, [root, view]);
  const byParent = useMemo(() => nodes.flatMap((n) => n.children.map((c) => ({ from: n, to: c }))), [nodes]);

  const act = (m: NodeMeta | undefined) => {
    if (!m) return;
    if (m.moreOf) onView(showAll(view, m.moreOf));
    else if (m.childCount && m.key !== 'r') onView(toggleNode(view, m.key));
  };
  const label = (node: LaidNode, m: NodeMeta) =>
    m.moreOf ? `Show ${node.title.slice(1)}` : `${node.title}: ${m.open ? 'hide' : 'show'} ${m.childCount} ${m.childCount === 1 ? 'idea' : 'ideas'} inside`;

  return (
    <div className="fs-mindmap" role="group" aria-label={`Mind map: ${root.title}`}>
      <svg width={Math.round(width * scale)} height={Math.round(height * scale)} viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
        {byParent.map(({ from, to }, i) => (
          <path key={i} d={connector(from, to)} fill="none" stroke={to.color} strokeWidth={to.depth === 1 ? 1.75 : 1.25} strokeOpacity={to.depth === 1 ? 0.7 : 0.45} strokeLinecap="round" />
        ))}
        {nodes.map((node) => {
          const m = meta.get(node.source);
          const clickable = !!m && (!!m.moreOf || (m.childCount > 0 && node.depth > 0));
          return (
            <g
              key={m?.key ?? node.title}
              transform={`translate(${node.x}, ${node.y - node.h / 2})`}
              {...(clickable && m ? { role: 'button', tabIndex: 0, 'aria-expanded': m.moreOf ? undefined : m.open, 'aria-label': label(node, m), onClick: () => act(m), onKeyDown: onActivate(() => act(m)) } : {})}
              className={clickable ? 'fs-mm-node is-clickable' : 'fs-mm-node'}
            >
              <rect
                width={node.w}
                height={node.h}
                rx={node.depth === 0 ? 10 : 8}
                fill={node.depth === 0 ? node.color : 'var(--fs-surface-2)'}
                stroke={node.depth === 0 ? 'none' : node.color}
                strokeOpacity={m?.moreOf ? 0.7 : node.depth === 1 ? 0.55 : 0.3}
                strokeDasharray={m?.moreOf ? '4 3' : undefined}
              />
              {node.lines.map((line, li) => (
                <text
                  key={li}
                  x={PAD_X}
                  y={PAD_Y + LINE_H * li + FONT}
                  fontSize={FONT}
                  fontWeight={node.depth === 0 ? 650 : node.depth === 1 || m?.moreOf ? 560 : 400}
                  fill={node.depth === 0 ? '#ffffff' : m?.moreOf ? node.color : 'var(--fs-text)'}
                >
                  {line}
                </text>
              ))}
              {/* What is inside a closed topic, or − to close an open one: the handle that says "this opens". */}
              {m && !m.moreOf && m.childCount > 0 && node.depth > 0 && (
                <g transform={`translate(${node.w}, ${node.h / 2})`} aria-hidden>
                  <rect x={-2} y={-9} width={badgeWidth(m)} height={18} rx={9} fill={node.color} />
                  <text x={-2 + badgeWidth(m) / 2} y={4} fontSize={11} fontWeight={650} textAnchor="middle" fill="#ffffff">
                    {badgeText(m)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * The Cloud view (./cloud-layout.ts): the subject in a round cloud in the middle, each topic a tinted
 * cloud around it holding its sub-topic chips. Colours match the Tree view's branches, so the two read
 * as one map. A chip with "· n" opens to list its detail; "+N more" opens the rest of a list.
 */
function CloudDiagram({ root, scale, opened, onToggle }: { root: MindMapNode; scale: number; opened: ReadonlySet<string>; onToggle: (key: string) => void }) {
  const layout = useMemo(() => layoutCloud(root, opened), [root, opened]);
  const rootPath = useMemo(() => cloudPath(layout.root.w, layout.root.h, true), [layout.root.w, layout.root.h]);
  const { width, height } = layout;
  const button = (key: string, label: string, expanded?: boolean) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    ...(expanded === undefined ? {} : { 'aria-expanded': expanded }),
    className: 'fs-mm-node is-clickable',
    onClick: () => onToggle(key),
    onKeyDown: onActivate(() => onToggle(key)),
  });
  return (
    <div className="fs-mindmap" role="group" aria-label={`Mind map, cloud view: ${root.title}`}>
      <svg width={Math.round(width * scale)} height={Math.round(height * scale)} viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
        {layout.cards.map((c, i) => (
          <path key={i} d={cloudConnector(layout.root, c)} fill="none" stroke={c.color} strokeWidth={1.75} strokeOpacity={0.55} strokeLinecap="round" />
        ))}
        <g transform={`translate(${layout.root.x}, ${layout.root.y})`}>
          <path d={rootPath} fill={BRAND} />
          {layout.root.lines.map((line, li) => (
            <text key={li} x={layout.root.w / 2} y={layout.root.h / 2 - ((layout.root.lines.length - 1) * 18) / 2 + 5 + 18 * li} fontSize={14} fontWeight={650} textAnchor="middle" fill="#ffffff">
              {line}
            </text>
          ))}
        </g>
        {layout.cards.map((c, i) => (
          <g key={i} transform={`translate(${c.x}, ${c.y})`} {...(c.moreOf ? button(c.moreOf, `Show ${c.lines.join(' ').slice(1)} topics`) : {})}>
            <path d={cloudPath(c.w, c.h)} fill={c.color} fillOpacity={0.09} stroke={c.color} strokeOpacity={0.55} strokeWidth={1.25} strokeDasharray={c.moreOf ? '4 3' : undefined} />
            {c.lines.map((line, li) => (
              <text key={li} x={CARD_PAD} y={CARD_PAD + TITLE_LINE * li + TITLE_FONT} fontSize={TITLE_FONT} fontWeight={620} fill={c.moreOf ? c.color : 'var(--fs-text)'}>
                {line}
              </text>
            ))}
            {c.chips.map((chip, ci) => {
              const handle = chip.moreOf ? button(chip.moreOf, `Show ${chip.lines.join(' ').slice(1)}`) : chip.key ? button(chip.key, `${chip.lines.join(' ')}: ${chip.open ? 'hide' : 'show'} what is inside`, chip.open) : {};
              return (
                <g key={ci}>
                  <g transform={`translate(${chip.x}, ${chip.y})`} {...handle}>
                    <rect
                      width={chip.w}
                      height={chip.h}
                      rx={12}
                      fill={chip.moreOf || chip.open ? c.color : 'var(--fs-surface)'}
                      fillOpacity={chip.moreOf || chip.open ? 0.16 : 1}
                      stroke={c.color}
                      strokeOpacity={chip.moreOf || chip.key ? 0.8 : 0.35}
                      strokeDasharray={chip.moreOf ? '4 3' : undefined}
                    />
                    {chip.lines.map((line, li) => (
                      <text key={li} x={CHIP_PAD_X} y={16.5 + CHIP_LINE * li} fontSize={FONT} fontWeight={chip.moreOf || chip.open ? 600 : 400} fill="var(--fs-text)">
                        {line}
                      </text>
                    ))}
                  </g>
                  {chip.details?.map((d, di) =>
                    d.lines.map((line, li) => (
                      <text key={`${di}-${li}`} x={CARD_PAD + (li ? 18 : 8)} y={d.y + DETAIL_LINE * li + DETAIL_FONT} fontSize={DETAIL_FONT} fill="var(--fs-text-2)">
                        {li ? line : `• ${line}`}
                      </text>
                    )),
                  )}
                </g>
              );
            })}
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
