import type { ImportedChannel, SessionSubscriptionsResult } from '@/types/messages';
import { isChannelId } from './urls';

/**
 * Subscription list from the user's signed-in YouTube web session.
 *
 * WHY THIS EXISTS: the official YouTube Data API (subscriptions.list?mine=true)
 * requires an OAuth client registered in Google Cloud for this extension's id.
 * Until that exists, the only zero-setup way to know "what I'm subscribed to"
 * is the same data youtube.com/feed/channels renders for the signed-in user.
 *
 * ISOLATION: this is the ONLY module that understands YouTube's web page data.
 * It runs inside the youtube.com content script (same-origin, the user's own
 * cookies, nothing leaves the browser). Parsing walks the JSON generically
 * instead of hard-coding paths, so layout reshuffles rarely break it. Swap it
 * for a Data API provider by implementing the same SessionSubscriptionsResult.
 */

const CHANNELS_URL = 'https://www.youtube.com/feed/channels';
const MAX_PAGES = 60;

/** Extract the JSON object literal that follows `marker` in an HTML/JS string. */
export function extractJsonObject(source: string, marker: string | RegExp): unknown | null {
  const idx = typeof marker === 'string' ? source.indexOf(marker) : source.search(marker);
  if (idx < 0) return null;
  const start = source.indexOf('{', idx);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;

const readText = (v: unknown): string => {
  if (!isObj(v)) return typeof v === 'string' ? v : '';
  if (typeof v.simpleText === 'string') return v.simpleText;
  if (typeof v.content === 'string') return v.content;
  if (Array.isArray(v.runs)) return v.runs.map((r) => (isObj(r) && typeof r.text === 'string' ? r.text : '')).join('');
  return '';
};

const bestThumb = (v: unknown): string | undefined => {
  const list = isObj(v) && Array.isArray(v.thumbnails) ? v.thumbnails : isObj(v) && Array.isArray(v.sources) ? v.sources : null;
  const last = list?.[list.length - 1];
  const url = isObj(last) && typeof last.url === 'string' ? last.url : undefined;
  return url ? (url.startsWith('//') ? `https:${url}` : url) : undefined;
};

/** Walk any InnerTube response and collect channel renderers + continuation tokens. */
export function collectChannels(root: unknown): { channels: ImportedChannel[]; continuations: string[] } {
  const channels = new Map<string, ImportedChannel>();
  const continuations: string[] = [];
  const stack: unknown[] = [root];
  let guard = 0;

  while (stack.length && guard++ < 500_000) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (!isObj(node)) continue;

    const renderer = node.channelRenderer ?? node.gridChannelRenderer;
    if (isObj(renderer) && typeof renderer.channelId === 'string' && isChannelId(renderer.channelId)) {
      const endpoint = isObj(renderer.navigationEndpoint) ? renderer.navigationEndpoint : {};
      const browse = isObj(endpoint.browseEndpoint) ? endpoint.browseEndpoint : {};
      const canonical = typeof browse.canonicalBaseUrl === 'string' ? browse.canonicalBaseUrl : '';
      const handleFromSub = readText(renderer.subscriberCountText);
      const handle = canonical.startsWith('/@') ? decodeURIComponent(canonical.slice(1)) : handleFromSub.startsWith('@') ? handleFromSub : undefined;
      channels.set(renderer.channelId, {
        id: renderer.channelId,
        title: readText(renderer.title) || handle || renderer.channelId,
        handle,
        thumbnail: bestThumb(renderer.thumbnail),
      });
      continue;
    }

    const command = isObj(node.continuationCommand) ? node.continuationCommand : null;
    if (command && typeof command.token === 'string') continuations.push(command.token);
    const nextData = isObj(node.nextContinuationData) ? node.nextContinuationData : null;
    if (nextData && typeof nextData.continuation === 'string') continuations.push(nextData.continuation);

    for (const value of Object.values(node)) if (typeof value === 'object' && value !== null) stack.push(value);
  }
  return { channels: [...channels.values()], continuations };
}

interface YtConfig {
  INNERTUBE_API_KEY?: string;
  INNERTUBE_CONTEXT?: Json;
  INNERTUBE_CLIENT_NAME?: string | number;
  INNERTUBE_CONTEXT_CLIENT_NAME?: string | number;
  INNERTUBE_CLIENT_VERSION?: string;
  LOGGED_IN?: boolean;
  SESSION_INDEX?: string | number;
  DELEGATED_SESSION_ID?: string;
}

export function extractYtConfig(html: string): YtConfig {
  const config: YtConfig = {};
  let from = 0;
  // ytcfg.set({...}) appears several times; merge them all.
  for (let guard = 0; guard < 20; guard++) {
    const idx = html.indexOf('ytcfg.set({', from);
    if (idx < 0) break;
    const obj = extractJsonObject(html.slice(idx), 'ytcfg.set(');
    if (isObj(obj)) Object.assign(config, obj);
    from = idx + 10;
  }
  return config;
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Same authorization header youtube.com itself sends for signed-in requests. */
export async function authorizationHeader(origin: string): Promise<string | null> {
  const sapisid = readCookie('SAPISID') ?? readCookie('__Secure-3PAPISID');
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const hash = await sha1Hex(`${ts} ${sapisid} ${origin}`);
  return `SAPISIDHASH ${ts}_${hash}`;
}

/** Runs inside the youtube.com content script. */
export async function readSubscriptionsFromSession(): Promise<SessionSubscriptionsResult> {
  let html: string;
  try {
    const res = await fetch(CHANNELS_URL, { credentials: 'include', redirect: 'manual' });
    // Signed-out visitors are redirected to accounts.google.com.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { ok: false, code: 'signed-out', error: 'You are not signed in to YouTube in this browser.' };
    }
    if (!res.ok) return { ok: false, code: 'network', error: `YouTube returned HTTP ${res.status}` };
    html = await res.text();
  } catch (err) {
    return { ok: false, code: 'network', error: err instanceof Error ? err.message : 'Network error' };
  }

  const config = extractYtConfig(html);
  if (config.LOGGED_IN === false) {
    return { ok: false, code: 'signed-out', error: 'You are not signed in to YouTube in this browser.' };
  }
  const initialData = extractJsonObject(html, /(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=/);
  if (!initialData) return { ok: false, code: 'parse-failed', error: 'Could not read the subscriptions page.' };

  const first = collectChannels(initialData);
  const all = new Map(first.channels.map((c) => [c.id, c]));
  let queue = first.continuations;
  let complete = queue.length === 0;

  if (queue.length && config.INNERTUBE_API_KEY && config.INNERTUBE_CONTEXT) {
    const origin = 'https://www.youtube.com';
    const seen = new Set<string>();
    complete = true;
    for (let page = 0; page < MAX_PAGES && queue.length; page++) {
      const token = queue.shift()!;
      if (seen.has(token)) continue;
      seen.add(token);
      const auth = await authorizationHeader(origin);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Origin': origin,
        'X-Goog-AuthUser': String(config.SESSION_INDEX ?? 0),
        'X-Youtube-Client-Name': String(config.INNERTUBE_CONTEXT_CLIENT_NAME ?? 1),
        'X-Youtube-Client-Version': String(config.INNERTUBE_CLIENT_VERSION ?? ''),
      };
      if (auth) headers.Authorization = auth;
      if (config.DELEGATED_SESSION_ID) headers['X-Goog-PageId'] = config.DELEGATED_SESSION_ID;
      try {
        const res = await fetch(`${origin}/youtubei/v1/browse?key=${config.INNERTUBE_API_KEY}&prettyPrint=false`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ context: config.INNERTUBE_CONTEXT, continuation: token }),
        });
        if (!res.ok) {
          complete = false;
          break;
        }
        const next = collectChannels(await res.json());
        next.channels.forEach((c) => all.set(c.id, c));
        queue = [...queue, ...next.continuations];
      } catch {
        complete = false;
        break;
      }
    }
    if (queue.length) complete = false;
  }

  if (all.size === 0) {
    const signedOut = config.LOGGED_IN !== true;
    return signedOut
      ? { ok: false, code: 'signed-out', error: 'You are not signed in to YouTube in this browser.' }
      : { ok: false, code: 'parse-failed', error: 'No subscriptions were found on your YouTube account.' };
  }
  return { ok: true, channels: [...all.values()], complete };
}
