import { useState, useSyncExternalStore } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';

/**
 * Full screen for FocusSpace: only YouTube on the display. It is the browser's true full screen (the
 * Fullscreen API on the whole page), not Chrome's ⌃⌘F window mode, because that one slides the tab
 * strip back down whenever the pointer touches the top of the screen. In true full screen nothing
 * else shows; on a Mac it is its own desktop, so a three-finger swipe goes to the other windows and
 * tabs, and leaving it (the highlighted Exit button, or Esc) brings the normal window back.
 *
 * On the FocusSpace home it also hides YouTube's own top bar and sidebar (the `data-fs-wide` rules in
 * youtube/filters/css-rules.ts). A video opened from there stays full screen on YouTube's normal watch
 * page, with a floating Exit button, since the home's bar is not there.
 */

export const WIDE_ATTR = 'data-fs-wide';
const OFFER_KEY = 'focusspace:full-screen-offer';

const root = () => document.documentElement;
/** Our full screen: the whole page. A video's own player full screen is YouTube's, not ours. */
export const isFull = () => document.fullscreenElement === root();

let onHome = true;
function apply() {
  const on = isFull() && onHome;
  if (on === root().hasAttribute(WIDE_ATTR)) return;
  if (on) root().setAttribute(WIDE_ATTR, '');
  else root().removeAttribute(WIDE_ATTR);
}
if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', apply);

/** Called with the page type (ContentApp): YouTube's bars are hidden only on the FocusSpace home. */
export function syncFocusView(home: boolean) {
  onHome = home;
  apply();
}

export function enterFullScreen() {
  // Browsers allow this only from a click, which is where it is always called from.
  void root().requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
}

export function exitFullScreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

const subscribe = (listener: () => void) => {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
};

export function useFullScreen() {
  const full = useSyncExternalStore(subscribe, isFull);
  return { wide: full, toggle: () => (isFull() ? exitFullScreen() : enterFullScreen()) };
}

/** On the Space bar. While full screen it is the highlighted way out. */
export function FullScreenButton({ wide, onToggle }: { wide: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`fs-bar-tool${wide ? ' is-exit' : ''}`} onClick={onToggle} aria-pressed={wide} title={wide ? 'Back to the normal window, with your tabs (Esc)' : 'Full screen: only YouTube, no tabs or bars'}>
      {wide ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
      <span>{wide ? 'Exit full screen' : 'Full screen'}</span>
    </button>
  );
}

const offerSeen = () => {
  try {
    return localStorage.getItem(OFFER_KEY) === 'done';
  } catch {
    return true;
  }
};

/** Asked once: "Use the whole screen?" Either answer is remembered; the bar's button stays. */
export function FullScreenOffer({ wide, onAccept }: { wide: boolean; onAccept: () => void }) {
  const [open, setOpen] = useState(() => !offerSeen());
  if (!open || wide) return null;
  const done = () => {
    try {
      localStorage.setItem(OFFER_KEY, 'done');
    } catch {
      /* the offer may come back next time; nothing else depends on it */
    }
    setOpen(false);
  };
  return (
    <div className="fs-offer" role="region" aria-label="Full screen">
      <Maximize2 size={18} aria-hidden />
      <span className="fs-grow">
        <b>Use the whole screen for learning?</b>
        <small>Only YouTube on your screen: no tabs, no bars. Swipe with three fingers to reach your other windows; Esc or Exit full screen brings everything back.</small>
      </span>
      <button
        type="button"
        className="fs-cta fs-cta-primary"
        onClick={() => {
          done();
          onAccept();
        }}
      >
        Go full screen
      </button>
      <button type="button" className="fs-icon-plain" aria-label="Not now" onClick={done}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
