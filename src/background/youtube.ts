import { createInnerTubeClient, type InnerTubeConfig, type VideoPage } from '@/integrations/youtube/innertube-client';
import type { YtChannel } from '@/integrations/youtube/innertube-parse';
import type { YouTubeRelayRequest } from '@/types/messages';
import { sendTabMessage } from '@/messaging/runtime';

/**
 * Public YouTube data for the service worker (channel uploads, channel search).
 *
 * YouTube's web API rejects requests from an extension origin (HTTP 403), so
 * calls are relayed through an open youtube.com tab, where the content script
 * makes them from YouTube's own origin exactly like the page does. With no
 * YouTube tab open, a direct anonymous request is still attempted, and callers
 * fall back to public RSS feeds.
 */

const FALLBACK_VERSION = '2.20260911.01.00';
const CONFIG_TTL = 12 * 3_600_000;
let cached: { config: InnerTubeConfig; at: number } | null = null;

async function loadConfig(): Promise<InnerTubeConfig> {
  if (cached && Date.now() - cached.at < CONFIG_TTL) return cached.config;
  let clientVersion = FALLBACK_VERSION;
  let apiKey: string | undefined;
  try {
    const html = await (await fetch('https://www.youtube.com/', { credentials: 'omit' })).text();
    clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? FALLBACK_VERSION;
    apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  } catch {
    /* offline: the fallback version is fine */
  }
  const config: InnerTubeConfig = { clientName: 'WEB', clientNameId: '1', clientVersion, apiKey, loggedIn: false, hl: chrome.i18n?.getUILanguage?.().split('-')[0] ?? 'en' };
  cached = { config, at: Date.now() };
  return config;
}

const direct = createInnerTubeClient({ getConfig: loadConfig, credentials: 'omit' });

async function relay<T>(request: YouTubeRelayRequest): Promise<T | undefined> {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
    if (tab.id === undefined || tab.discarded) continue;
    try {
      const res = await sendTabMessage(tab.id, 'content/youtube', request);
      if (res?.ok) return res.data as T;
      if (res && !res.ok) throw new Error(res.error);
    } catch {
      /* tab without a live content script (e.g. still loading): try the next one */
    }
  }
  return undefined;
}

export const backgroundYouTube = {
  async channelUploads(channelId: string): Promise<VideoPage> {
    return (await relay<VideoPage>({ op: 'channelUploads', channelId })) ?? direct.channelUploads(channelId);
  },
  async searchChannels(query: string): Promise<YtChannel[]> {
    const viaTab = await relay<YtChannel[]>({ op: 'searchChannels', query });
    if (viaTab) return viaTab;
    try {
      return await direct.searchChannels(query);
    } catch {
      throw new Error('Open YouTube in a tab to search channels.');
    }
  },
};
