import type { VideoRecord } from '@/types/domain';

/**
 * YouTube's public Atom feeds — an official, unauthenticated, stable endpoint.
 *
 *   /feeds/videos.xml?playlist_id=UULF<id>  → long-form uploads only (no Shorts / lives)
 *   /feeds/videos.xml?channel_id=UC<id>     → all uploads (fallback)
 *
 * Limitation: each feed returns only the ~15 most recent uploads. FocusSpace
 * merges every sync into a local library, so coverage grows over time.
 * Parsed with regexes because service workers have no DOMParser.
 */

const FEED_BASE = 'https://www.youtube.com/feeds/videos.xml';

export function longFormFeedUrl(channelId: string) {
  return `${FEED_BASE}?playlist_id=UULF${channelId.slice(2)}`;
}

export function channelFeedUrl(channelId: string) {
  return `${FEED_BASE}?channel_id=${channelId}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    });
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1].trim()) : '';
};
const attr = (xml: string, name: string, attribute: string) => {
  const m = xml.match(new RegExp(`<${name}\\s[^>]*${attribute}="([^"]*)"`));
  return m ? decodeXml(m[1]) : '';
};

export interface ParsedFeed {
  channelId: string | null;
  channelTitle: string;
  videos: VideoRecord[];
}

export function parseFeed(xml: string, fallbackChannelId?: string): ParsedFeed {
  const head = xml.split('<entry>')[0] ?? '';
  const feedChannelId = tag(head, 'yt:channelId') || fallbackChannelId || null;
  // Playlist feeds title themselves "Videos"; the channel name lives in <author>.
  const channelTitle = tag(tag(head, 'author'), 'name') || tag(head, 'title');
  const videos: VideoRecord[] = [];

  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1];
    const id = tag(entry, 'yt:videoId');
    if (!id) continue;
    const channelId = tag(entry, 'yt:channelId') || feedChannelId || '';
    const published = Date.parse(tag(entry, 'published'));
    const views = attr(entry, 'media:statistics', 'views');
    videos.push({
      id,
      channelId,
      channelTitle: tag(tag(entry, 'author'), 'name') || channelTitle,
      title: tag(entry, 'media:title') || tag(entry, 'title'),
      description: tag(entry, 'media:description').slice(0, 700),
      publishedAt: Number.isFinite(published) ? published : Date.now(),
      thumbnail: attr(entry, 'media:thumbnail', 'url') || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      views: views ? Number(views) : null,
    });
  }
  return { channelId: feedChannelId, channelTitle, videos };
}

export type FeedResult = { ok: true; feed: ParsedFeed } | { ok: false; status: number; error: string };

export async function fetchChannelFeed(channelId: string, signal?: AbortSignal): Promise<FeedResult> {
  try {
    let res = await fetch(longFormFeedUrl(channelId), { signal, credentials: 'omit' });
    // Channels without a long-form uploads playlist (e.g. Shorts-only) 404 here.
    if (res.status === 404) res = await fetch(channelFeedUrl(channelId), { signal, credentials: 'omit' });
    if (!res.ok) return { ok: false, status: res.status, error: `Feed returned HTTP ${res.status}` };
    const xml = await res.text();
    return { ok: true, feed: parseFeed(xml, channelId) };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Heuristic: Shorts that slip into the all-uploads fallback feed. */
export const looksLikeShort = (video: Pick<VideoRecord, 'title' | 'description'>) => /#shorts?\b/i.test(`${video.title} ${video.description}`);
