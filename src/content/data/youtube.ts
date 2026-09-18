import { createInnerTubeClient, type VideoPage } from '@/integrations/youtube/innertube-client';
import { authorizationHeader } from '@/integrations/youtube/innertube';
import type { YtPlaylist, YtVideo } from '@/integrations/youtube/innertube-parse';
import { getItem, updateItem } from '@/storage/storage';
import type { YouTubeData } from '@/ui/data';
import { getPageConfig } from '../youtube/spa';
import { cached } from './cache';

/**
 * YouTube data for FocusSpace on youtube.com, using the page's own client
 * config and the user's signed-in session (same-origin, nothing leaves the
 * browser). Every call is cached and de-duplicated.
 */

const ORIGIN = 'https://www.youtube.com';

export const pageYouTube = createInnerTubeClient({
  credentials: 'include',
  async getConfig() {
    const config = await getPageConfig();
    if (!config) throw new Error('YouTube page configuration is unavailable.');
    return config;
  },
  async getHeaders(config) {
    const headers: Record<string, string> = { 'X-Origin': ORIGIN, 'X-Goog-AuthUser': config.sessionIndex ?? '0' };
    if (config.loggedIn) {
      const auth = await authorizationHeader(ORIGIN);
      if (auth) headers.Authorization = auth;
    }
    if (config.delegatedSessionId) headers['X-Goog-PageId'] = config.delegatedSessionId;
    return headers;
  },
});

export const pageYouTubeData: YouTubeData = {
  searchChannels: (query, signal) => cached(`channels:${query.toLowerCase()}`, 10 * 60_000, () => pageYouTube.searchChannels(query, signal)),
};

const MINUTE = 60_000;

const signedIn = async () => (await getPageConfig())?.loggedIn === true;

export async function loadHistory(): Promise<YtVideo[]> {
  return (await signedIn()) ? cached('history', 10 * MINUTE, () => pageYouTube.history()) : [];
}

export async function loadRecommendations(): Promise<YtVideo[]> {
  return (await signedIn()) ? cached('recommendations', 30 * MINUTE, () => pageYouTube.recommendations()) : [];
}

export const loadPlaylist = (playlistId: string): Promise<YtPlaylist> => cached(`playlist:${playlistId}`, 30 * MINUTE, () => pageYouTube.playlist(playlistId));

export const loadUploads = (channelId: string): Promise<YtVideo[]> =>
  cached(`uploads:${channelId}`, 60 * MINUTE, async () => (await pageYouTube.channelUploads(channelId)).videos.map((v) => ({ ...v, channelId: v.channelId ?? channelId })));

const DISCOVERY_TTL = 12 * 60 * MINUTE;
const MAX_CACHED_QUERIES = 40;

/** First page of a discovery search is persisted (12 h) so YouTube isn't asked again on every visit. */
export async function fetchDiscoveryPage(query: string, continuation: string | null): Promise<VideoPage> {
  if (continuation) return cached(`search:${query}:${continuation}`, DISCOVERY_TTL, () => pageYouTube.searchVideos(query, { continuation }));
  const stored = await cached('storage:discoveryCache', MINUTE, () => getItem('discoveryCache'));
  const hit = stored[query];
  if (hit && Date.now() - hit.fetchedAt < DISCOVERY_TTL) return { videos: hit.videos, continuation: hit.continuation };

  const page = await cached(`search:${query}`, DISCOVERY_TTL, () => pageYouTube.searchVideos(query));
  const entry = { fetchedAt: Date.now(), videos: page.videos.slice(0, 20).map((v) => ({ ...v, description: v.description.slice(0, 200) })), continuation: page.continuation };
  stored[query] = entry;
  void updateItem('discoveryCache', (all) => {
    const next = { ...all, [query]: entry };
    const keys = Object.keys(next).sort((a, b) => next[a].fetchedAt - next[b].fetchedAt);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CACHED_QUERIES))) delete next[old];
    return next;
  }).catch(() => undefined);
  return page;
}
