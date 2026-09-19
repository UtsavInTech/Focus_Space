import { getItems, setItem, subscribe } from '@/storage/storage';
import type { RelevanceCacheStore } from '@/storage/schema';
import { buildModeLibrary } from '@/learning/library';
import { buildFeedView, type FeedView, type FeedViewStore } from '@/learning/feed-view';
import { cacheMisses, exportModeCache, hydrateModeCache, type ModeCacheSnapshot } from '@/learning/classifier';
import { CLASSIFIER_VERSION } from '@/learning/relevance/lexicon';
import { hashString } from '@/learning/relevance/matcher';
import { findMode } from '@/modes/service';
import { ownerGuard } from '@/storage/ownership';

/**
 * Expensive, library-wide work happens here, not on YouTube pages:
 *
 * - feedViews: a small ready-to-render feed per space (read by YouTube pages)
 * - relevanceCache: persisted classifications for the active/default spaces
 *   (used by the dashboard's full library views)
 *
 * Debounced, incremental (classification cache), and only writes storage
 * when something actually changed.
 */

const DEBOUNCE_MS = 2500;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let rerun = false;
const viewHashes = new Map<string, string>();

export function startRelevanceWarmer(): void {
  subscribe(['modes', 'videos', 'channels'], () => schedule(DEBOUNCE_MS));
  subscribe(['settings'], () => schedule(500));
  schedule(1000);
}

function schedule(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void run(), delay);
}

async function run() {
  if (running) {
    rerun = true;
    return;
  }
  running = warm()
    .then(() => undefined)
    .catch((err) => console.warn('[FocusSpace] relevance warm-up failed', err))
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        schedule(DEBOUNCE_MS);
      }
    });
}

export async function warm(): Promise<{ written: boolean }> {
  const stillOwner = await ownerGuard(); // computed from one person's data, never written into another's
  const { modes, settings, videos, channels, relevanceCache, feedViews, preferenceProfiles } = await getItems(['modes', 'settings', 'videos', 'channels', 'relevanceCache', 'feedViews', 'preferenceProfiles']);

  // Feed views for every space (so switching spaces is instant).
  const nextViews: FeedViewStore = { version: CLASSIFIER_VERSION, channelIds: Object.keys(channels), modes: {} };
  let viewsChanged = feedViews.version !== CLASSIFIER_VERSION || feedViews.channelIds.length !== nextViews.channelIds.length;
  for (const mode of modes) {
    hydrateModeCache(mode, relevanceCache.modes[mode.id]);
    const view = buildFeedView(mode, videos, channels, preferenceProfiles.modes[mode.id]?.channels);
    const hash = hashString(JSON.stringify({ ...view, computedAt: 0 }));
    const previous = feedViews.modes[mode.id];
    if (!previous || viewHashes.get(mode.id) !== hash || previous.fingerprint !== view.fingerprint) viewsChanged = true;
    viewHashes.set(mode.id, hash);
    nextViews.modes[mode.id] = previous && viewHashes.get(mode.id) === hash && !viewsChanged ? previous : view;
  }
  if (Object.keys(feedViews.modes).some((id) => !nextViews.modes[id])) viewsChanged = true;
  if (!(await stillOwner())) return { written: false };
  if (viewsChanged) await setItem('feedViews', nextViews);

  // Persist classification snapshots for the spaces the user actually uses.
  const videoIds = Object.keys(videos);
  const targets = [...new Set([settings.activeModeId, settings.defaultModeId])].map((id) => findMode(modes, id)).filter((m) => !!m);
  const nextCache: RelevanceCacheStore = { version: CLASSIFIER_VERSION, modes: {} };
  let cacheChanged = relevanceCache.version !== CLASSIFIER_VERSION;
  for (const mode of targets) {
    const stored: ModeCacheSnapshot | undefined = relevanceCache.modes[mode.id];
    const before = cacheMisses();
    buildModeLibrary(mode, videos, channels, preferenceProfiles.modes[mode.id]?.channels);
    const snapshot = exportModeCache(mode, videoIds);
    if (cacheMisses() > before || stored?.fingerprint !== snapshot.fingerprint || Object.keys(stored?.entries ?? {}).length !== Object.keys(snapshot.entries).length) cacheChanged = true;
    nextCache.modes[mode.id] = snapshot;
  }
  if (Object.keys(relevanceCache.modes).some((id) => !nextCache.modes[id])) cacheChanged = true;
  if (!(await stillOwner())) return { written: viewsChanged };
  if (cacheChanged) await setItem('relevanceCache', nextCache);

  return { written: viewsChanged || cacheChanged };
}

/** Compute one space's view immediately (e.g. a space that was just created). */
export async function viewFor(modeId: string): Promise<FeedView | null> {
  const stillOwner = await ownerGuard();
  const { modes, videos, channels, feedViews, preferenceProfiles } = await getItems(['modes', 'videos', 'channels', 'feedViews', 'preferenceProfiles']);
  const mode = findMode(modes, modeId);
  if (!mode) return null;
  const view = buildFeedView(mode, videos, channels, preferenceProfiles.modes[mode.id]?.channels);
  if (!(await stillOwner())) return null;
  await setItem('feedViews', { version: CLASSIFIER_VERSION, channelIds: Object.keys(channels), modes: { ...feedViews.modes, [modeId]: view } });
  return view;
}
