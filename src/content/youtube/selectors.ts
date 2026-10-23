/**
 * THE ONLY PLACE THAT KNOWS YOUTUBE'S DOM.
 *
 * Every selector is grouped by feature and listed with fallbacks for older and
 * newer YouTube layouts (e.g. BEM `yt-lockup-metadata-view-model__title` and
 * the 2025+ camelCase `ytLockupMetadataViewModelTitle`). Each CSS selector is
 * emitted as its own rule, so an unsupported one never disables the others.
 * Verified against youtube.com on 2026-09-13 (see scripts/e2e).
 */

export const SHORTS_HIDE = [
  'ytd-reel-shelf-renderer',
  'ytd-rich-shelf-renderer[is-shorts]',
  'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
  'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
  'grid-shelf-view-model:has(ytm-shorts-lockup-view-model-v2)',
  'ytd-rich-section-renderer:has(grid-shelf-view-model ytm-shorts-lockup-view-model-v2)',
  'ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model-v2)',
  'ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)',
  'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
  'ytd-video-renderer:has(a#thumbnail[href^="/shorts/"])',
  'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
  'yt-lockup-view-model:has(a[href^="/shorts/"])',
  'ytd-guide-entry-renderer:has(a[title="Shorts"])',
  'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
  'yt-tab-shape[tab-title="Shorts"]',
];

/** Home feed ("Recommended for you"), replaced by the FocusSpace home. */
export const HOME_FEED_HIDE = ['ytd-browse[page-subtype="home"] > ytd-two-column-browse-results-renderer'];
export const HOME_MOUNT_PARENT = 'ytd-browse[page-subtype="home"]';

/** Trending / Explore / "More from YouTube" discovery surfaces. */
export const EXPLORE_HIDE = [
  'ytd-guide-section-renderer:has(a[href^="/feed/trending"])',
  'ytd-guide-section-renderer:has(a[href^="/feed/explore"])',
  'ytd-guide-section-renderer:has(a[href^="/feed/storefront"])',
  'ytd-guide-section-renderer:has(a[href^="/gaming"])',
  'ytd-guide-section-renderer:has(a[href^="/premium"])',
  'ytd-guide-section-renderer:has(a[href^="https://music.youtube.com"])',
  'ytd-guide-entry-renderer:has(a[href^="/feed/trending"])',
  'ytd-guide-entry-renderer:has(a[href^="/feed/explore"])',
  'ytd-mini-guide-entry-renderer:has(a[href^="/feed/explore"])',
  'ytd-mini-guide-entry-renderer:has(a[href^="/feed/trending"])',
  'ytd-merch-shelf-renderer',
];

export const WATCH = {
  flexy: 'ytd-watch-flexy',
  secondaryInner: 'ytd-watch-flexy #secondary-inner',
  related: 'ytd-watch-flexy #related',
  below: 'ytd-watch-flexy #below',
  title: 'ytd-watch-metadata h1',
  description: ['ytd-watch-metadata #description-inner', 'ytd-watch-metadata ytd-text-inline-expander', 'ytd-watch-metadata #description'],
  ownerLink: ['ytd-watch-metadata #owner ytd-channel-name a', 'ytd-watch-metadata #owner a[href^="/@"]', 'ytd-video-owner-renderer a[href^="/@"]'],
  video: ['#movie_player video', 'ytd-watch-flexy video'],
  /** While an ad plays, the <video> element reports the ad's time and duration. */
  adShowing: '#movie_player.ad-showing, #movie_player.ad-interrupting',
};

export const RELATED_HIDE = ['ytd-watch-flexy #related'];

/** Where FocusSpace UI mounts. */
export const SEARCH = { primary: 'ytd-search #primary', sectionList: ':scope > ytd-section-list-renderer' };
export const GUIDE = { sections: 'ytd-guide-renderer #sections', section: ':scope > ytd-guide-section-renderer' };
/** Elements whose constant DOM churn (player clock, live chat, comments) never affects FocusSpace. */
export const MUTATION_NOISE = '#movie_player, focusspace-slot, ytd-comments, #chat-container, ytd-live-chat-frame, tp-yt-paper-tooltip, yt-img-shadow';
export const COMMENTS_HIDE = ['ytd-watch-flexy ytd-comments#comments', 'ytd-watch-flexy #comments'];
export const END_SCREEN_HIDE = ['#movie_player .ytp-ce-element', '#movie_player .ytp-endscreen-content', '#movie_player .ytp-pause-overlay'];
export const NOTIFICATIONS_HIDE = ['ytd-notification-topbar-button-renderer', 'ytd-masthead #notification-button'];

export const SHORTS_PAGE_VIDEO = 'ytd-shorts video';

/** Video items that get relevance-marked (data-fs-rel) on the watch and search pages. */
export const ITEMS = {
  search: ['ytd-search ytd-video-renderer', 'ytd-search yt-lockup-view-model'],
  title: ['h3[title]', 'a#video-title', '#video-title', '.ytLockupMetadataViewModelTitle', '.yt-lockup-metadata-view-model__title'],
  channel: [
    'ytd-channel-name a',
    'ytd-channel-name #text',
    '.ytContentMetadataViewModelMetadataText',
    '.yt-content-metadata-view-model__metadata-text',
  ],
  link: 'a[href*="/watch?v="]',
};

/** Filter chips (search page) whose label reveals Shorts. Matched by text in JS. */
export const CHIP = { selector: 'yt-chip-cloud-chip-renderer', shortsLabel: /^shorts$/i };

/** The fixed top bar's container; its bottom edge is where FocusSpace's Space bar pins (falls back to 56 px). */
export const MASTHEAD_CONTAINER = '#masthead-container, ytd-masthead';

export const MASTHEAD_LOGO_LINK = 'ytd-topbar-logo-renderer a#logo';

/**
 * The home page's own category chip row ("All · News · Podcasts · Music…"),
 * verified on youtube.com 2026-09-16: `ytd-feed-filter-chip-bar-renderer` >
 * `#chips`, a child of the rich grid's own `#header` — inside the same
 * subtree `HOME_FEED_HIDE` hides when FocusSpace replaces the home feed, so
 * it's only usable while the native grid is showing (checked via
 * `getClientRects()`, not assumed from the selector alone).
 */
export const HOME_CHIPS = { bar: 'ytd-feed-filter-chip-bar-renderer', chips: ':scope #chips', chip: 'yt-chip-cloud-chip-renderer' };

/**
 * The masthead's own right-side button cluster (Create · notifications ·
 * account) — present on every page type (home, watch, search, browse),
 * completely untouched by any FocusSpace filter, so it's the universal
 * fallback anchor for the persistent AI entry when the home chip row isn't
 * showing.
 */
export const MASTHEAD_BUTTONS = 'ytd-masthead#masthead #end #buttons';

export function queryFirst<T extends Element = HTMLElement>(selectors: string | string[], root: ParentNode = document): T | null {
  for (const selector of Array.isArray(selectors) ? selectors : [selectors]) {
    try {
      const el = root.querySelector<T>(selector);
      if (el) return el;
    } catch {
      /* unsupported selector in this browser: try the next one */
    }
  }
  return null;
}

export function queryAll<T extends Element = HTMLElement>(selectors: string[], root: ParentNode = document): T[] {
  const out = new Set<T>();
  for (const selector of selectors) {
    try {
      root.querySelectorAll<T>(selector).forEach((el) => out.add(el));
    } catch {
      /* ignore */
    }
  }
  return [...out];
}
