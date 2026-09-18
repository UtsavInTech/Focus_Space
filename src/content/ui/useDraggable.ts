import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Drag-to-move for FocusSpace's floating controls, with the position
 * remembered per control.
 *
 * Shared rather than written twice: the AI launcher and the "FocusSpace is
 * off" pill have the same job (stay out of the way of whatever the learner is
 * doing) and the same failure mode if they get it wrong (covering YouTube's
 * own controls, which differ by page, theme and window size). The only real
 * answer is letting people move them.
 *
 * Offsets are measured from the viewport edges the control is anchored to, so
 * a remembered position survives a resize instead of drifting off-screen.
 */

export interface DragOffset {
  /** Distance from the anchored horizontal edge (`left` or `right`). */
  x: number;
  /** Distance from the bottom edge. */
  y: number;
}

interface Options {
  /** localStorage key — distinct per control. */
  key: string;
  /** Which horizontal edge the control is anchored to. */
  anchor: 'left' | 'right';
  initial: DragOffset;
}

export interface Draggable {
  offset: DragOffset;
  /** True while a drag is in progress, so a click handler can ignore the release. */
  dragging: boolean;
  /** Spread onto the element that should be grabbable. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onPointerMove: (event: ReactPointerEvent) => void;
    onPointerUp: (event: ReactPointerEvent) => void;
    onPointerCancel: (event: ReactPointerEvent) => void;
  };
}

/** Below this, a pointer-down/up is a click, not a drag — otherwise a slightly shaky click would never fire. */
const DRAG_THRESHOLD_PX = 4;

function read(key: string, fallback: DragOffset): DragOffset {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DragOffset>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return fallback;
    return { x: parsed.x, y: parsed.y };
  } catch {
    // Blocked storage on youtube.com is survivable: the control just starts in its default corner.
    return fallback;
  }
}

/** Keeps a control on screen after a resize, or after a drag that overshot. */
function clamp({ x, y }: DragOffset): DragOffset {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 120)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 80)),
  };
}

export function useDraggable({ key, anchor, initial }: Options): Draggable {
  const [offset, setOffset] = useState<DragOffset>(initial);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; from: DragOffset; moved: boolean } | null>(null);

  useEffect(() => setOffset(clamp(read(key, initial))), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => setOffset((o) => clamp(o));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      // A control inside the handle (close, turn on) keeps its own click.
      if ((event.target as HTMLElement).closest('[data-no-drag]')) return;
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      start.current = { x: event.clientX, y: event.clientY, from: offset, moved: false };
    },
    [offset],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = event.clientX - s.x;
    const dy = event.clientY - s.y;
    if (!s.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    if (!s.moved) {
      s.moved = true;
      setDragging(true);
    }
    // Both controls sit on the bottom edge; the horizontal sign depends on which side they hug.
    setOffset(clamp({ x: anchor === 'right' ? s.from.x - dx : s.from.x + dx, y: s.from.y - dy }));
  }, [anchor]);

  const end = useCallback(
    (event: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      if (!s?.moved) return;
      // Let the click handler see `dragging` before it is cleared, so a drag never counts as a click.
      requestAnimationFrame(() => setDragging(false));
      try {
        localStorage.setItem(key, JSON.stringify(offset));
      } catch {
        /* see read() */
      }
    },
    [key, offset],
  );

  return {
    offset,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
  };
}
