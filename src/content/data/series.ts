import type { WatchEntry } from '@/types/domain';
import type { YtPlaylist, YtVideo } from '@/integrations/youtube/innertube-parse';
import { isCoursePlaylistId } from '@/integrations/youtube/knowledge-parse';
import { buildSeriesState, numberedSeries, seriesNumber, seriesSearchQuery, type SeriesSource, type SeriesState } from '@/learning/next';
import { buildLearningPath, type LearningPath, type PathSource } from '@/learning/path/path';
import { loadPlaylist, loadUploads, pageYouTube } from './youtube';
import { cached } from './cache';

/**
 * Finds the sequence a video belongs to, most authoritative first:
 *   1. the playlist being watched (list= in the URL)
 *   2. a playlist the creator links in the description that contains this video
 *   3. numbered titles from the channel's uploads (a guess, labelled as one)
 */

export interface SeriesAnchor {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string;
  playlistId: string | null;
}

interface PoolVideo {
  id: string;
  title: string;
  channelId: string | null;
  thumbnail?: string;
  durationSec?: number | null;
}

export interface SeriesOptions {
  playlist?: YtPlaylist | null;
  /** Playlists linked from the video's description (watch page only). */
  descriptionPlaylists?: string[];
  pool: PoolVideo[];
  history: WatchEntry[];
  ytWatched?: YtVideo[];
  currentVideoId: string | null;
}

export function watchedMap(history: WatchEntry[], youtube: YtVideo[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of history) if (e.progress > 0) map.set(e.videoId, Math.max(map.get(e.videoId) ?? 0, e.progress));
  for (const v of youtube) if (v.watchedPercent !== null) map.set(v.id, Math.max(map.get(v.id) ?? 0, v.watchedPercent / 100));
  return map;
}

export function playlistSeries(playlist: YtPlaylist): SeriesSource {
  return {
    id: playlist.id,
    title: playlist.title || 'This playlist',
    kind: 'playlist',
    items: playlist.videos.map((v, i) => ({ videoId: v.id, title: v.title, index: v.index ?? i + 1, channelTitle: v.channelTitle, thumbnail: v.thumbnail, durationSec: v.durationSec })),
  };
}

interface Resolved {
  source: SeriesSource;
  pathSource: PathSource;
  watched: Map<string, number>;
  progressFromYouTube: boolean;
}

/** The creator's own list: contains this video and is (mostly) made of the creator's uploads. */
function isCreatorsPlaylist(playlist: YtPlaylist, videoId: string | null, channelId: string | null): boolean {
  if (playlist.videos.length < 2 || !playlist.videos.some((v) => v.id === videoId)) return false;
  const known = playlist.videos.filter((v) => v.channelId);
  return !channelId || !known.length || known.filter((v) => v.channelId === channelId).length >= known.length * 0.6;
}

async function resolveSeries(anchor: SeriesAnchor, options: SeriesOptions): Promise<Resolved | null> {
  const fromPlaylist = (playlist: YtPlaylist, pathSource: PathSource): Resolved => ({
    source: playlistSeries(playlist),
    pathSource,
    watched: watchedMap(options.history, [...playlist.videos, ...(options.ytWatched ?? [])]),
    progressFromYouTube: playlist.videos.some((v) => v.watchedPercent !== null),
  });

  const playlistId = options.playlist?.id || anchor.playlistId;
  if (playlistId && isCoursePlaylistId(playlistId)) {
    const playlist = options.playlist?.videos.length ? options.playlist : await loadPlaylist(playlistId).catch(() => null);
    if (playlist && playlist.videos.length >= 2) return fromPlaylist(playlist, 'playlist');
  }

  for (const id of (options.descriptionPlaylists ?? []).filter((id) => id !== playlistId && isCoursePlaylistId(id)).slice(0, 2)) {
    const playlist = await loadPlaylist(id).catch(() => null);
    if (playlist && isCreatorsPlaylist(playlist, options.currentVideoId, anchor.channelId)) return fromPlaylist(playlist, 'creator-playlist');
  }

  if (!anchor.channelId || !seriesNumber(anchor.title)) return null;
  const uploads = await loadUploads(anchor.channelId).catch(() => [] as YtVideo[]);
  const pool: PoolVideo[] = [...options.pool, ...uploads.map((v) => ({ id: v.id, title: v.title, channelId: anchor.channelId, thumbnail: v.thumbnail, durationSec: v.durationSec }))];
  let source = numberedSeries(anchor, pool);
  // Lecture 101 of a long course: the channel's latest uploads rarely reach back to 102. Ask YouTube
  // for the next episodes by name, and keep only the ones from this channel in this numbering.
  const own = seriesNumber(anchor.title);
  if (own && !source?.items.some((i) => i.index > own.n)) {
    const found = await nextEpisodes(anchor, own.n);
    if (found.length) source = numberedSeries(anchor, [...pool, ...found]);
  }
  if (!source) return null;
  return { source, pathSource: 'series', watched: watchedMap(options.history, [...uploads, ...(options.ytWatched ?? [])]), progressFromYouTube: false };
}

/** Episodes n+1 and n+2 by search — from the anchor's own channel only; cached like everything else. */
async function nextEpisodes(anchor: SeriesAnchor, n: number): Promise<PoolVideo[]> {
  const queries = [n + 1, n + 2].map((k) => seriesSearchQuery(anchor.title, anchor.channelTitle, k)).filter((q): q is string => !!q);
  const pages = await Promise.all(queries.map((q) => cached(`series-search:${q.toLowerCase()}`, 6 * 3600_000, () => pageYouTube.searchVideos(q)).catch(() => null)));
  return pages
    .flatMap((page) => page?.videos ?? [])
    .filter((v) => v.channelId === anchor.channelId && !v.isShort)
    .map((v) => ({ id: v.id, title: v.title, channelId: anchor.channelId, thumbnail: v.thumbnail, durationSec: v.durationSec }));
}

/** Series state for "Continue watching" on the home. */
export async function seriesFor(anchor: SeriesAnchor, options: SeriesOptions): Promise<SeriesState | null> {
  const resolved = await resolveSeries(anchor, options);
  return resolved ? buildSeriesState(resolved.source, options.currentVideoId, resolved.watched, resolved.progressFromYouTube) : null;
}

/** "You are here → Next → Then" for the watch page. */
export async function learningPathFor(anchor: SeriesAnchor, options: SeriesOptions): Promise<LearningPath | null> {
  const resolved = await resolveSeries(anchor, options);
  return resolved ? buildLearningPath(resolved.source, resolved.pathSource, options.currentVideoId, resolved.watched, { progressFromYouTube: resolved.progressFromYouTube }) : null;
}
