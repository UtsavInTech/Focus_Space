import { describe, expect, it } from 'vitest';
import type { FeedVideo } from '../feed-view';
import { buildHomepageContext, isHomepageContext } from './homepage-context';

const NOW = Date.parse('2026-09-15T00:00:00Z');

function video(over: Partial<FeedVideo> = {}): FeedVideo {
  return {
    id: 'v1',
    title: 'Binary Search Explained',
    channelId: 'UC1',
    channelTitle: 'Apna College',
    thumbnail: '',
    publishedAt: NOW - 3 * 86_400_000,
    views: 12_000,
    durationSec: 620,
    relevance: 0.9,
    tier: 'excellent',
    topicId: 'algorithms',
    topicScores: {},
    matched: ['binary search'],
    difficulty: null,
    learning: 0.8,
    source: 'subscription',
    ...over,
  };
}

describe('buildHomepageContext: a compact, structured, non-fabricated summary of what is actually available', () => {
  it('maps feed videos to HomepageVideo without inventing fields', () => {
    const ctx = buildHomepageContext({
      pageType: 'home',
      spaceName: 'DSA',
      activeCategory: null,
      topicNames: ['Arrays', 'Trees'],
      feedVideos: [video()],
      subscriptions: [],
      language: 'en',
      now: NOW,
    });
    expect(ctx.visibleVideos).toEqual([
      { videoId: 'v1', title: 'Binary Search Explained', channelTitle: 'Apna College', durationSec: 620, views: 12_000, publishedText: '3d ago', position: 1, reason: 'Excellent match' },
    ]);
  });

  it('caps the video list rather than dumping the whole feed', () => {
    const ctx = buildHomepageContext({
      pageType: 'home',
      spaceName: 'DSA',
      activeCategory: null,
      topicNames: [],
      feedVideos: Array.from({ length: 40 }, (_, i) => video({ id: `v${i}`, title: `Video ${i}` })),
      subscriptions: [],
      language: 'en',
      now: NOW,
    });
    expect(ctx.visibleVideos.length).toBeLessThanOrEqual(12);
    expect(ctx.visibleVideos[0].videoId).toBe('v0'); // ranking order preserved, not reshuffled
  });

  it('caps and maps subscriptions honestly — empty when none are known, never invented', () => {
    const empty = buildHomepageContext({ pageType: 'home', spaceName: 'DSA', activeCategory: null, topicNames: [], feedVideos: [], subscriptions: [], language: 'en', now: NOW });
    expect(empty.visibleSubscriptions).toEqual([]);

    const withSubs = buildHomepageContext({
      pageType: 'home',
      spaceName: 'DSA',
      activeCategory: null,
      topicNames: [],
      feedVideos: [],
      subscriptions: Array.from({ length: 20 }, (_, i) => ({ id: `UC${i}`, title: `Channel ${i}` })),
      language: 'en',
      now: NOW,
    });
    expect(withSubs.visibleSubscriptions).toHaveLength(10);
    expect(withSubs.visibleSubscriptions[0]).toEqual({ channelId: 'UC0', channelTitle: 'Channel 0' });
  });

  it('merges the space\'s own topics with native chip labels, deduplicated', () => {
    const ctx = buildHomepageContext({
      pageType: 'home',
      spaceName: 'DSA',
      activeCategory: 'Trees',
      topicNames: ['Arrays', 'Trees'],
      nativeCategoryChips: ['All', 'Trees', 'Music'],
      feedVideos: [],
      subscriptions: [],
      language: 'en',
      now: NOW,
    });
    expect(ctx.categoryChips).toEqual(['Arrays', 'Trees', 'All', 'Music']);
    expect(ctx.activeCategory).toBe('Trees');
  });

  it('carries the actual page type and space name through unchanged', () => {
    const ctx = buildHomepageContext({ pageType: 'search', spaceName: 'AI / ML', activeCategory: null, topicNames: [], feedVideos: [], subscriptions: [], language: 'hi', now: NOW });
    expect(ctx.pageType).toBe('search');
    expect(ctx.spaceName).toBe('AI / ML');
    expect(ctx.language).toBe('hi');
  });
});

describe('isHomepageContext: discriminates cleanly from LearningContext', () => {
  it('is true for a HomepageContext', () => {
    const ctx = buildHomepageContext({ pageType: 'home', spaceName: 'DSA', activeCategory: null, topicNames: [], feedVideos: [], subscriptions: [], language: 'en' });
    expect(isHomepageContext(ctx)).toBe(true);
  });

  it('is false for a LearningContext-shaped object (no visibleVideos/pageType fields)', () => {
    const learningLike = { version: 2, videoId: 'v1', videoTitle: 'x', channel: 'y', currentTime: 10 };
    expect(isHomepageContext(learningLike)).toBe(false);
  });

  it('is false for null/undefined/primitives', () => {
    expect(isHomepageContext(null)).toBe(false);
    expect(isHomepageContext(undefined)).toBe(false);
    expect(isHomepageContext('home')).toBe(false);
  });
});
