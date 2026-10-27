import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Channel, LearningMode, VideoRecord } from '@/types/domain';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { DEFAULT_MODES } from '@/modes/templates';
import { inferModeIntent, modeFromSuggestion } from '@/modes/intent';
import { composeFeed } from './feed';
import { buildSeriesState, compressRanges, mergeNextItems, numberedSeries, resumeItems, seriesItems, seriesNumber, type SeriesSource } from './next';
import { discoveryQueriesFor, rankDiscovery } from './discovery';
import { buildFeedView, searchFeedView, topicItems } from './feed-view';

const mode = (id: string): LearningMode => structuredClone(DEFAULT_MODES.find((m) => m.id === id)!);

describe('feed composition: subscriptions first, discovery woven in', () => {
  const idOf = { primary: (v: unknown) => String(v), discovery: (d: string) => d };

  it('inserts one discovery after every four subscription videos', () => {
    const feed = composeFeed(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'], ['d1', 'd2', 'd3'], { every: 4, idOf });
    expect(feed.map((e) => (e.type === 'divider' ? '|' : e.item))).toEqual(['s1', 's2', 's3', 's4', 'd1', 's5', 's6', 's7', 's8', 'd2', 's9', '|', 'd3']);
  });

  it('continues with discovery (after a divider) when subscriptions run out', () => {
    const feed = composeFeed(['s1', 's2'], ['d1', 'd2'], { every: 4, idOf });
    expect(feed.map((e) => e.type)).toEqual(['primary', 'primary', 'divider', 'discovery', 'discovery']);
    expect(composeFeed([], ['d1'], { idOf }).map((e) => e.type)).toEqual(['discovery']);
  });

  it('marks only the first qualifying discovery as the spotlight', () => {
    const feed = composeFeed(['s1', 's2', 's3', 's4'], ['great', 'great2'], { every: 4, idOf, isSpotlight: (d) => d.startsWith('great') });
    expect(feed.filter((e) => e.type === 'discovery' && e.spotlight)).toHaveLength(1);
  });

  it('never repeats a video (a duplicate discovery is skipped, the next one takes its slot)', () => {
    const feed = composeFeed(['a', 'b'], ['a', 'c'], { every: 1, idOf });
    expect(feed.flatMap((e) => (e.type === 'divider' ? [] : [e.item]))).toEqual(['a', 'c', 'b']);
  });
});

describe('series continuity', () => {
  it('reads numbering from real lecture titles', () => {
    expect(seriesNumber('L18. Implement LRU Cache | Stack and Queue Playlist')).toMatchObject({ n: 18 });
    expect(seriesNumber('Lecture 7: Graphs')).toMatchObject({ n: 7 });
    expect(seriesNumber('4.7 [New] Traveling Salesman Problem - Dynamic Programming')).toMatchObject({ n: 407 });
    expect(seriesNumber('Episode 12 — Heaps')).toMatchObject({ n: 12 });
    expect(seriesNumber('Transformers Explained')).toBeNull();
    expect(seriesNumber('L6. Next Greater Element - II | Stack and Queue Playlist')!.key).toBe(seriesNumber('L17. The Celebrity Problem | Stack and Queue Playlist')!.key);
  });

  const series: SeriesSource = {
    id: 'PLdsa',
    title: 'DSA Complete Series',
    kind: 'playlist',
    items: Array.from({ length: 31 }, (_, i) => ({ videoId: `v${i + 1}`, title: `Lecture ${i + 1}`, index: i + 1 })),
  };

  it('finds the missed lecture and puts it first', () => {
    const watched = new Map<string, number>();
    for (let i = 1; i <= 30; i++) if (i !== 18) watched.set(`v${i}`, 1);
    const state = buildSeriesState(series, null, watched, true);
    expect(state.missed.map((m) => m.index)).toEqual([18]);
    expect(state.next?.index).toBe(31);
    expect(state.completedLabel).toBe('1–17, 19–30');
    expect(state.confidence).toBe('high');
    const items = seriesItems(state);
    expect(items[0]).toMatchObject({ kind: 'missed', videoId: 'v18' });
    expect(items[1]).toMatchObject({ kind: 'next', videoId: 'v31' });
    expect(items[0].url).toContain('list=PLdsa');
  });

  it('continues from the current lecture', () => {
    const watched = new Map(Array.from({ length: 17 }, (_, i) => [`v${i + 1}`, 1] as [string, number]));
    const state = buildSeriesState(series, 'v18', watched);
    expect(state.current?.index).toBe(18);
    expect(state.missed).toEqual([]);
    expect(state.next?.index).toBe(19);
    expect(state.upcoming.map((u) => u.index)).toEqual([20, 21, 22]);
  });

  it('builds a numbered series from a real channel (take U forward, Stack & Queue playlist)', () => {
    const fx = JSON.parse(readFileSync(new URL('./relevance/__fixtures__/real-channels.json', import.meta.url), 'utf8')) as { channels: { id: string; handle: string; videos: { id: string; title: string }[] }[] };
    const tuf = fx.channels.find((c) => c.handle === '@takeUforward')!;
    const anchor = tuf.videos.find((v) => v.title.startsWith('L12.'))!;
    const source = numberedSeries({ videoId: anchor.id, title: anchor.title, channelId: tuf.id, channelTitle: 'take U forward' }, tuf.videos.map((v) => ({ id: v.id, title: v.title, channelId: tuf.id })));
    expect(source).not.toBeNull();
    expect(source!.title).toBe('Stack and Queue Playlist');
    const state = buildSeriesState(source!, anchor.id, new Map());
    expect(state.next?.title.startsWith('L13.')).toBe(true);
    expect(state.confidence).toBe('medium');
  });

  it('resumes unfinished videos and orders missed → resume → next', () => {
    const now = Date.now();
    const resume = resumeItems(
      [
        { videoId: 'a', title: 'A', channelTitle: 'c', progress: 0.4, watchedAt: now - 1000 },
        { videoId: 'b', title: 'B', channelTitle: 'c', progress: 0.95, watchedAt: now },
        { videoId: 'c', title: 'C', channelTitle: 'c', progress: 0.01, watchedAt: now },
      ],
      now,
    );
    expect(resume.map((r) => r.videoId)).toEqual(['a']);
    expect(resume[0].reason).toBe('40% watched');
    const merged = mergeNextItems([[{ ...resume[0], kind: 'next', videoId: 'n' }], resume, [{ ...resume[0], kind: 'missed', videoId: 'm' }]]);
    expect(merged.map((m) => m.kind)).toEqual(['missed', 'resume', 'next']);
    expect(compressRanges([3, 1, 2, 7, 5, 6])).toBe('1–3, 5–7');
  });
});

describe('YouTube discovery ranking', () => {
  const yt = (id: string, title: string, extra: Partial<YtVideo> = {}): YtVideo => ({
    id,
    title,
    channelId: `UC${id.padEnd(22, 'x')}`,
    channelTitle: 'Some channel',
    channelHandle: null,
    description: '',
    thumbnail: '',
    durationSec: 900,
    views: 10_000,
    publishedText: '1 year ago',
    publishedAt: null,
    watchedPercent: null,
    isShort: false,
    isLive: false,
    index: null,
    playlistId: null,
    ...extra,
  });
  const none = { videoIds: new Set<string>(), channelIds: new Set<string>() };

  it('only shows relevant, long-form, unseen videos from outside the library', () => {
    const dsa = mode('dsa');
    const q = 'dynamic programming data structures and algorithms';
    const candidates = [
      yt('good', 'Dynamic Programming Explained with Examples'),
      yt('short', 'DP in 30 seconds #shorts', { isShort: true }),
      yt('live', 'Live: solving DP problems', { isLive: true }),
      yt('tiny', 'Dynamic Programming tip', { durationSec: 40 }),
      yt('offtopic', 'My morning routine'),
      yt('owned', 'Graphs Tutorial for Beginners'),
      yt('watched', 'Binary Search Explained', { watchedPercent: 97 }),
    ].map((video) => ({ video, query: q, fromSpaceQuery: true, topicId: null }));
    const ranked = rankDiscovery(dsa, candidates, { videoIds: new Set(['owned']), channelIds: new Set() });
    expect(ranked.map((r) => r.video.id)).toEqual(['good']);
    expect(ranked[0].reasons).toContain('Not from your subscriptions');
  });

  it('lets a music space trust its own search context, but not arbitrary recommendations', () => {
    const punjabi = modeFromSuggestion(inferModeIntent('Punjabi music')!, []);
    const video = yt('song', 'Karan Aujla - Wavy (Official Music Video)');
    expect(rankDiscovery(punjabi, [{ video, query: 'punjabi songs', fromSpaceQuery: true, topicId: null }], none)).toHaveLength(1);
    expect(rankDiscovery(punjabi, [{ video, query: null, fromSpaceQuery: false, topicId: null }], none)).toHaveLength(0);
    const reaction = yt('react', 'Reacting to Karan Aujla - Wavy (Official Music Video)');
    expect(rankDiscovery(punjabi, [{ video: reaction, query: 'punjabi songs', fromSpaceQuery: true, topicId: null }], none)).toHaveLength(0);
  });

  it('builds searches from the space and its topics', () => {
    const ai = mode('ai-ml');
    const all = discoveryQueriesFor(ai);
    expect(all[0]).toBe('machine learning tutorial');
    expect(all).toContain('LLMs & Transformers machine learning');
    const topic = ai.topics.find((t) => t.id === 'llms')!;
    const forTopic = discoveryQueriesFor(ai, topic);
    // The topic, then its first lesson ("What is …" opens the topic page), then the explainers.
    expect(forTopic.slice(0, 3)).toEqual(['LLMs & Transformers machine learning', 'LLMs & Transformers introduction machine learning', 'LLMs & Transformers explained']);
    expect(all[1]).toBe('machine learning syllabus and how to start');
    // Then one search per subtopic, so a topic page keeps loading past the first result pages.
    const sub = topic.keywords.find((k) => !k.startsWith('~') && k !== topic.name.toLowerCase())!;
    expect(forTopic.some((q) => q.startsWith(sub))).toBe(true);
    expect(forTopic.length).toBeGreaterThan(4);
  });
});

describe('feed views (what YouTube pages render)', () => {
  const fx = JSON.parse(readFileSync(new URL('./relevance/__fixtures__/real-channels.json', import.meta.url), 'utf8')) as { channels: { id: string; handle: string; title: string; videos: { id: string; title: string; description: string; publishedAt: number }[] }[] };
  const channels: Record<string, Channel> = {};
  const videos: Record<string, VideoRecord> = {};
  for (const ch of fx.channels) {
    channels[ch.id] = { id: ch.id, title: ch.title, handle: ch.handle, source: ch.handle === '@abdul_bari' ? 'manual' : 'youtube-session', addedAt: 0, lastFetchedAt: 0, lastError: null, ignored: false };
    for (const v of ch.videos) videos[v.id] = { ...v, channelId: ch.id, channelTitle: ch.title, thumbnail: '', views: null };
  }

  it('is compact, relevance-ranked and labels the source', () => {
    const view = buildFeedView(mode('dsa'), videos, channels);
    expect(view.items.length).toBeGreaterThan(10);
    expect(view.items.length).toBeLessThanOrEqual(160);
    expect(view.items.every((v, i) => i === 0 || v.relevance <= view.items[i - 1].relevance + 0.1)).toBe(true);
    expect(view.items.some((v) => v.source === 'added')).toBe(true);
    expect(JSON.stringify(view).length).toBeLessThan(60_000);
    expect(topicItems(view, 'stacks-queues').length).toBeGreaterThan(3);
    expect(topicItems(view, 'stacks-queues').every((v) => (v.topicScores['stacks-queues'] ?? 0) >= 0.5)).toBe(true);
  });

  it('searches within the space', () => {
    const view = buildFeedView(mode('dsa'), videos, channels);
    const hits = searchFeedView(view, mode('dsa'), 'next greater element');
    expect(hits[0].title).toContain('Next Greater Element');
  });
});
