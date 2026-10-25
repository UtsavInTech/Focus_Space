import { ApiError } from '../http';
import { EXAMS } from '@/modes/exams';
import { slugify } from '@/learning/text';
import type { CoursePayload, CourseSubject, Item } from './types';
import { channel, text } from './validate';

type PageItem = { id?: string; snippet?: { title?: string }; contentDetails?: { videoId?: string } };
type Page = { items?: PageItem[]; nextPageToken?: string };
type ExamTopic = (typeof EXAMS)[number]['topics'][number];

export type YouTubeFetch = (resource: string, params: Record<string, string>) => Promise<Page>;

/** Official Data API limits for one import — also what keeps a single click from spending the day's quota. */
const MAX_PAGES = 100;
const MAX_PLAYLISTS = 100;
const MAX_VIDEOS = 5000;

export function youtubeFetch(key = process.env.YOUTUBE_API_KEY): YouTubeFetch {
  return async (resource, params) => {
    if (!key) throw new ApiError(503, 'internal_error', 'YouTube course import is not configured.');
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for (const [name, value] of Object.entries({ ...params, key })) url.searchParams.set(name, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new ApiError(502, 'upstream_error', 'YouTube could not complete the import. Try later.');
    return (await response.json()) as Page;
  };
}

/** `@handle` and `/user/name` need one lookup; `/channel/UC…` and a bare id don't. */
function lookupParams(segments: string[]): Record<string, string> | null {
  if (segments[0].startsWith('@')) return { forHandle: segments[0] };
  if (segments[0] === 'user') return { forUsername: text(segments[1], 'username', 100) };
  return null;
}

export async function resolveChannel(input: string, read: YouTubeFetch): Promise<string> {
  if (/^UC[\w-]{22}$/.test(input)) return channel(input);

  let path = input;
  if (input.startsWith('http')) {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com'].includes(url.hostname)) {
      throw new ApiError(400, 'invalid_request', 'Use a YouTube channel URL.');
    }
    path = url.pathname;
  }

  const segments = path.replace(/^\//, '').split('/');
  if (segments[0] === 'channel') return channel(segments[1]);

  const params = lookupParams(segments);
  if (!params) throw new ApiError(400, 'invalid_request', 'Use a channel id, @handle, or YouTube channel URL.');
  const result = await read('channels', { part: 'id', ...params });
  if (!result.items?.[0]?.id) throw new ApiError(404, 'invalid_request', 'Channel not found.');
  return channel(result.items[0].id);
}

/** Catalog keywords worth matching on: "~" marks a supporting-only signal, and short words match too much. */
const strongKeywords = (topic: ExamTopic) => topic.keywords.filter((keyword) => !keyword.startsWith('~'));

/** Scores a playlist title against one exam topic: total length of the topic's names it contains. */
function titleScore(topic: ExamTopic, title: string): number {
  return [topic.name, ...strongKeywords(topic)]
    .filter((keyword) => keyword.length >= 4 && title.includes(keyword.toLowerCase()))
    .reduce((n, keyword) => n + keyword.length, 0);
}

function bestTopic(exam: (typeof EXAMS)[number] | undefined, title: string): ExamTopic | null {
  const match = exam?.topics.map((topic) => ({ topic, score: titleScore(topic, title) })).sort((a, b) => b.score - a.score)[0];
  return match && match.score > 0 ? match.topic : null;
}

/** Walks every page of one list endpoint. A repeated token or an endless list fails closed. */
async function eachPage(read: YouTubeFetch, resource: string, params: Record<string, string>, visit: (item: PageItem) => Promise<void>): Promise<void> {
  const seen = new Set<string>();
  let token = '';
  do {
    if (seen.has(token)) throw new ApiError(502, 'upstream_error', 'YouTube returned a repeated page token.');
    seen.add(token);
    if (seen.size > MAX_PAGES) throw new ApiError(400, 'invalid_request', 'Import is too large. Split this channel into smaller courses.');
    const page = await read(resource, { ...params, maxResults: '50', ...(token ? { pageToken: token } : {}) });
    for (const item of page.items ?? []) await visit(item);
    token = page.nextPageToken ?? '';
  } while (token);
}

/** Titles exist only transiently to match the learning map. Persist ids and authored catalog labels only. */
export async function importChannel(input: string, brand: CoursePayload['brand'], examId: string | null, read: YouTubeFetch = youtubeFetch()) {
  const source = await resolveChannel(input, read);
  const exam = EXAMS.find((e) => e.id === examId);
  const subjects = new Map<string, CourseSubject>();
  let playlistCount = 0;
  let videoCount = 0;

  await eachPage(read, 'playlists', { part: 'snippet', channelId: source }, async (playlist) => {
    if (++playlistCount > MAX_PLAYLISTS) throw new ApiError(400, 'invalid_request', 'Import at most 100 playlists per course.');
    if (!playlist.id || !/^[\w-]+$/.test(playlist.id)) return;

    const topic = bestTopic(exam, (playlist.snippet?.title ?? '').toLowerCase());
    const group = topic?.group ?? 'Other';
    if (!subjects.has(group)) subjects.set(group, { id: slugify(group) || 'other', title: group, topics: [] });

    const items: Item[] = [];
    const seenVideos = new Set<string>();
    await eachPage(read, 'playlistItems', { part: 'contentDetails', playlistId: playlist.id }, async (item) => {
      const id = item.contentDetails?.videoId;
      if (!id || !/^[\w-]{11}$/.test(id) || seenVideos.has(id)) return;
      seenVideos.add(id);
      if (++videoCount > MAX_VIDEOS) throw new ApiError(400, 'invalid_request', 'Import at most 5000 videos per course.');
      items.push({ type: 'video', videoId: id });
    });

    subjects.get(group)!.topics.push({
      id: `playlist-${playlist.id}`,
      title: topic?.name ?? `Playlist ${playlistCount}`,
      subtopics: topic ? strongKeywords(topic).slice(0, 20) : [],
      items,
    });
  });

  if (!videoCount) throw new ApiError(400, 'invalid_request', 'No public playlist videos found on this channel.');
  const payload = { brand, subjects: [...subjects.values()], approvedChannels: [{ id: source }], modes: [] } satisfies CoursePayload;
  return { payload, sourceChannelId: source, playlists: playlistCount, videos: videoCount };
}
