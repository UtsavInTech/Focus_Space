/**
 * Pure helpers for YouTube URLs. No DOM, no chrome APIs — safe everywhere.
 */

export type PageType =
  | 'home'
  | 'watch'
  | 'search'
  | 'shorts'
  | 'channel'
  | 'subscriptions'
  | 'explore'
  | 'playlist'
  | 'library'
  | 'other';

export interface PageContext {
  type: PageType;
  url: string;
  path: string;
  videoId: string | null;
  query: string | null;
  channelKey: string | null;
}

const EXPLORE_PREFIXES = ['/feed/trending', '/feed/explore', '/gaming', '/feed/storefront', '/feed/news_destination', '/feed/sports_destination', '/feed/fashion_destination', '/podcasts', '/feed/courses_destination'];

export function detectPage(href: string): PageContext {
  const url = new URL(href, 'https://www.youtube.com');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const ctx: PageContext = { type: 'other', url: url.href, path, videoId: null, query: null, channelKey: null };

  if (path === '/') ctx.type = 'home';
  else if (path === '/watch') {
    ctx.type = 'watch';
    ctx.videoId = url.searchParams.get('v');
  } else if (path.startsWith('/shorts/')) {
    ctx.type = 'shorts';
    ctx.videoId = path.split('/')[2] || null;
  } else if (path === '/results') {
    ctx.type = 'search';
    ctx.query = url.searchParams.get('search_query');
  } else if (path === '/feed/subscriptions') ctx.type = 'subscriptions';
  else if (EXPLORE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) ctx.type = 'explore';
  else if (path === '/playlist') ctx.type = 'playlist';
  else if (path.startsWith('/feed/')) ctx.type = 'library';
  else if (/^\/(@[^/]+|channel\/UC[\w-]+|c\/[^/]+|user\/[^/]+)/.test(path)) {
    ctx.type = 'channel';
    ctx.channelKey = path.split('/').slice(0, path.startsWith('/@') ? 2 : 3).join('/');
  }
  return ctx;
}

export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
export const searchUrl = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
export const channelUrl = (channelId: string, handle?: string) =>
  handle ? `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}` : `https://www.youtube.com/channel/${channelId}`;
export const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
export const isChannelId = (value: string) => CHANNEL_ID_RE.test(value);

export type ChannelInput = { kind: 'id'; id: string } | { kind: 'handle'; handle: string } | { kind: 'path'; path: string };

/** Understands "UC…", "@handle", "youtube.com/@handle", "/channel/UC…", "/c/name", "/user/name". */
export function parseChannelInput(raw: string): ChannelInput | null {
  const input = raw.trim();
  if (!input) return null;
  if (isChannelId(input)) return { kind: 'id', id: input };
  if (/^@[\w.-]{2,}$/.test(input)) return { kind: 'handle', handle: input };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(input) ? input : `https://${input.replace(/^\/+/, '')}`);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.startsWith('@')) return { kind: 'handle', handle: decodeURIComponent(parts[0]) };
  if (parts[0] === 'channel' && parts[1] && isChannelId(parts[1])) return { kind: 'id', id: parts[1] };
  if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return { kind: 'path', path: `/${parts[0]}/${parts[1]}` };
  return null;
}
