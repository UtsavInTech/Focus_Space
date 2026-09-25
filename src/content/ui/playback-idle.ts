import { useEffect, useRef, useState } from 'react';

/**
 * When FocusSpace's own floating controls should step aside: the way YouTube's player controls do.
 *
 * While the video plays and the person is not touching anything, the controls fade out after a few
 * seconds; the first mouse movement, click, scroll, key or touch brings them straight back; a paused
 * video keeps them up. On top of that, a control is never pulled out from under someone who is using
 * it — hovered, focused or being dragged is a `hold`, and the countdown only starts once it is let go.
 *
 * The timing is a plain controller, separate from the DOM and React, so it can be tested with fake
 * timers; `usePlaybackIdle` wires it to the page.
 */

/** YouTube hides its own controls after roughly this long; matching it makes the two feel like one. */
export const IDLE_DELAY_MS = 3000;

export interface PlaybackIdle {
  setPlaying(playing: boolean): void;
  setHold(hold: boolean): void;
  activity(): void;
  dispose(): void;
}

export function createPlaybackIdle(onChange: (idle: boolean) => void, delay = IDLE_DELAY_MS): PlaybackIdle {
  let playing = false;
  let hold = false;
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: boolean) => {
    if (next === idle) return;
    idle = next;
    onChange(idle);
  };
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  // Every reason to be visible is also a reason to restart the countdown from zero.
  const wake = () => {
    stop();
    set(false);
    if (playing && !hold) timer = setTimeout(() => set(true), delay);
  };

  return {
    setPlaying(next) {
      if (next === playing) return;
      playing = next;
      wake();
    },
    setHold(next) {
      if (next === hold) return;
      hold = next;
      wake();
    },
    activity: wake,
    dispose: stop,
  };
}

/** The watch page's own player — not the silent previews YouTube plays when a thumbnail is hovered. */
function mainVideoPlaying(): boolean {
  if (location.pathname !== '/watch') return false;
  const video = document.querySelector<HTMLVideoElement>('#movie_player video');
  return Boolean(video && !video.paused && !video.ended);
}

const MEDIA_EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied'] as const;
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * True while FocusSpace's floating controls should be hidden. `hold` keeps them up regardless — pass
 * true while the control is hovered, focused or being dragged.
 */
export function usePlaybackIdle(hold: boolean): boolean {
  const [idle, setIdle] = useState(false);
  const controller = useRef<PlaybackIdle | null>(null);

  useEffect(() => {
    const idleController = createPlaybackIdle(setIdle);
    controller.current = idleController;

    const sync = () => idleController.setPlaying(mainVideoPlaying());
    const onActivity = () => idleController.activity();

    // Media events do not bubble, but they do pass the document on the way down: capture catches them
    // for whichever <video> YouTube happens to be using, including one swapped in after navigation.
    for (const type of MEDIA_EVENTS) document.addEventListener(type, sync, true);
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: true });
    // Leaving the watch page (to home, or with the miniplayer still going) is not a media event.
    document.addEventListener('yt-navigate-finish', sync);
    sync();

    return () => {
      for (const type of MEDIA_EVENTS) document.removeEventListener(type, sync, true);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
      document.removeEventListener('yt-navigate-finish', sync);
      idleController.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    controller.current?.setHold(hold);
  }, [hold]);

  return idle;
}
