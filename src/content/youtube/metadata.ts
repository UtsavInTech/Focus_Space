import type { VideoMetadata } from '@/learning/classifier';
import { watchUrl } from '@/integrations/youtube/urls';
import { WATCH, queryFirst } from './selectors';

/**
 * Metadata for the video currently open on /watch.
 *
 * On SPA navigation the watch page DOM still shows the previous video for a
 * moment, so the title/channel come from YouTube's official oEmbed endpoint
 * (keyed by the video id in the URL). The description is read from the DOM
 * only once the on-page title matches, so it can't belong to the old video.
 */

interface OEmbed {
  title: string;
  author_name: string;
  author_url: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOEmbed(videoId: string): Promise<OEmbed | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`, { credentials: 'omit' });
    return res.ok ? ((await res.json()) as OEmbed) : null;
  } catch {
    return null;
  }
}

const currentVideoId = () => new URL(location.href).searchParams.get('v');

export async function readVideoMetadata(videoId: string, isStale: () => boolean): Promise<VideoMetadata | null> {
  const oembed = await fetchOEmbed(videoId);
  let title = oembed?.title ?? '';
  let description = '';
  let handle = oembed?.author_url.match(/youtube\.com\/(@[^/?#]+)/)?.[1];

  // Wait (briefly) for the page to render this video, then enrich from the DOM.
  for (let i = 0; i < 24 && !isStale(); i++) {
    const flexyId = document.querySelector(WATCH.flexy)?.getAttribute('video-id');
    const h1 = queryFirst(WATCH.title)?.textContent?.trim() ?? '';
    const ready = flexyId === videoId && h1 && (!title || norm(h1) === norm(title));
    if (ready) {
      title ||= h1;
      description = (queryFirst(WATCH.description)?.textContent ?? '').trim().slice(0, 1500);
      const ownerHref = queryFirst<HTMLAnchorElement>(WATCH.ownerLink)?.getAttribute('href') ?? '';
      handle ??= ownerHref.match(/^\/(@[^/?#]+)/)?.[1];
      break;
    }
    await sleep(250);
  }

  if (isStale() || currentVideoId() !== videoId || !title) return null;
  return {
    videoId,
    title,
    description,
    channelTitle: oembed?.author_name,
    channelHandle: handle ? decodeURIComponent(handle) : undefined,
  };
}

export function currentVideoElement(): HTMLVideoElement | null {
  return queryFirst<HTMLVideoElement>(WATCH.video);
}
