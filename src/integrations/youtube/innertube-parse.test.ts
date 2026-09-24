import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseChannels, parseContinuation, parseCount, parseDuration, parseRelativeTime, parseVideos, parseWatchNext } from './innertube-parse';

/** Fixtures are trimmed real responses captured from youtube.com on 2026-09-13. */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/innertube/${name}.json`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-09-13T00:00:00Z');

describe('value parsers', () => {
  it('parses counts, durations and relative times', () => {
    expect(parseCount('149,544 views')).toBe(149544);
    expect(parseCount('1.7M')).toBe(1_700_000);
    expect(parseCount('380K views')).toBe(380_000);
    expect(parseCount('No views')).toBeNull();
    expect(parseDuration('57:18')).toBe(3438);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('LIVE')).toBeNull();
    expect(parseRelativeTime('3 years ago', NOW)).toBe(NOW - 3 * 365 * 86_400_000);
    expect(parseRelativeTime('16h ago', NOW)).toBe(NOW - 16 * 3_600_000);
    expect(parseRelativeTime('3mo ago', NOW)).toBe(NOW - 90 * 86_400_000);
    expect(parseRelativeTime('Streamed 5 hours ago', NOW)).toBe(NOW - 5 * 3_600_000);
    expect(parseRelativeTime('Premiere', NOW)).toBeNull();
  });
});

describe('channel uploads (lockup view models)', () => {
  const json = fixture('uploads');
  const videos = parseVideos(json, NOW);

  it('reads every upload with channel, duration, index and date', () => {
    expect(videos.length).toBeGreaterThanOrEqual(10);
    for (const v of videos) {
      expect(v.id).toMatch(/^[\w-]{11}$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.channelId).toBe('UCJskGeByzRRSvmOyZOz61ig');
      expect(v.durationSec).toBeGreaterThan(0);
      expect(v.publishedAt).not.toBeNull();
      expect(v.isShort).toBe(false);
      expect(v.playlistId).toBe('UULFJskGeByzRRSvmOyZOz61ig');
    }
    expect(videos.map((v) => v.index)).toEqual(videos.map((_, i) => i + 1));
  });

  it('finds the next-page continuation', () => {
    expect(parseContinuation(json)).toMatch(/^[\w-%=]{20,}$/);
  });
});

describe('search results', () => {
  const videos = parseVideos(fixture('search'), NOW);

  it('reads classic video renderers and skips the Shorts shelf', () => {
    expect(videos.length).toBeGreaterThanOrEqual(8);
    expect(videos.every((v) => !v.isShort)).toBe(true);
    expect(videos.every((v) => /^UC[\w-]{22}$/.test(v.channelId ?? ''))).toBe(true);
    expect(videos.filter((v) => (v.views ?? 0) > 0).length).toBeGreaterThan(5);
  });

  it('does not mistake key-moment highlights for watch progress', () => {
    expect(videos.every((v) => v.watchedPercent === null)).toBe(true);
  });
});

describe('channel search', () => {
  it('returns real channels with handles and subscriber text', () => {
    const channels = parseChannels(fixture('channels'));
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.some((c) => /karan/i.test(c.title))).toBe(true);
    for (const c of channels) {
      expect(c.id).toMatch(/^UC[\w-]{22}$/);
      expect(c.thumbnail === null || c.thumbnail.startsWith('https://')).toBe(true);
    }
    expect(channels.some((c) => /subscriber/i.test(c.subscribersText))).toBe(true);
  });

  /** The ranking signals (learning/relevance/channel-ranking.ts) are only as good as what is parsed here. */
  it('reads the ranking signals: subscriber count, description snippet and verified badge', () => {
    const channels = parseChannels(fixture('channels'));
    const karan = channels.find((c) => /karan/i.test(c.title))!;
    expect(karan.subscribers).toBe(5_850_000);
    expect(karan.description).toContain('Official YouTube Channel');
    expect(karan.verified).toBe(true);
    // Every channel parses to the full shape, whether or not YouTube reported each field.
    for (const c of channels) {
      expect(c.subscribers === null || c.subscribers > 0).toBe(true);
      expect(typeof c.description).toBe('string');
      expect(typeof c.verified).toBe('boolean');
    }
  });
});

describe('watch next', () => {
  it('reads the video, owner, playlist and related videos', () => {
    const next = parseWatchNext(fixture('nextPlaylist'), 'oBt53YbR9Kk', NOW);
    expect(next.title).toContain('Dynamic Programming');
    expect(next.channelId).toBe('UC8butISFwT-Wl7EV0hUK0BQ');
    expect(next.channelHandle).toBe('@freecodecamp');
    expect(next.playlist?.title).toBe('Time Complexity Analysis');
    expect(next.playlist?.total).toBe(4);
    expect(next.playlist?.videos.map((v) => v.index)).toEqual([1, 2, 3, 4]);
    expect(next.playlist?.videos[0].title).toBe('Time complexity of a computer program');
    expect(next.related.length).toBeGreaterThan(3);
    expect(next.related.some((v) => v.id === 'oBt53YbR9Kk')).toBe(false);
  });

  it('works without a playlist and keeps the description', () => {
    const next = parseWatchNext(fixture('next'), '0BhhiQGDbEA', NOW);
    expect(next.playlist).toBeNull();
    expect(next.channelId).toBe('UCJihyK0A38SZ6SdJirEdIOw');
    expect(next.description).toContain('Dynamic Programming');
    expect(next.related.every((v) => v.channelTitle.length > 0)).toBe(true);
  });
});

describe('playlist browse', () => {
  it('reads playlist items in order', () => {
    const videos = parseVideos(fixture('playlist'), NOW);
    expect(videos.length).toBeGreaterThanOrEqual(6);
    expect(videos[0].index).toBe(1);
    expect(videos.every((v, i) => i === 0 || (v.index ?? 0) > (videos[i - 1].index ?? 0))).toBe(true);
  });
});
