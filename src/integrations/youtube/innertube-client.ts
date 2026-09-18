import type { ChapterInput } from '@/learning/knowledge/types';
import { parseChannels, parseContinuation, parseVideos, parseWatchNext, textOf, type WatchNext, type YtChannel, type YtPlaylist, type YtVideo } from './innertube-parse';
import { parseChapters, parseCommentsPage, parseCommentsToken, parseDescriptionPlaylists, type CommentsPage } from './knowledge-parse';

/** Watch-page data plus the evidence the knowledge map and learning path need. */
export interface WatchPage extends WatchNext {
  chapters: ChapterInput[];
  descriptionPlaylists: string[];
  commentsToken: string | null;
}

/**
 * Client for the web API youtube.com itself uses (InnerTube). Two transports:
 *
 * - page (content script): the page's own client config and the user's
 *   signed-in session → personalised data such as watch progress and history.
 * - background (service worker): anonymous, public data only (channel
 *   uploads, search) — used when no YouTube page is involved.
 *
 * This module is the single seam to swap for the official Data API later.
 */

export interface InnerTubeConfig {
  clientName: string;
  clientNameId?: string;
  clientVersion: string;
  apiKey?: string;
  context?: Record<string, unknown>;
  sessionIndex?: string;
  delegatedSessionId?: string;
  loggedIn: boolean;
  hl?: string;
}

export interface InnerTubeTransport {
  getConfig(): Promise<InnerTubeConfig>;
  getHeaders?(config: InnerTubeConfig): Promise<Record<string, string>>;
  credentials: RequestCredentials;
}

export class InnerTubeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface VideoPage {
  videos: YtVideo[];
  continuation: string | null;
}

const CHANNEL_FILTER = 'EgIQAg%3D%3D';

export function createInnerTubeClient(transport: InnerTubeTransport) {
  async function post(endpoint: 'search' | 'browse' | 'next', body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const config = await transport.getConfig();
    const context = config.context ?? { client: { clientName: config.clientName, clientVersion: config.clientVersion, hl: config.hl ?? 'en' } };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': config.clientNameId ?? '1',
      'X-Youtube-Client-Version': config.clientVersion,
      ...((await transport.getHeaders?.(config)) ?? {}),
    };
    const key = config.apiKey ? `&key=${encodeURIComponent(config.apiKey)}` : '';
    const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false${key}`, {
      method: 'POST',
      headers,
      credentials: transport.credentials,
      body: JSON.stringify({ context, ...body }),
      signal,
    });
    if (!res.ok) throw new InnerTubeError(`YouTube returned HTTP ${res.status}`, res.status);
    return res.json();
  }

  const page = (json: unknown): VideoPage => ({ videos: parseVideos(json), continuation: parseContinuation(json) });

  return {
    async searchVideos(query: string, options: { continuation?: string | null; signal?: AbortSignal } = {}): Promise<VideoPage> {
      return page(await post('search', options.continuation ? { continuation: options.continuation } : { query }, options.signal));
    },

    async searchChannels(query: string, signal?: AbortSignal): Promise<YtChannel[]> {
      return parseChannels(await post('search', { query, params: CHANNEL_FILTER }, signal));
    },

    async watchNext(videoId: string, playlistId?: string | null, signal?: AbortSignal): Promise<WatchPage> {
      const json = await post('next', { videoId, ...(playlistId ? { playlistId } : {}) }, signal);
      return { ...parseWatchNext(json, videoId), chapters: parseChapters(json), descriptionPlaylists: parseDescriptionPlaylists(json), commentsToken: parseCommentsToken(json) };
    },

    /** One page of top comments (the first token comes from watchNext). */
    async comments(token: string, signal?: AbortSignal): Promise<CommentsPage> {
      return parseCommentsPage(await post('next', { continuation: token }, signal));
    },

    /** Long-form uploads (no Shorts/lives), newest first. Falls back to all uploads. */
    async channelUploads(channelId: string, signal?: AbortSignal): Promise<VideoPage> {
      const suffix = channelId.slice(2);
      const longForm = page(await post('browse', { browseId: `VLUULF${suffix}` }, signal).catch(() => null));
      if (longForm.videos.length) return longForm;
      return page(await post('browse', { browseId: `VLUU${suffix}` }, signal));
    },

    async playlist(playlistId: string, signal?: AbortSignal): Promise<YtPlaylist> {
      const json = await post('browse', { browseId: `VL${playlistId}` }, signal);
      const title = JSON.stringify(json).match(/"pageTitle":"([^"]+)"/)?.[1] ?? textOf((json as { header?: { playlistHeaderRenderer?: { title?: unknown } } }).header?.playlistHeaderRenderer?.title);
      const videos = parseVideos(json).map((v, i) => ({ ...v, index: v.index ?? i + 1, playlistId }));
      return { id: playlistId, title, total: videos.length, currentIndex: null, videos };
    },

    /** The signed-in user's own YouTube watch history (page transport only). */
    async history(signal?: AbortSignal): Promise<YtVideo[]> {
      return parseVideos(await post('browse', { browseId: 'FEhistory' }, signal));
    },

    /** YouTube's recommendations for this user — FocusSpace filters them before showing anything. */
    async recommendations(signal?: AbortSignal): Promise<YtVideo[]> {
      return parseVideos(await post('browse', { browseId: 'FEwhat_to_watch' }, signal));
    },
  };
}

export type InnerTubeClient = ReturnType<typeof createInnerTubeClient>;
