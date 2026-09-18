import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { Power } from 'lucide-react';
import { OverlayRootContext } from '@/ui/components/Modal';
import { setFocusEnabled } from '@/modes/service';
import { LogoMark } from '@/ui/components/primitives';
import { useDraggable } from './useDraggable';

/**
 * What FocusSpace looks like when it is switched off: one small pill, and
 * nothing else.
 *
 * With Focus Mode off, the home view, the sidebar section and the watch rail
 * are all unmounted — YouTube is exactly YouTube. That is the point, but it
 * also means this pill is the only way back in, so it must never be possible
 * to get rid of it and be stranded. It collapses to a logo button instead of
 * disappearing, and it can be dragged anywhere that suits the page.
 */
export function FocusOffPill() {
  const overlayRoot = useContext(OverlayRootContext);
  const [collapsed, setCollapsed] = useState(false);
  const drag = useDraggable({ key: 'focusspace.off.pos', anchor: 'left', initial: { x: 20, y: 20 } });

  if (!overlayRoot) return null;

  const style = { left: drag.offset.x, bottom: drag.offset.y };

  // Collapsed: a logo button. Still visible, still draggable, still one click from being useful.
  if (collapsed) {
    return createPortal(
      <button
        type="button"
        className={`fs-off-mini${drag.dragging ? ' is-dragging' : ''}`}
        style={style}
        aria-label="FocusSpace is off — show controls"
        title="FocusSpace is off — drag to move, click to show"
        {...drag.handlers}
        onClick={() => !drag.dragging && setCollapsed(false)}
      >
        <LogoMark size={20} />
      </button>,
      overlayRoot,
    );
  }

  return createPortal(
    <div className={`fs-off-pill${drag.dragging ? ' is-dragging' : ''}`} style={style} title="Drag to move" {...drag.handlers}>
      <LogoMark size={18} />
      <span className="fs-off-pill-text">FocusSpace is off</span>
      <button type="button" className="fs-off-pill-on" data-no-drag onClick={() => void setFocusEnabled(true)}>
        <Power size={13} aria-hidden /> Turn on
      </button>
      <button type="button" className="fs-off-pill-x" data-no-drag aria-label="Collapse to a small button" title="Collapse" onClick={() => setCollapsed(true)}>
        <span aria-hidden>–</span>
      </button>
    </div>,
    overlayRoot,
  );
}
