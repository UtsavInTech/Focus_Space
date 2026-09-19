import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { MindMapNode } from '@/types/notes';
import { MindMapDiagram } from './MindMapDiagram';
import { layoutMindMap } from './mindmap-layout';
import { clampZoom, fitZoom, ZOOM_STEP } from './zoom';

/**
 * A mind map with Fit / − / + — for maps bigger than the space they are shown in. Opens fitted to the
 * width available (never enlarged past 100%), then the learner can zoom in to read and scroll around.
 */
export function MindMapCanvas({ root, maxHeight }: { root: MindMapNode; maxHeight?: number | string }) {
  const frame = useRef<HTMLDivElement>(null);
  const natural = useMemo(() => layoutMindMap(root), [root]);
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

  const fitted = fitZoom(natural.width, available);
  const scale = zoom === 'fit' ? fitted : zoom;
  const step = (dir: 1 | -1) => setZoom(clampZoom(scale + dir * ZOOM_STEP));

  return (
    <div className="fs-mm-canvas">
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
      <div ref={frame} className="fs-mm-frame" style={{ maxHeight }}>
        <MindMapDiagram root={root} scale={scale} />
      </div>
    </div>
  );
}
