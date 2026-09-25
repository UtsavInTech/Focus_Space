import { compactSegments, parseTimedText } from '@/integrations/youtube/transcript-parse';
import { pickTrack, type CaptionTrack } from './caption-track';

/**
 * FocusSpace ↔ YouTube bridge. Runs in the page's MAIN world (manifest
 * "world": "MAIN") and does only what the isolated content script can't:
 *
 * 1. Navigate with YouTube's own SPA router (`yt-navigate` on <ytd-app>), so
 *    FocusSpace links behave exactly like YouTube links: same tab, no reload,
 *    back/forward and scroll restoration handled by YouTube.
 * 2. Share the page's public client config (ytcfg) so the content script can
 *    call the same endpoints youtube.com calls for this user.
 * 3. Read the captions YouTube's player loads (/api/timedtext) — the only
 *    transcript source that works, since direct transcript requests are
 *    rejected without the player's own token. Read-only: responses are cloned,
 *    never changed. Only when FocusSpace explicitly asks does it have the
 *    player load captions, then it restores the caption state and preference.
 *
 * Messages cross worlds as JSON strings (object details don't).
 */

declare global {
  interface Window {
    ytcfg?: { get?: (key: string) => unknown; data_?: Record<string, unknown> };
    __focusSpaceBridge?: boolean;
  }
}

const NAVIGATE = 'focusspace:navigate';
const CONFIG_REQUEST = 'focusspace:config-request';
const CONFIG = 'focusspace:config';

type Endpoint = Record<string, unknown>;

function endpointFor(url: URL): Endpoint | null {
  const meta = (webPageType: string, rootVe: number) => ({ commandMetadata: { webCommandMetadata: { url: url.pathname + url.search, webPageType, rootVe } } });
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/watch') {
    const videoId = url.searchParams.get('v');
    if (!videoId) return null;
    const playlistId = url.searchParams.get('list') ?? undefined;
    const index = url.searchParams.get('index');
    return { ...meta('WEB_PAGE_TYPE_WATCH', 3832), watchEndpoint: { videoId, playlistId, index: index ? Number(index) - 1 : undefined } };
  }
  if (path === '/results') {
    const query = url.searchParams.get('search_query');
    return query ? { ...meta('WEB_PAGE_TYPE_SEARCH', 4724), searchEndpoint: { query } } : null;
  }
  if (path === '/') return { ...meta('WEB_PAGE_TYPE_BROWSE', 3854), browseEndpoint: { browseId: 'FEwhat_to_watch' } };
  if (path === '/feed/subscriptions') return { ...meta('WEB_PAGE_TYPE_BROWSE', 96368), browseEndpoint: { browseId: 'FEsubscriptions' } };
  if (path === '/playlist') {
    const list = url.searchParams.get('list');
    return list ? { ...meta('WEB_PAGE_TYPE_PLAYLIST', 5754), browseEndpoint: { browseId: `VL${list}` } } : null;
  }
  const channel = path.match(/^\/channel\/(UC[\w-]{22})$/);
  if (channel) return { ...meta('WEB_PAGE_TYPE_CHANNEL', 3611), browseEndpoint: { browseId: channel[1] } };
  return null;
}

function navigate(href: string) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) return location.assign(url.href);
  if (url.pathname + url.search === location.pathname + location.search) return;
  const app = document.querySelector('ytd-app');
  const endpoint = endpointFor(url);
  if (!app || !endpoint) return location.assign(url.href);

  let started = false;
  const onStart = () => {
    started = true;
  };
  document.addEventListener('yt-navigate-start', onStart, { once: true });
  app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
  // If YouTube's router didn't pick it up, fall back to a normal navigation.
  window.setTimeout(() => {
    document.removeEventListener('yt-navigate-start', onStart);
    if (!started && location.pathname + location.search !== url.pathname + url.search) location.assign(url.href);
  }, 1500);
}

const CONFIG_KEYS = ['INNERTUBE_API_KEY', 'INNERTUBE_CONTEXT', 'INNERTUBE_CLIENT_NAME', 'INNERTUBE_CONTEXT_CLIENT_NAME', 'INNERTUBE_CLIENT_VERSION', 'SESSION_INDEX', 'DELEGATED_SESSION_ID', 'LOGGED_IN'];

function readConfig(): Record<string, unknown> | null {
  const cfg = window.ytcfg;
  if (!cfg) return null;
  const get = (key: string) => (typeof cfg.get === 'function' ? cfg.get(key) : cfg.data_?.[key]);
  if (!get('INNERTUBE_CLIENT_VERSION')) return null;
  return Object.fromEntries(CONFIG_KEYS.map((k) => [k, get(k)]));
}

function answerConfig(attempt = 0) {
  const config = readConfig();
  if (config || attempt > 50) {
    document.dispatchEvent(new CustomEvent(CONFIG, { detail: JSON.stringify(config) }));
    return;
  }
  window.setTimeout(() => answerConfig(attempt + 1), 200);
}

/* ─── Captions ─────────────────────────────────────────────────────────────── */

const CAPTIONS = 'focusspace:captions';
const CAPTIONS_REQUEST = 'focusspace:captions-request';
const CAPTIONS_STATUS = 'focusspace:captions-status';
/** YouTube's "remember captions on/off" preference; restored after an explicit load. */
const CAPTION_PERSISTENCE = 'yt-player-caption-persistence';

interface Player extends HTMLElement {
  getOption?(module: string, option: string, arg?: unknown): unknown;
  setOption?(module: string, option: string, value: unknown): void;
  loadModule?(module: string): void;
  unloadModule?(module: string): void;
  getVideoData?(): { video_id?: string };
}

const captured = new Map<string, string>();
const loading = new Map<string, Promise<string>>();
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
/** How long an explicit caption load waits for the player's download. */
const CAPTIONS_WAIT_MS = 45_000;

function onTimedText(url: string, body: string) {
  try {
    const u = new URL(url, location.origin);
    const videoId = u.searchParams.get('v');
    if (!videoId) return;
    const segments = compactSegments(parseTimedText(body));
    if (segments.length < 3) return;
    const payload = JSON.stringify({ videoId, languageCode: u.searchParams.get('tlang') ?? u.searchParams.get('lang') ?? '', kind: u.searchParams.get('kind') === 'asr' ? 'asr' : 'manual', segments });
    captured.set(videoId, payload);
    if (captured.size > 4) captured.delete(captured.keys().next().value as string);
    document.dispatchEvent(new CustomEvent(CAPTIONS, { detail: payload }));
  } catch {
    /* never interfere with the player */
  }
}

function hookTimedText() {
  const isTimedText = (url: string) => url.includes('/api/timedtext');
  const nativeFetch = window.fetch;
  window.fetch = function (...args: Parameters<typeof fetch>) {
    const result = Reflect.apply(nativeFetch, window, args) as Promise<Response>;
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (isTimedText(url))
        result
          .then((res) => res.clone().text())
          .then((text) => onTimedText(url, text))
          .catch(() => undefined);
    } catch {
      /* ignore */
    }
    return result;
  } as typeof fetch;

  type TrackedXhr = XMLHttpRequest & { __fsUrl?: string };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: TrackedXhr, ...args: unknown[]) {
    this.__fsUrl = String(args[1]);
    return (open as (...a: unknown[]) => void).apply(this, args);
  } as typeof open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: TrackedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = this.__fsUrl;
    if (url && isTimedText(url))
      this.addEventListener('load', () => {
        try {
          const r = this.response as unknown;
          const text = typeof r === 'string' ? r : r instanceof ArrayBuffer ? new TextDecoder().decode(r) : this.responseType === '' ? this.responseText : '';
          if (text) onTimedText(url, text);
        } catch {
          /* ignore */
        }
      });
    return send.call(this, body);
  };
}

async function loadCaptions(videoId: string): Promise<string> {
  const existing = captured.get(videoId);
  if (existing) {
    document.dispatchEvent(new CustomEvent(CAPTIONS, { detail: existing }));
    return 'captured';
  }
  const player = document.querySelector<Player>('#movie_player');
  if (!player?.getOption || !player.setOption || !player.loadModule) return 'unsupported';
  if (player.getVideoData?.().video_id !== videoId) return 'not-ready';
  if (player.classList.contains('ad-showing')) return 'ad';

  const shown = document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true';
  const previous = player.getOption('captions', 'track') as CaptionTrack | undefined;
  let persistence: string | null = null;
  try {
    persistence = localStorage.getItem(CAPTION_PERSISTENCE);
  } catch {
    /* storage blocked */
  }
  const root = document.documentElement;
  root.setAttribute('data-fs-captions-loading', '');
  try {
    player.loadModule('captions');
    let tracks: CaptionTrack[] = [];
    for (let i = 0; i < 12 && !tracks.length; i++) {
      await sleep(200);
      tracks = (player.getOption('captions', 'tracklist', { includeAsr: true }) as CaptionTrack[] | undefined) ?? [];
    }
    if (!tracks.length) return 'none';
    const pick = pickTrack(tracks, (root.lang || navigator.language || 'en').slice(0, 2));
    if (!pick) return 'none';
    player.setOption('captions', 'track', { languageCode: pick.languageCode, kind: pick.kind });
    // A 30-hour lecture's captions are one ~30 MB response; 7.5 s was too short on anything but a fast
    // connection, and giving up here unloads the captions module mid-download, so they never arrived.
    for (let i = 0; i < CAPTIONS_WAIT_MS / 150 && !captured.has(videoId); i++) await sleep(150);
    return captured.has(videoId) ? 'captured' : 'none';
  } finally {
    try {
      if (shown && previous?.languageCode) player.setOption('captions', 'track', previous);
      else {
        player.setOption('captions', 'track', {});
        player.unloadModule?.('captions');
      }
    } catch {
      /* ignore */
    }
    try {
      if (persistence === null) localStorage.removeItem(CAPTION_PERSISTENCE);
      else localStorage.setItem(CAPTION_PERSISTENCE, persistence);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => root.removeAttribute('data-fs-captions-loading'), 400);
  }
}

if (!window.__focusSpaceBridge) {
  window.__focusSpaceBridge = true;
  hookTimedText();
  document.addEventListener(CAPTIONS_REQUEST, (event) => {
    try {
      const { videoId, requestId } = JSON.parse(String((event as CustomEvent).detail)) as { videoId: string; requestId: number };
      const task = loading.get(videoId) ?? loadCaptions(videoId).catch(() => 'failed');
      loading.set(videoId, task);
      void task.then((status) => {
        loading.delete(videoId);
        document.dispatchEvent(new CustomEvent(CAPTIONS_STATUS, { detail: JSON.stringify({ requestId, status }) }));
      });
    } catch {
      /* malformed message */
    }
  });
  document.addEventListener(NAVIGATE, (event) => {
    try {
      const { url } = JSON.parse(String((event as CustomEvent).detail)) as { url: string };
      navigate(url);
    } catch {
      /* malformed message */
    }
  });
  document.addEventListener(CONFIG_REQUEST, () => answerConfig());
}

export {};
