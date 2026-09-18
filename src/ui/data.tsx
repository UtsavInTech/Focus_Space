import { createContext, useContext } from 'react';
import type { YtChannel } from '@/integrations/youtube/innertube-parse';
import { sendMessage } from '@/messaging/runtime';

/**
 * YouTube data the shared UI needs (channel search). On youtube.com it's
 * answered by the page's own session; on extension pages by the background.
 */
export interface YouTubeData {
  searchChannels(query: string, signal?: AbortSignal): Promise<YtChannel[]>;
}

export const backgroundYouTubeData: YouTubeData = {
  async searchChannels(query) {
    const res = await sendMessage('youtube/search-channels', { query });
    if (!res.ok) throw new Error(res.error);
    return res.channels;
  },
};

export const YouTubeDataContext = createContext<YouTubeData>(backgroundYouTubeData);

export const useYouTubeData = () => useContext(YouTubeDataContext);
