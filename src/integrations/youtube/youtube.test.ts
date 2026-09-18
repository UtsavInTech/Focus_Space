import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectPage, parseChannelInput } from './urls';
import { decodeXml, longFormFeedUrl, looksLikeShort, parseFeed } from './rss';
import { collectChannels, extractJsonObject, extractYtConfig } from './innertube';
import { parseChannelPage } from './channel-resolve';

describe('detectPage', () => {
  it.each([
    ['https://www.youtube.com/', 'home'],
    ['https://www.youtube.com/watch?v=0BhhiQGDbEA&t=10', 'watch'],
    ['https://www.youtube.com/results?search_query=dp', 'search'],
    ['https://www.youtube.com/shorts/YHQWuLG78Hw', 'shorts'],
    ['https://www.youtube.com/@freecodecamp/videos', 'channel'],
    ['https://www.youtube.com/channel/UC8butISFwT-Wl7EV0hUK0BQ', 'channel'],
    ['https://www.youtube.com/feed/subscriptions', 'subscriptions'],
    ['https://www.youtube.com/feed/trending', 'explore'],
    ['https://www.youtube.com/gaming', 'explore'],
    ['https://www.youtube.com/feed/history', 'library'],
    ['https://www.youtube.com/playlist?list=PL1', 'playlist'],
  ])('%s → %s', (url, type) => {
    expect(detectPage(url).type).toBe(type);
  });

  it('extracts ids and queries', () => {
    expect(detectPage('https://www.youtube.com/watch?v=abc').videoId).toBe('abc');
    expect(detectPage('https://www.youtube.com/shorts/xyz').videoId).toBe('xyz');
    expect(detectPage('https://www.youtube.com/results?search_query=graphs+bfs').query).toBe('graphs bfs');
    expect(detectPage('https://www.youtube.com/@freecodecamp/videos').channelKey).toBe('/@freecodecamp');
  });
});

describe('parseChannelInput', () => {
  it('understands every common form', () => {
    expect(parseChannelInput('UC8butISFwT-Wl7EV0hUK0BQ')).toEqual({ kind: 'id', id: 'UC8butISFwT-Wl7EV0hUK0BQ' });
    expect(parseChannelInput('@freecodecamp')).toEqual({ kind: 'handle', handle: '@freecodecamp' });
    expect(parseChannelInput('https://www.youtube.com/@freecodecamp/videos')).toEqual({ kind: 'handle', handle: '@freecodecamp' });
    expect(parseChannelInput('youtube.com/channel/UC8butISFwT-Wl7EV0hUK0BQ')).toEqual({ kind: 'id', id: 'UC8butISFwT-Wl7EV0hUK0BQ' });
    expect(parseChannelInput('https://youtube.com/c/Something')).toEqual({ kind: 'path', path: '/c/Something' });
    expect(parseChannelInput('https://example.com/@nope')).toBeNull();
    expect(parseChannelInput('just words')).toBeNull();
  });
});

describe('rss', () => {
  const xml = readFileSync(new URL('./__fixtures__/feed.xml', import.meta.url), 'utf8');

  it('parses a real YouTube uploads feed', () => {
    const feed = parseFeed(xml, 'UC8butISFwT-Wl7EV0hUK0BQ');
    expect(feed.videos.length).toBeGreaterThan(0);
    expect(feed.channelTitle.length).toBeGreaterThan(0);
    for (const v of feed.videos) {
      expect(v.id).toMatch(/^[\w-]{11}$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.channelId).toBe('UC8butISFwT-Wl7EV0hUK0BQ');
      expect(v.thumbnail).toMatch(/^https:\/\/i\d?\.ytimg\.com\//);
      expect(Number.isFinite(v.publishedAt)).toBe(true);
      expect(v.title).not.toMatch(/&amp;|&quot;|&#39;/);
    }
  });

  it('builds the long-form playlist feed url and decodes entities', () => {
    expect(longFormFeedUrl('UC8butISFwT-Wl7EV0hUK0BQ')).toContain('playlist_id=UULF8butISFwT-Wl7EV0hUK0BQ');
    expect(decodeXml('BFS &amp; DFS &#39;fast&#39; &#x2014;')).toBe("BFS & DFS 'fast' —");
    expect(looksLikeShort({ title: 'Quick tip #shorts', description: '' })).toBe(true);
    expect(looksLikeShort({ title: 'Shortest path algorithms', description: '' })).toBe(false);
  });
});

describe('innertube session parsing', () => {
  it('extracts JSON objects with braces inside strings', () => {
    const html = `<script>var ytInitialData = {"a":"}{\\"","b":{"c":[1,2,{"d":"x"}]}};</script>`;
    expect(extractJsonObject(html, /var\s+ytInitialData\s*=/)).toEqual({ a: '}{"', b: { c: [1, 2, { d: 'x' }] } });
    expect(extractJsonObject('nothing here', 'ytInitialData')).toBeNull();
  });

  it('merges multiple ytcfg.set calls', () => {
    const html = `ytcfg.set({"INNERTUBE_API_KEY":"k","LOGGED_IN":true}); x; ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.2026"});`;
    expect(extractYtConfig(html)).toEqual({ INNERTUBE_API_KEY: 'k', LOGGED_IN: true, INNERTUBE_CLIENT_VERSION: '2.2026' });
  });

  it('collects channels and continuation tokens from a nested response', () => {
    const data = {
      contents: {
        sections: [
          {
            items: [
              {
                channelRenderer: {
                  channelId: 'UC8butISFwT-Wl7EV0hUK0BQ',
                  title: { simpleText: 'freeCodeCamp.org' },
                  thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/small' }, { url: '//yt3.ggpht.com/large' }] },
                  navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@freecodecamp' } },
                },
              },
              { channelRenderer: { channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: { runs: [{ text: 'Google ' }, { text: 'Developers' }] }, subscriberCountText: { simpleText: '@GoogleDevelopers' } } },
              { channelRenderer: { channelId: 'not-a-channel', title: { simpleText: 'x' } } },
            ],
          },
          { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'NEXT' } } } },
        ],
      },
    };
    const { channels, continuations } = collectChannels(data);
    expect(continuations).toEqual(['NEXT']);
    expect(channels).toHaveLength(2);
    expect(channels).toContainEqual({ id: 'UC8butISFwT-Wl7EV0hUK0BQ', title: 'freeCodeCamp.org', handle: '@freecodecamp', thumbnail: 'https://yt3.ggpht.com/large' });
    expect(channels).toContainEqual({ id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Google Developers', handle: '@GoogleDevelopers', thumbnail: undefined });
  });
});

describe('channel page resolution', () => {
  it('reads canonical id, title and avatar', () => {
    const html = `<link rel="canonical" href="https://www.youtube.com/channel/UC8butISFwT-Wl7EV0hUK0BQ"><meta property="og:title" content="freeCodeCamp.org &amp; friends"><meta property="og:image" content="https://yt3.googleusercontent.com/a=s900">`;
    expect(parseChannelPage(html)).toEqual({ id: 'UC8butISFwT-Wl7EV0hUK0BQ', title: 'freeCodeCamp.org & friends', thumbnail: 'https://yt3.googleusercontent.com/a=s900' });
    expect(parseChannelPage('<html></html>')).toBeNull();
  });
});
