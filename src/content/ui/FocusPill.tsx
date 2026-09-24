import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { Power } from 'lucide-react';
import { OverlayRootContext } from '@/ui/components/Modal';
import { setFocusEnabled } from '@/modes/service';
import { FocusMark } from '@/ui/components/primitives';
import { useDraggable } from './useDraggable';

/**
 * FocusSpace's switch, always on the page: one small pill that turns Focus Mode on and off.
 *
 * It used to appear only while FocusSpace was off, which made turning it *off* a hunt through the
 * sidebar. Being always present makes the state obvious and the switch one click away, and dragging it
 * keeps it out of the way of whatever the page puts underneath.
 *
 * The mark is FocusSpace's target-and-play alone, not the boxed logo: at this size, sitting over
 * YouTube's own chrome, a filled tile read as a third-party badge stuck to the page. An outline mark in
 * the current colour belongs to the page instead — accent and turning while focus is on, quiet grey and
 * still while it is off, which makes the state readable at a glance without any text.
 */
export function FocusPill({ on }: { on: boolean }) {
  const overlayRoot = useContext(OverlayRootContext);
  const [collapsed, setCollapsed] = useState(false);
  const drag = useDraggable({ key: 'focusspace.off.pos', anchor: 'left', initial: { x: 20, y: 20 } });

  if (!overlayRoot) return null;

  const style = { left: drag.offset.x, bottom: drag.offset.y };
  const toggle = () => void setFocusEnabled(!on);

  // Collapsed: a logo button. Still visible, still draggable, still one click from being useful.
  if (collapsed) {
    return createPortal(
      <button
        type="button"
        className={`fs-off-mini${drag.dragging ? ' is-dragging' : ''}`}
        data-on={on ? 'true' : undefined}
        style={style}
        aria-label={`FocusSpace is ${on ? 'on' : 'off'} — show the switch`}
        title={`FocusSpace is ${on ? 'on' : 'off'} — drag to move, click to show`}
        {...drag.handlers}
        onClick={() => !drag.dragging && setCollapsed(false)}
      >
        <FocusMark size={19} active={on} />
      </button>,
      overlayRoot,
    );
  }

  return createPortal(
    <div className={`fs-off-pill${drag.dragging ? ' is-dragging' : ''}`} data-on={on ? 'true' : undefined} style={style} title="Drag to move" {...drag.handlers}>
      <FocusMark size={18} active={on} />
      {/* Off, it has to be found; on, it only has to be reachable — so it shrinks to the switch itself. */}
      {!on && <span className="fs-off-pill-text">FocusSpace</span>}
      <button type="button" className="fs-off-pill-on" data-no-drag aria-pressed={on} aria-label={on ? 'Turn FocusSpace off' : 'Turn FocusSpace on'} title={on ? 'Turn FocusSpace off' : 'Turn FocusSpace on'} onClick={toggle}>
        <Power size={13} aria-hidden /> {on ? '' : 'Turn on'}
      </button>
      <button type="button" className="fs-off-pill-x" data-no-drag aria-label="Collapse to a small button" title="Collapse" onClick={() => setCollapsed(true)}>
        <span aria-hidden>–</span>
      </button>
    </div>,
    overlayRoot,
  );
}
