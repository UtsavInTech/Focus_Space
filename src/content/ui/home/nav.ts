import { useCallback, useSyncExternalStore } from 'react';

/**
 * Where the home is: which topic or subject of which Space is open. Shared, so YouTube's sidebar can
 * open "NEET → Chemistry" on the home as well as the home's own bar and path can. Remembered per Space:
 * a topic chosen for NEET never shows up as the selection in another Space.
 */

interface HomeNav {
  modeId: string | null;
  topicId: string | null;
}

let state: HomeNav = { modeId: null, topicId: null };
const listeners = new Set<() => void>();

/*
 * Where the learner last went in each Space (a topic or "group:mains"), so the path's "You are here"
 * follows them to Mains or the Interview instead of staying on the first stage. A per-browser
 * convenience: without storage it is simply forgotten.
 */
const LAST_KEY = 'focusspace:last-place';
export interface Place {
  topicId: string;
  at: number;
}
let last: Record<string, Place> = (() => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, Place>;
  } catch {
    return {};
  }
})();
function remember(modeId: string, topicId: string) {
  last = { ...last, [modeId]: { topicId, at: Date.now() } };
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(last));
  } catch {
    /* kept for this page only */
  }
}
export const lastPlace = (modeId: string): Place | null => last[modeId] ?? null;

export const homeNav = {
  get: () => state,
  set(next: HomeNav) {
    if (next.modeId === state.modeId && next.topicId === state.topicId) return;
    if (next.modeId && next.topicId) remember(next.modeId, next.topicId);
    state = next;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** The open topic (or "group:…" subject) for this Space, and the way to change it. */
export function useHomeTopic(modeId: string | null): [string | null, (id: string | null) => void] {
  const nav = useSyncExternalStore(homeNav.subscribe, homeNav.get);
  const topicId = nav.modeId === modeId ? nav.topicId : null;
  const setTopic = useCallback((id: string | null) => homeNav.set({ modeId, topicId: id }), [modeId]);
  return [topicId, setTopic];
}
