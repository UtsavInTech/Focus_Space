import { useEffect, useMemo, useState } from 'react';
import type { LearningMode, ThemePreference } from '@/types/domain';
import type { StorageKey, StorageSchema } from '@/storage/schema';
import { getItem, getItems, subscribe } from '@/storage/storage';
import { fingerprintOf, hydrateModeCache } from '@/learning/classifier';
import { buildModeLibrary, type ModeLibrary } from '@/learning/library';

/** Live view of storage keys; null until the first read completes. */
export function useStorage<K extends StorageKey>(keys: readonly K[]): Pick<StorageSchema, K> | null {
  const [data, setData] = useState<Pick<StorageSchema, K> | null>(null);
  const signature = keys.join('|');
  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribe(keys, (changes) => setData((prev) => (prev ? { ...prev, ...changes } : prev)));
    getItems(keys).then((initial) => alive && setData((prev) => (prev ? { ...initial, ...prev } : initial)));
    return () => {
      alive = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return data;
}

export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** Applies the theme + density to <html> on extension pages. */
export function useDocumentTheme(theme: ThemePreference | undefined, density: 'comfortable' | 'compact' | undefined) {
  const prefersDark = usePrefersDark();
  const resolved = theme === 'dark' || (theme !== 'light' && prefersDark) ? 'dark' : 'light';
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-density', density ?? 'comfortable');
  }, [resolved, density]);
  return resolved;
}

export interface LibraryState {
  loading: boolean;
  library: ModeLibrary | null;
  channelCount: number;
  sync: StorageSchema['sync'] | null;
}

/** Modes whose persisted classifications were already loaded in this page. */
const hydratedModes = new Set<string>();

/**
 * Subscription library for a mode. Loads the persisted classification cache
 * first (so thousands of videos aren't re-classified on every page load),
 * then recomputes only when videos, channels or the mode change.
 */
export function useModeLibrary(mode: LearningMode | null): LibraryState {
  const data = useStorage(['videos', 'channels', 'sync', 'preferenceProfiles'] as const);
  const key = mode ? `${mode.id}|${fingerprintOf(mode)}` : null;
  const [readyKey, setReadyKey] = useState<string | null>(() => (key && hydratedModes.has(key) ? key : null));

  useEffect(() => {
    if (!mode || !key) return;
    if (hydratedModes.has(key)) {
      setReadyKey(key);
      return;
    }
    let alive = true;
    getItem('relevanceCache')
      .then((store) => hydrateModeCache(mode, store.modes[mode.id]))
      .catch(() => false)
      .finally(() => {
        hydratedModes.add(key);
        if (alive) setReadyKey(key);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ready = !!key && readyKey === key;
  const affinity = mode ? data?.preferenceProfiles.modes[mode.id]?.channels : undefined;
  const library = useMemo(() => (data && mode && ready ? buildModeLibrary(mode, data.videos, data.channels, affinity) : null), [data?.videos, data?.channels, mode, ready, affinity]);
  return {
    loading: !data || (!!mode && !ready),
    library,
    channelCount: data ? Object.keys(data.channels).length : 0,
    sync: data?.sync ?? null,
  };
}
