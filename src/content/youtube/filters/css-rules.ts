import { COMMENTS_HIDE, END_SCREEN_HIDE, EXPLORE_HIDE, HOME_FEED_HIDE, NOTIFICATIONS_HIDE, RELATED_HIDE, SHORTS_HIDE } from '../selectors';

/**
 * Distraction filtering is CSS-first: one stylesheet is injected at
 * document_start and every rule is gated by a data attribute on <html>.
 * Toggling a setting flips an attribute — instant, no DOM rewriting, and
 * nothing touches the video player itself.
 */

export type FilterFlag = 'pending' | 'shorts' | 'home' | 'related-hide' | 'endscreens' | 'explore' | 'comments' | 'notifications' | 'search-dim' | 'search-focus';

export const attrName = (flag: FilterFlag) => `data-fs-${flag}`;

const HIDE = 'display: none !important;';

function hideRules(flag: FilterFlag, selectors: string[]): string[] {
  return selectors.map((s) => `html[${attrName(flag)}] ${s} { ${HIDE} }`);
}

export function buildStylesheet(): string {
  return [
    // Before settings load, hold back the home feed so it doesn't flash.
    ...hideRules('pending', HOME_FEED_HIDE),
    ...hideRules('shorts', SHORTS_HIDE),
    `html[${attrName('shorts')}] [data-fs-shorts-chip] { ${HIDE} }`,
    ...hideRules('home', HOME_FEED_HIDE),
    `ytd-browse:not([page-subtype="home"]) > focusspace-slot[data-slot="home"] { ${HIDE} }`,
    `html:not([${attrName('home')}]) focusspace-slot[data-slot="home"] { ${HIDE} }`,
    ...hideRules('related-hide', RELATED_HIDE),
    ...hideRules('endscreens', END_SCREEN_HIDE),
    ...hideRules('explore', EXPLORE_HIDE),
    ...hideRules('comments', COMMENTS_HIDE),
    ...hideRules('notifications', NOTIFICATIONS_HIDE),
    `html[${attrName('search-dim')}] ytd-search [data-fs-rel="off"] { opacity: 0.35; filter: saturate(0.4); transition: opacity 160ms ease, filter 160ms ease; }`,
    `html[${attrName('search-dim')}] ytd-search [data-fs-rel="off"]:hover { opacity: 1; filter: none; }`,
    `html[${attrName('search-focus')}] ytd-search [data-fs-rel="off"] { ${HIDE} }`,
    `html[${attrName('search-focus')}] ytd-search [data-fs-rel="weak"] { opacity: 0.6; transition: opacity 160ms ease; }`,
    `html[${attrName('search-focus')}] ytd-search [data-fs-rel="weak"]:hover { opacity: 1; }`,
    // While FocusSpace has the player load captions on request, don't flash them on screen.
    `html[data-fs-captions-loading] #movie_player .ytp-caption-window-container { visibility: hidden !important; }`,
    `focusspace-slot { display: block; }`,
  ].join('\n');
}

export function injectStylesheet(): HTMLStyleElement {
  const existing = document.getElementById('focusspace-filters') as HTMLStyleElement | null;
  if (existing) return existing;
  const style = document.createElement('style');
  style.id = 'focusspace-filters';
  style.textContent = buildStylesheet();
  (document.head ?? document.documentElement).appendChild(style);
  return style;
}

export function setFlags(flags: Partial<Record<FilterFlag, boolean>>): void {
  const root = document.documentElement;
  for (const [flag, on] of Object.entries(flags) as [FilterFlag, boolean][]) {
    const name = attrName(flag);
    if (on) {
      if (!root.hasAttribute(name)) root.setAttribute(name, '');
    } else if (root.hasAttribute(name)) root.removeAttribute(name);
  }
}
