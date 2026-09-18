/**
 * Resolve "@handle" / "/c/name" to a channel id using the channel page's
 * standard SEO tags (<link rel="canonical">, og: meta). Runs in the service
 * worker, unauthenticated.
 */

export interface ResolvedChannel {
  id: string;
  title?: string;
  thumbnail?: string;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function parseChannelPage(html: string): ResolvedChannel | null {
  const id =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] ??
    html.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/)?.[1] ??
    html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ??
    html.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
  if (!id) return null;
  const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
  const thumbnail = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  return { id, title: title ? decode(title) : undefined, thumbnail: thumbnail ? decode(thumbnail) : undefined };
}

export async function resolveChannelPath(path: string): Promise<ResolvedChannel | null> {
  const res = await fetch(`https://www.youtube.com${encodeURI(path)}`, { credentials: 'omit' });
  if (!res.ok) return null;
  return parseChannelPage(await res.text());
}
