import type { TopicPlaylists, WatchEntry } from '@/types/domain';
import type { PreferenceSignal } from '@/types/preferences';
import { COMPLETE_AT } from '../next';
import { normalizeText } from '../text';

/**
 * Turns data FocusSpace already persists (`watchHistory`, `topicPlaylists`)
 * into `PreferenceSignal` rows. No new tracking, no new UI: every signal here
 * comes from something the learner already did that FocusSpace already
 * records.
 *
 * `WatchEntry` is one upserted row per video (progress is the highest ever
 * reached, `watchedAt` is the most recent visit — see `src/content/controller.ts`)
 * — there is no per-session history, so a per-video "rewatch" signal isn't
 * derivable from it yet. Repeated engagement with a creator is still fully
 * captured at the channel level: many distinct completed videos from the same
 * channel *is* the "repeatedly watches this creator" signal the product
 * principle asks for.
 */

/** Below this, opening a video isn't a signal (same floor as `resumeItems` in `learning/next.ts`). */
const STARTED_AT = 0.05;

/** `WatchEntry.channelId` can be null (some metadata fallbacks don't carry it). Fall back to a normalised title so the signal isn't dropped. */
export function channelKeyOf(channelId: string | null | undefined, channelTitle: string | null | undefined): string | null {
  if (channelId) return channelId;
  const title = channelTitle ? normalizeText(channelTitle) : '';
  return title ? `title:${title}` : null;
}

/** Watch progress + completion signals from local watch history. */
export function signalsFromWatchHistory(entries: readonly WatchEntry[]): PreferenceSignal[] {
  const out: PreferenceSignal[] = [];
  for (const e of entries) {
    if (e.progress < STARTED_AT) continue;
    const channelId = channelKeyOf(e.channelId, e.channelTitle);
    if (!channelId) continue;
    out.push({
      kind: e.progress >= COMPLETE_AT ? 'completed' : 'watch-progress',
      channelId,
      videoId: e.videoId,
      modeId: e.modeId,
      topicId: e.topicId,
      at: e.watchedAt,
      progress: e.progress,
    });
  }
  return out;
}

/** Explicit-save signals from a space's topic playlists. `SavedVideo` carries no channelId, so it uses the same title fallback as watch history. */
export function signalsFromSavedVideos(playlists: TopicPlaylists): PreferenceSignal[] {
  const out: PreferenceSignal[] = [];
  for (const [modeId, topics] of Object.entries(playlists)) {
    for (const [topicId, videos] of Object.entries(topics)) {
      for (const v of videos) {
        const channelId = channelKeyOf(null, v.channelTitle);
        if (!channelId) continue;
        out.push({ kind: 'explicit-save', channelId, videoId: v.videoId, modeId, topicId, at: v.addedAt });
      }
    }
  }
  return out;
}
