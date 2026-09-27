import { useContext, useEffect, useState, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { Power } from 'lucide-react';
import { OverlayRootContext } from '@/ui/components/Modal';
import { setFocusEnabled } from '@/modes/service';
import { FocusMark } from '@/ui/components/primitives';
import { useDraggable } from './useDraggable';
import { usePlaybackIdle } from './playback-idle';

/**
 * FocusSpace's switch, always on the page: one small pill that turns Focus Mode on and off.
 *
 * It used to appear only while FocusSpace was off, which made turning it *off* a hunt through the
 * sidebar. Being always present makes the state obvious and the switch one click away, and dragging it
 * keeps it out of the way of whatever the page puts underneath.
 *
 * The mark is FocusSpace's target-and-play alone, not a boxed tile: at this size, sitting over YouTube's
 * own chrome, a filled square read as a third-party badge stuck to the page. On, it is the brand red and
 * the ring turns; off, it drops to `tone="current"` and inherits the pill's muted grey and stops moving.
 * That makes the state readable at a glance with no label at all.
 *
 * While a video plays it behaves like YouTube's own controls: untouched for a few seconds, it fades out
 * of the picture; any movement brings it back (see playback-idle.ts). It is never hidden from someone
 * pointing at it, tabbing to it or dragging it.
 *
 * Fullscreen remembers its own place. One position for both used to put the switch wherever it had been
 * dragged on the page — below the video, say — which in a fullscreen window lands on YouTube's control
 * bar. So fullscreen starts bottom-left, above that bar, and keeps wherever it is dragged to there.
 */
function useFullscreen(): boolean {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return full;
}

export function FocusPill({ on }: { on: boolean }) {
  const overlayRoot = useContext(OverlayRootContext);
  const [collapsed, setCollapsed] = useState(false);
  const fullscreen = useFullscreen();
  const drag = useDraggable(
    fullscreen
      ? // Clear of YouTube's fullscreen control bar and progress line.
        { key: 'focusspace.off.pos.fullscreen', anchor: 'left', initial: { x: 24, y: 96 } }
      : { key: 'focusspace.off.pos', anchor: 'left', initial: { x: 20, y: 20 } },
  );
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const idle = usePlaybackIdle(hovered || focused || drag.dragging);
  // Swapping forms unmounts the element that was hovered and focused, and an unmounted element fires no
  // blur or pointerleave — so the hold is released here, or the switch would never fade again.
  const collapse = (next: boolean) => {
    setHovered(false);
    setFocused(false);
    setCollapsed(next);
  };
  // Shared by both forms: what holds the switch up, and the attribute that fades it (content.css).
  const presence = {
    'data-idle': idle ? 'true' : undefined,
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    // Keyboard focus only. A mouse click leaves the button focused too, and holding for that kept the
    // switch on screen for good after one click — it never faded during playback again.
    onFocus: (e: FocusEvent) => setFocused((e.target as Element).matches(':focus-visible')),
    onBlur: (e: FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    },
  };

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
        {...presence}
        aria-label={`FocusSpace is ${on ? 'on' : 'off'}, show the switch`}
        title={`FocusSpace is ${on ? 'on' : 'off'}. Drag to move, click to show`}
        {...drag.handlers}
        onClick={() => !drag.dragging && collapse(false)}
      >
        <FocusMark size={19} active={on} tone={on ? 'brand' : 'current'} />
      </button>,
      overlayRoot,
    );
  }

  return createPortal(
    <div className={`fs-off-pill${drag.dragging ? ' is-dragging' : ''}`} data-on={on ? 'true' : undefined} style={style} title="Drag to move" {...presence} {...drag.handlers}>
      <FocusMark size={18} active={on} tone={on ? 'brand' : 'current'} />
      {/* Off, it has to be found; on, it only has to be reachable — so it shrinks to the switch itself. */}
      {!on && <span className="fs-off-pill-text">FocusSpace</span>}
      <button type="button" className="fs-off-pill-on" data-no-drag aria-pressed={on} aria-label={on ? 'Turn FocusSpace off' : 'Turn FocusSpace on'} title={on ? 'Turn FocusSpace off' : 'Turn FocusSpace on'} onClick={toggle}>
        <Power size={13} aria-hidden /> {on ? '' : 'Turn on'}
      </button>
      <button type="button" className="fs-off-pill-x" data-no-drag aria-label="Collapse to a small button" title="Collapse" onClick={() => collapse(true)}>
        <span aria-hidden>–</span>
      </button>
    </div>,
    overlayRoot,
  );
}
