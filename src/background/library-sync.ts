import type { Channel, VideoRecord } from '@/types/domain';
import type { ResponseOf } from '@/types/messages';
import { getItem, updateItem } from '@/storage/storage';
import { fetchChannelFeed, looksLikeShort } from '@/integrations/youtube/rss';
import { parseChannelInput } from '@/integrations/youtube/urls';
import { resolveChannelPath } from '@/integrations/youtube/channel-resolve';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { backgroundYouTube } from './youtube';

/**
 * Keeps the local video library in sync with the user's channels.
 *
 * Source order: the channel's public long-form uploads list (the same data
 * youtube.com shows on the channel page, ~30 newest kept), then the public RSS
 * feed as a fallback. Only the service worker writes `videos`.
 */

const MAX_VIDEOS = 5000;
const PER_CHANNEL = 30;
const STALE_MS = 30 * 60_000;
const CONCURRENCY = 4;
const FLUSH_EVERY = 10;

let running: Promise<{ ok: boolean; error?: string }> | null = null;

export const isSyncRunning = () => running !== null;

export function syncLibrary(force = false) {
  running ??= runSync(force).finally(() => {
    running = null;
  });
  return running;
}

function toRecord(v: YtVideo, channel: { id: string; title: string }, position: number, now: number): VideoRecord {
  return {
    id: v.id,
    channelId: channel.id,
    channelTitle: v.channelTitle || channel.title,
    title: v.title,
    description: v.description,
    // Uploads list only has "3 weeks ago"; keep order stable when that's missing.
    publishedAt: v.publishedAt ?? now - (position + 1) * 86_400_000,
    thumbnail: v.thumbnail,
    views: v.views,
    durationSec: v.durationSec,
  };
}

type FetchResult = { ok: true; videos: VideoRecord[]; title: string } | { ok: false; error: string; status: number };

export async function fetchChannelVideos(channel: { id: string; title: string }): Promise<FetchResult> {
  const now = Date.now();
  try {
    const page = await backgroundYouTube.channelUploads(channel.id);
    const videos = page.videos.filter((v) => !v.isShort && !v.isLive).slice(0, PER_CHANNEL);
    if (videos.length) return { ok: true, title: videos[0].channelTitle || channel.title, videos: videos.map((v, i) => toRecord(v, channel, i, now)) };
  } catch {
    /* fall through to RSS */
  }
  const feed = await fetchChannelFeed(channel.id);
  if (feed.ok) return { ok: true, title: feed.feed.channelTitle, videos: feed.feed.videos };
  return { ok: false, status: feed.status, error: feed.error };
}

function mergeVideos(current: Record<string, VideoRecord>, incoming: VideoRecord[]) {
  const next = { ...current };
  for (const video of incoming) {
    if (looksLikeShort(video)) continue;
    const existing = next[video.id];
    // Exact dates (from RSS) beat relative ones ("3 weeks ago").
    next[video.id] = existing ? { ...existing, ...video, publishedAt: Math.min(existing.publishedAt, video.publishedAt), description: video.description || existing.description } : video;
  }
  return next;
}

async function runSync(force: boolean): Promise<{ ok: boolean; error?: string }> {
  const channels = await getItem('channels');
  const now = Date.now();
  const due = Object.values(channels)
    .filter((c) => !c.ignored && (force || !c.lastFetchedAt || now - c.lastFetchedAt > STALE_MS))
    .sort((a, b) => (a.lastFetchedAt ?? 0) - (b.lastFetchedAt ?? 0));

  await updateItem('sync', (s) => ({ ...s, status: 'syncing', progress: { done: 0, total: due.length }, lastError: null }));

  let done = 0;
  let failures = 0;
  let pending: { channelId: string; videos: VideoRecord[]; error: string | null; title: string }[] = [];

  const flush = async () => {
    const batch = pending;
    pending = [];
    if (batch.length) {
      await updateItem('videos', (videos) => mergeVideos(videos, batch.flatMap((b) => b.videos)));
      await updateItem('channels', (current) => {
        const next = { ...current };
        for (const b of batch) {
          const ch = next[b.channelId];
          if (!ch) continue; // removed while syncing
          next[b.channelId] = { ...ch, lastFetchedAt: Date.now(), lastError: b.error, title: ch.title || b.title };
        }
        return next;
      });
    }
    await updateItem('sync', (s) => ({ ...s, progress: { done, total: due.length } }));
  };

  const queue = [...due];
  const worker = async () => {
    for (let channel = queue.shift(); channel; channel = queue.shift()) {
      const result = await fetchChannelVideos(channel);
      done++;
      if (result.ok) pending.push({ channelId: channel.id, videos: result.videos, error: null, title: result.title });
      else {
        failures++;
        pending.push({ channelId: channel.id, videos: [], error: result.error, title: '' });
      }
      if (pending.length >= FLUSH_EVERY) await flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, due.length)) }, worker));
  await flush();
  await pruneLibrary();

  const allFailed = due.length > 0 && failures === due.length;
  const error = allFailed ? "Your subscription library couldn't refresh. Using your saved videos." : undefined;
  await updateItem('sync', (s) => ({ ...s, status: 'idle', progress: null, lastSyncAt: allFailed ? s.lastSyncAt : Date.now(), lastError: error ?? null }));
  return { ok: !allFailed, error };
}

/** Drop videos of removed channels and cap the library size (newest kept). */
export async function pruneLibrary() {
  const channels = await getItem('channels');
  await updateItem('videos', (videos) => {
    const kept = Object.values(videos)
      .filter((v) => channels[v.channelId])
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, MAX_VIDEOS);
    return Object.fromEntries(kept.map((v) => [v.id, v]));
  });
}

export async function addChannel(input: string): Promise<ResponseOf<'channel/add'>> {
  const parsed = parseChannelInput(input);
  if (!parsed) return { ok: false, error: 'Paste a YouTube channel link, @handle, or channel ID (UC…).' };

  let id: string;
  let title: string | undefined;
  let thumbnail: string | undefined;
  let handle: string | undefined;
  if (parsed.kind === 'id') id = parsed.id;
  else {
    handle = parsed.kind === 'handle' ? parsed.handle : undefined;
    try {
      const resolved = await resolveChannelPath(parsed.kind === 'handle' ? `/${parsed.handle}` : parsed.path);
      if (!resolved) return { ok: false, error: 'Could not find that channel on YouTube.' };
      ({ id, title, thumbnail } = resolved);
    } catch {
      return { ok: false, error: 'Could not reach YouTube. Check your connection and try again.' };
    }
  }

  const result = await fetchChannelVideos({ id, title: title ?? handle ?? id });
  if (!result.ok) return { ok: false, error: result.status === 404 ? 'That channel has no public uploads.' : result.error };

  const now = Date.now();
  let saved!: Channel;
  await updateItem('channels', (channels) => {
    const existing = channels[id];
    saved = {
      id,
      title: existing?.title || title || result.title || handle || id,
      handle: existing?.handle ?? handle,
      thumbnail: existing?.thumbnail ?? thumbnail,
      source: existing?.source ?? 'manual',
      addedAt: existing?.addedAt ?? now,
      lastFetchedAt: now,
      lastError: null,
      ignored: false,
    };
    return { ...channels, [id]: saved };
  });
  await updateItem('videos', (videos) => mergeVideos(videos, result.videos));
  await updateItem('sync', (st) => ({ ...st, lastError: null, lastSyncAt: st.lastSyncAt ?? now }));
  return { ok: true, channel: saved };
}
