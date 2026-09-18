import { isChannelId } from './urls';

/**
 * Parsers for YouTube's web API responses (the JSON youtube.com renders from).
 * They walk responses generically and understand both the classic renderers
 * (videoRenderer, playlistPanelVideoRenderer…) and the 2025+ view models
 * (lockupViewModel), so layout reshuffles rarely break them. Pure functions;
 * tested against real captured responses in __fixtures__/innertube.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const get = (root: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string | number, unknown>)[key] : undefined), root);

export const textOf = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (!isObj(v)) return '';
  if (typeof v.simpleText === 'string') return v.simpleText;
  if (typeof v.content === 'string') return v.content;
  if (Array.isArray(v.runs)) return v.runs.map((r) => (isObj(r) && typeof r.text === 'string' ? r.text : '')).join('');
  return '';
};

export interface YtVideo {
  id: string;
  title: string;
  channelId: string | null;
  channelTitle: string;
  channelHandle: string | null;
  description: string;
  thumbnail: string;
  durationSec: number | null;
  views: number | null;
  publishedText: string;
  publishedAt: number | null;
  /** 0–100, only when YouTube reports real watch progress for the signed-in user. */
  watchedPercent: number | null;
  isShort: boolean;
  isLive: boolean;
  /** 1-based position in a playlist, when known. */
  index: number | null;
  playlistId: string | null;
}

export interface YtChannel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  subscribersText: string;
  subscribed: boolean;
}

export interface YtPlaylist {
  id: string;
  title: string;
  total: number | null;
  currentIndex: number | null;
  videos: YtVideo[];
}

export interface WatchNext {
  videoId: string;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string;
  channelHandle: string | null;
  playlist: YtPlaylist | null;
  related: YtVideo[];
}

/* ─── Small value parsers ───────────────────────────────────────────────────── */

export function parseCount(text: string): number | null {
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KMB])?\b/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(:\d{2}){1,2}$/.test(t)) return null;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

const UNIT_MS: [RegExp, number][] = [
  [/^(?:years?|yrs?|y)$/, 365 * 86_400_000],
  [/^(?:months?|mo)$/, 30 * 86_400_000],
  [/^(?:weeks?|wks?|w)$/, 7 * 86_400_000],
  [/^(?:days?|d)$/, 86_400_000],
  [/^(?:hours?|hrs?|h)$/, 3_600_000],
  [/^(?:minutes?|mins?|m)$/, 60_000],
  [/^(?:seconds?|secs?|s)$/, 1000],
];

/** "3 years ago", "16h ago", "Streamed 5 hours ago" → approximate timestamp. */
export function parseRelativeTime(text: string, now = Date.now()): number | null {
  const m = text.toLowerCase().match(/(\d+)\s*([a-z]+)\s+ago/);
  if (!m) return null;
  const unit = UNIT_MS.find(([re]) => re.test(m[2]));
  return unit ? now - Number(m[1]) * unit[1] : null;
}

const thumbnailFor = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

function channelFromEndpoint(endpoint: unknown): { id: string | null; handle: string | null } {
  const browse = get(endpoint, 'browseEndpoint');
  const id = get(browse, 'browseId');
  const canonical = get(browse, 'canonicalBaseUrl');
  return {
    id: typeof id === 'string' && isChannelId(id) ? id : null,
    handle: typeof canonical === 'string' && canonical.startsWith('/@') ? decodeURIComponent(canonical.slice(1)) : null,
  };
}

/** Real watch progress only — YouTube also uses progress bars to highlight search "key moment" segments. */
function watchProgress(item: Json): number | null {
  let percent: number | null = null;
  let segment = false;
  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const obj = node as Json;
    if (obj.enableSegmentView === true) segment = true;
    const resume = obj.thumbnailOverlayResumePlaybackRenderer;
    if (isObj(resume) && typeof resume.percentDurationWatched === 'number') percent = resume.percentDurationWatched;
    const bar = obj.thumbnailOverlayProgressBarViewModel;
    if (isObj(bar) && typeof bar.startPercent === 'number') {
      if (bar.enableSegmentView === true) segment = true;
      else percent = bar.startPercent;
    }
    for (const [key, value] of Object.entries(obj)) if (key !== 'navigationEndpoint' && value && typeof value === 'object') visit(value, depth + 1);
  };
  visit(item.thumbnailOverlays ?? get(item, 'contentImage'), 0);
  return segment ? null : percent;
}

function classicVideo(r: Json, now: number): YtVideo | null {
  const id = r.videoId;
  if (typeof id !== 'string') return null;
  const bylineRun = get(r.ownerText ?? r.longBylineText ?? r.shortBylineText, 'runs', 0);
  const channel = channelFromEndpoint(get(bylineRun, 'navigationEndpoint'));
  const overlays = Array.isArray(r.thumbnailOverlays) ? r.thumbnailOverlays : [];
  const timeStatus = overlays.map((o) => get(o, 'thumbnailOverlayTimeStatusRenderer')).find(isObj);
  const durationText = textOf(r.lengthText) || textOf(get(timeStatus, 'text'));
  const watch = get(r.navigationEndpoint, 'watchEndpoint');
  const url = String(get(r.navigationEndpoint, 'commandMetadata', 'webCommandMetadata', 'url') ?? '');
  const badges = JSON.stringify(r.badges ?? []);
  const publishedText = textOf(r.publishedTimeText);
  const indexValue = get(watch, 'index');
  return {
    id,
    title: textOf(r.title),
    channelId: channel.id,
    channelTitle: textOf(r.ownerText ?? r.longBylineText ?? r.shortBylineText),
    channelHandle: channel.handle,
    description: textOf(r.descriptionSnippet),
    thumbnail: thumbnailFor(id),
    durationSec: typeof r.lengthSeconds === 'string' ? Number(r.lengthSeconds) : durationText ? parseDuration(durationText) : null,
    views: parseCount(textOf(r.viewCountText) || textOf(r.shortViewCountText)),
    publishedText,
    publishedAt: parseRelativeTime(publishedText, now),
    watchedPercent: watchProgress(r),
    isShort: url.startsWith('/shorts/') || !!get(r.navigationEndpoint, 'reelWatchEndpoint'),
    isLive: get(timeStatus, 'style') === 'LIVE' || /BADGE_STYLE_TYPE_LIVE_NOW/.test(badges),
    index: typeof indexValue === 'number' ? indexValue + 1 : Number(textOf(r.indexText)) || null,
    playlistId: typeof get(watch, 'playlistId') === 'string' ? (get(watch, 'playlistId') as string) : null,
  };
}

function lockupVideo(l: Json, now: number): YtVideo | null {
  if (l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || typeof l.contentId !== 'string') return null;
  const id = l.contentId;
  const meta = get(l, 'metadata', 'lockupMetadataViewModel');
  const channel = channelFromEndpoint(get(meta, 'image', 'decoratedAvatarViewModel', 'rendererContext', 'commandContext', 'onTap', 'innertubeCommand'));
  const rows = (get(meta, 'metadata', 'contentMetadataViewModel', 'metadataRows') as unknown[] | undefined) ?? [];
  let channelTitle = '';
  let views: number | null = null;
  let publishedText = '';
  rows.forEach((row, rowIndex) => {
    const parts = (get(row, 'metadataParts') as unknown[] | undefined) ?? [];
    parts.forEach((part, partIndex) => {
      const text = textOf(get(part, 'text'));
      const label = String(get(part, 'accessibilityLabel') ?? '');
      if (/views?$/i.test(label) || /views?$/i.test(text)) views = parseCount(text);
      else if (/ago$/i.test(label) || /ago$/i.test(text) || /^(streamed|premiered)/i.test(text)) publishedText = label || text;
      else if (rowIndex === 0 && partIndex === 0 && rows.length > 1) channelTitle = text;
    });
  });
  const badges = ((get(l, 'contentImage', 'thumbnailViewModel', 'overlays') as unknown[] | undefined) ?? []).flatMap(
    (o) => ((get(o, 'thumbnailBottomOverlayViewModel', 'badges') as unknown[] | undefined) ?? []).map((b) => String(get(b, 'thumbnailBadgeViewModel', 'text') ?? '')),
  );
  const onTap = get(l, 'rendererContext', 'commandContext', 'onTap', 'innertubeCommand');
  const watch = get(onTap, 'watchEndpoint');
  const url = String(get(onTap, 'commandMetadata', 'webCommandMetadata', 'url') ?? '');
  const duration = badges.map(parseDuration).find((d) => d !== null) ?? null;
  const indexValue = get(watch, 'index');
  return {
    id,
    title: textOf(get(meta, 'title')),
    channelId: channel.id,
    channelTitle,
    channelHandle: channel.handle,
    description: '',
    thumbnail: thumbnailFor(id),
    durationSec: duration,
    views,
    publishedText,
    publishedAt: parseRelativeTime(publishedText, now),
    watchedPercent: watchProgress(l),
    isShort: url.startsWith('/shorts/'),
    isLive: badges.some((b) => /^live$/i.test(b)),
    index: typeof indexValue === 'number' ? indexValue + 1 : null,
    playlistId: typeof get(watch, 'playlistId') === 'string' ? (get(watch, 'playlistId') as string) : null,
  };
}

const CLASSIC = ['videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer', 'playlistVideoRenderer', 'playlistPanelVideoRenderer'];
const SKIP = new Set(['shortsLockupViewModel', 'reelItemRenderer', 'reelShelfRenderer', 'gridShelfViewModel', 'engagementPanels', 'header', 'topbar', 'frameworkUpdates']);

/** Every video in a response, in document order, de-duplicated. Shorts shelves are skipped. */
export function parseVideos(root: unknown, now = Date.now()): YtVideo[] {
  const out = new Map<string, YtVideo>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 60 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const obj = node as Json;
    for (const key of CLASSIC) {
      if (isObj(obj[key])) {
        const video = classicVideo(obj[key] as Json, now);
        if (video?.title && !out.has(video.id)) out.set(video.id, video);
        return;
      }
    }
    if (isObj(obj.lockupViewModel)) {
      const video = lockupVideo(obj.lockupViewModel, now);
      if (video?.title && !out.has(video.id)) out.set(video.id, video);
      return;
    }
    for (const [key, value] of Object.entries(obj)) if (!SKIP.has(key) && value && typeof value === 'object') visit(value, depth + 1);
  };
  visit(root, 0);
  return [...out.values()];
}

/** Continuation token for the next page of items (not search filter chips). */
export function parseContinuation(root: unknown): string | null {
  let token: string | null = null;
  const visit = (node: unknown, depth: number) => {
    if (token || depth > 60 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const obj = node as Json;
    const item = obj.continuationItemRenderer ?? obj.continuationItemViewModel;
    if (isObj(item)) {
      const found = JSON.stringify(item).match(/"continuationCommand":\{[^{}]*?"token":"([^"]+)"/);
      if (found) token = found[1];
      return;
    }
    for (const [key, value] of Object.entries(obj)) if (key !== 'header' && value && typeof value === 'object') visit(value, depth + 1);
  };
  visit(root, 0);
  return token;
}

export function parseChannels(root: unknown): YtChannel[] {
  const out = new Map<string, YtChannel>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 40 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const obj = node as Json;
    const r = obj.channelRenderer;
    if (isObj(r) && typeof r.channelId === 'string' && isChannelId(r.channelId)) {
      const canonical = get(r.navigationEndpoint, 'browseEndpoint', 'canonicalBaseUrl');
      const sub = textOf(r.subscriberCountText);
      const count = textOf(r.videoCountText);
      const thumbs = get(r.thumbnail, 'thumbnails') as { url?: string }[] | undefined;
      const url = thumbs?.[thumbs.length - 1]?.url ?? null;
      out.set(r.channelId, {
        id: r.channelId,
        title: textOf(r.title),
        handle: typeof canonical === 'string' && canonical.startsWith('/@') ? decodeURIComponent(canonical.slice(1)) : sub.startsWith('@') ? sub : null,
        thumbnail: url ? (url.startsWith('//') ? `https:${url}` : url) : null,
        // YouTube moved the subscriber count into videoCountText for handle-first channels.
        subscribersText: /subscriber/i.test(count) ? count : /subscriber/i.test(sub) ? sub : '',
        subscribed: get(r.subscriptionButton, 'subscribed') === true,
      });
      return;
    }
    for (const value of Object.values(obj)) if (value && typeof value === 'object') visit(value, depth + 1);
  };
  visit(root, 0);
  return [...out.values()];
}

export function parseWatchNext(root: unknown, videoId: string, now = Date.now()): WatchNext {
  const results = get(root, 'contents', 'twoColumnWatchNextResults');
  const primary = (get(results, 'results', 'results', 'contents') as unknown[] | undefined) ?? [];
  const primaryInfo = primary.map((c) => get(c, 'videoPrimaryInfoRenderer')).find(isObj);
  const secondaryInfo = primary.map((c) => get(c, 'videoSecondaryInfoRenderer')).find(isObj);
  const owner = get(secondaryInfo, 'owner', 'videoOwnerRenderer');
  const ownerRun = get(owner, 'title', 'runs', 0);
  const channel = channelFromEndpoint(get(ownerRun, 'navigationEndpoint') ?? get(owner, 'navigationEndpoint'));
  const pl = get(results, 'playlist', 'playlist');
  const playlist: YtPlaylist | null = isObj(pl)
    ? {
        id: String(pl.playlistId ?? ''),
        title: textOf(pl.title),
        total: typeof pl.totalVideos === 'number' ? pl.totalVideos : null,
        currentIndex: typeof pl.currentIndex === 'number' ? pl.currentIndex + 1 : null,
        videos: parseVideos(pl.contents, now),
      }
    : null;
  return {
    videoId,
    title: textOf(get(primaryInfo, 'title')),
    description: textOf(get(secondaryInfo, 'attributedDescription')) || textOf(get(secondaryInfo, 'description')),
    channelId: channel.id,
    channelTitle: textOf(get(owner, 'title')),
    channelHandle: channel.handle,
    playlist,
    related: parseVideos(get(results, 'secondaryResults'), now).filter((v) => v.id !== videoId),
  };
}
