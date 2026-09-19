import { getItems, setItem, subscribe } from '@/storage/storage';
import type { PreferenceStore } from '@/storage/schema';
import { PREFERENCE_VERSION } from '@/types/preferences';
import { signalsFromSavedVideos, signalsFromWatchHistory } from '@/learning/preferences/signals';
import { buildPreferenceProfile } from '@/learning/preferences/scorer';
import { hashString } from '@/learning/relevance/matcher';
import { ownerGuard } from '@/storage/ownership';

/**
 * Computes each space's PreferenceProfile from watchHistory + topicPlaylists
 * — no new tracking, just turning what FocusSpace already persists into
 * behavioral creator/topic affinity. See docs/V5_CONTRACT.md §D.
 *
 * Mirrors the debounce/rerun pattern of relevance-warmer.ts: cheap (watch
 * history is capped at 300 entries), so this is a plain recompute, not an
 * incremental cache like the classifier's.
 */

const DEBOUNCE_MS = 3000;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let rerun = false;

export function startPreferenceWarmer(): void {
  subscribe(['watchHistory', 'topicPlaylists', 'modes'], () => schedule(DEBOUNCE_MS));
  schedule(1500);
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
  running = warmPreferences()
    .then(() => undefined)
    .catch((err) => console.warn('[FocusSpace] preference warm-up failed', err))
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        schedule(DEBOUNCE_MS);
      }
    });
}

export async function warmPreferences(): Promise<{ written: boolean }> {
  const stillOwner = await ownerGuard(); // computed from one person's history, never written into another's
  const { watchHistory, topicPlaylists, modes, preferenceProfiles } = await getItems(['watchHistory', 'topicPlaylists', 'modes', 'preferenceProfiles']);
  const signals = [...signalsFromWatchHistory(watchHistory), ...signalsFromSavedVideos(topicPlaylists)];
  const next: PreferenceStore = { version: PREFERENCE_VERSION, modes: {} };
  for (const mode of modes) next.modes[mode.id] = buildPreferenceProfile(mode.id, signals);
  const changed = preferenceProfiles.version !== PREFERENCE_VERSION || hashString(JSON.stringify(next)) !== hashString(JSON.stringify(preferenceProfiles));
  if (!(await stillOwner())) return { written: false };
  if (changed) await setItem('preferenceProfiles', next);
  return { written: changed };
}
