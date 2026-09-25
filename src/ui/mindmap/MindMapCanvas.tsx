import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Maximize, Minus, Plus } from 'lucide-react';
import type { MindMapNode } from '@/types/notes';
import { initialMapState, MindMapDiagram, mindMapSize, useMapState, type MapState, type MindMapVariant } from './MindMapDiagram';
import { expandAll } from './expand';
import { clampZoom, fitZoom, ZOOM_STEP } from './zoom';

/**
 * A mind map with Fit / − / + and Expand all / Collapse — for maps bigger than the space they are shown
 * in. Opens fitted to the width available (never enlarged past 100%) showing the main topics; the learner
 * opens topics by clicking them, zooms in to read, and scrolls around.
 */
export function MindMapCanvas({ root, maxHeight, variant = 'tree' }: { root: MindMapNode; maxHeight?: number | string; variant?: MindMapVariant }) {
  const frame = useRef<HTMLDivElement>(null);
  const [state, setState] = useMapState(root);
  const natural = useMemo(() => mindMapSize(root, variant, state), [root, variant, state]);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A different drawing has a different size: start it fitted, not at the last view's zoom.
  useEffect(() => setZoom('fit'), [variant]);

  const fitted = fitZoom(natural.width, available);
  const scale = zoom === 'fit' ? fitted : zoom;
  const step = (dir: 1 | -1) => setZoom(clampZoom(scale + dir * ZOOM_STEP));
  // Opening one topic keeps the zoom it was opened at; re-fitting would shrink the text under the pointer.
  const open = (next: MapState) => {
    if (zoom === 'fit') setZoom(scale);
    setState(next);
  };
  const everything = () => {
    const all = expandAll(root);
    setState({ tree: all, cloud: all.all });
    setZoom('fit');
  };
  const collapse = () => {
    setState(initialMapState());
    setZoom('fit');
  };

  return (
    <div className="fs-mm-canvas">
      <div className="fs-mm-toolbar">
        <div className="fs-mm-controls" role="group" aria-label="Zoom">
          <button type="button" onClick={() => step(-1)} aria-label="Zoom out">
            <Minus size={14} aria-hidden />
          </button>
          <span aria-live="polite">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => step(1)} aria-label="Zoom in">
            <Plus size={14} aria-hidden />
          </button>
          <button type="button" onClick={() => setZoom('fit')} aria-pressed={zoom === 'fit'}>
            <Maximize size={14} aria-hidden /> Fit
          </button>
        </div>
        <div className="fs-mm-controls" role="group" aria-label="Topics">
          <button type="button" onClick={everything}>
            <ChevronsUpDown size={14} aria-hidden /> Expand all
          </button>
          <button type="button" onClick={collapse}>
            <ChevronsDownUp size={14} aria-hidden /> Collapse
          </button>
        </div>
        <span className="fs-mm-hint">Click a topic to open it</span>
      </div>
      <div ref={frame} className="fs-mm-frame" style={{ maxHeight }}>
        <MindMapDiagram root={root} scale={scale} variant={variant} state={state} onState={open} />
      </div>
    </div>
  );
}
