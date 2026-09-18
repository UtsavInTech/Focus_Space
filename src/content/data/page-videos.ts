import type { VisibleVideo } from './visible-feed';

/**
 * The videos YouTube itself is showing, read from the page.
 *
 * This is the fallback for when FocusSpace has nothing of its own to describe:
 * Focus Mode is off, or the learner is on a page FocusSpace does not rebuild.
 * Without it the assistant answers "there are no videos here" while the screen
 * is full of them, which is both wrong and the single worst first impression
 * the product can make.
 *
 * Deliberately narrow. It reads the title, channel and href that are already
 * rendered as text — the same things a person sees — and nothing else. It is
 * not a scrape of arbitrary page content, it never runs unless the assistant
 * is actually opened, and it stops at a small cap.
 */

const CARD_SELECTORS = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'yt-lockup-view-model',
].join(', ');

const TITLE_SELECTORS = ['#video-title', 'a#video-title-link', 'h3 a', '.yt-lockup-metadata-view-model__title'].join(', ');
const CHANNEL_SELECTORS = ['ytd-channel-name #text', '#channel-name #text', '.yt-content-metadata-view-model__metadata-text'].join(', ');

const MAX_CARDS = 12;

const videoIdFrom = (href: string | null): string | null => {
  if (!href) return null;
  const match = /[?&]v=([\w-]{11})/.exec(href);
  return match ? match[1] : null;
};

const text = (root: Element, selector: string): string => (root.querySelector(selector)?.textContent ?? '').trim();

/**
 * `origin: 'discovery'` because that is what these honestly are from
 * FocusSpace's point of view — videos it did not rank and cannot vouch for.
 * The tier is `none`, so the assistant is never told a match quality that was
 * never computed.
 */
export function readVisibleYouTubeVideos(): VisibleVideo[] {
  const out: VisibleVideo[] = [];
  const seen = new Set<string>();

  for (const card of document.querySelectorAll(CARD_SELECTORS)) {
    if (out.length >= MAX_CARDS) break;
    // Off-screen and collapsed cards are not "visible" in any sense the learner would agree with.
    if (!card.getClientRects().length) continue;

    const link = card.querySelector<HTMLAnchorElement>('a[href*="/watch?v="]');
    const id = videoIdFrom(link?.getAttribute('href') ?? null);
    if (!id || seen.has(id)) continue;

    const title = text(card, TITLE_SELECTORS) || (link?.getAttribute('title') ?? '').trim();
    if (!title) continue;

    seen.add(id);
    out.push({
      id,
      title,
      channelId: '',
      channelTitle: text(card, CHANNEL_SELECTORS),
      thumbnail: '',
      publishedAt: 0,
      views: null,
      durationSec: null,
      relevance: 0,
      tier: 'none',
      topicId: null,
      topicScores: {},
      matched: [],
      difficulty: null,
      learning: 0,
      source: 'subscription',
      origin: 'discovery',
    });
  }

  return out;
}
