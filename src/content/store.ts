import type { LearningMode, Settings } from '@/types/domain';
import type { VideoMetadata } from '@/learning/classifier';
import type { PageContext } from '@/integrations/youtube/urls';
import type { WatchPage } from '@/integrations/youtube/innertube-client';
import type { MarkStats } from './youtube/filters/relevance-marker';

export interface WatchState {
  id: string;
  status: 'loading' | 'ready' | 'error';
  data: WatchPage | null;
}

/** In-memory state of the content script, shared by the controller and React. */
export interface ContentState {
  ready: boolean;
  settings: Settings;
  modes: LearningMode[];
  page: PageContext;
  prevUrl: string | null;
  video: { id: string; meta: VideoMetadata | null; failed: boolean } | null;
  /** YouTube's own watch-page data for the current video (related, playlist, owner). */
  watch: WatchState | null;
  searchStats: MarkStats | null;
  searchReveal: boolean;
  showNativeRelated: boolean;
  slots: { home: boolean; watch: boolean; search: boolean; guide: boolean; aiEntry: boolean };
  /** The home view mounts on first visit and then stays mounted, so its state survives navigation. */
  homeVisited: boolean;
  ytDark: boolean;
  dismissedNudges: string[];
  exploreAllowed: string[];
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      const changed = Object.entries(next).some(([k, v]) => !Object.is(state[k as keyof T], v));
      if (!changed) return;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
