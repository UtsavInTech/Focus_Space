import type { FilterFlag } from './filters/css-rules';
import { GUIDE, HOME_MOUNT_PARENT, ITEMS, MASTHEAD_BUTTONS, MASTHEAD_CONTAINER, SEARCH, WATCH } from './selectors';

/**
 * YouTube-layout health: does the page still have what FocusSpace hangs on?
 *
 * YouTube renames elements and ships new layouts without notice. Everything FocusSpace touches is
 * listed in selectors.ts with fallbacks, but a fallback can run out. When it does, three things must
 * hold, and this file is how:
 *
 *   1. YouTube keeps working. A feature whose anchor is gone *fails open*: the CSS that hides YouTube's
 *      own version (its home feed, its related videos) is switched off for the session, so the learner
 *      never faces a blank page because FocusSpace could not mount its replacement.
 *   2. The learner is told plainly, once, and Settings shows which features are paused.
 *   3. The people who build FocusSpace find out: the feature names (nothing else) ride on the daily
 *      anonymous usage ping when that is on, and the same anchors are checked daily against live
 *      youtube.com by scripts/youtube-canary.ts in CI.
 *
 * Checks run a few seconds after a page settles, never on the playback path.
 */

export type LayoutFeature = 'masthead' | 'home' | 'watch-rail' | 'player' | 'search' | 'search-marks' | 'sidebar';

export const LAYOUT_FEATURES: Record<LayoutFeature, { label: string; effect: string }> = {
  masthead: { label: 'Top bar', effect: 'The AI button and the pinned Space bar may sit in the wrong place.' },
  home: { label: 'FocusSpace home', effect: 'YouTube’s normal home is shown instead.' },
  'watch-rail': { label: 'Suggestions beside the video', effect: 'YouTube’s own related videos are shown instead.' },
  player: { label: 'Video player', effect: 'Progress, notes timestamps and “You’re learning” may not follow the video.' },
  search: { label: 'Search results', effect: 'Search results are shown as YouTube orders them.' },
  'search-marks': { label: 'Search relevance marks', effect: 'Search results are not dimmed or filtered.' },
  sidebar: { label: 'Sidebar Spaces', effect: 'Your Spaces are not listed in YouTube’s left sidebar.' },
};

/** Window event a crashed surface fires (detail: a FilterFlag) to get YouTube's own version back. */
export const FAIL_OPEN_EVENT = 'focusspace:fail-open';

/** Which filter to switch off when a feature's anchor is gone, so YouTube's own version shows. */
export const FAIL_OPEN: Partial<Record<LayoutFeature, FilterFlag[]>> = {
  home: ['home'],
  'watch-rail': ['related-hide'],
  'search-marks': ['search-focus', 'search-dim'],
};

/**
 * The anchors themselves, per page. Shared with the CI canary, which loads real youtube.com (signed out,
 * no extension) and fails the run when one is missing, so a YouTube change is noticed within a day.
 */
export const CRITICAL_ANCHORS: { feature: LayoutFeature; page: 'any' | 'home' | 'watch' | 'search'; selectors: string[] }[] = [
  { feature: 'masthead', page: 'any', selectors: [MASTHEAD_CONTAINER] },
  { feature: 'masthead', page: 'any', selectors: [MASTHEAD_BUTTONS] },
  { feature: 'home', page: 'home', selectors: [HOME_MOUNT_PARENT] },
  { feature: 'watch-rail', page: 'watch', selectors: [WATCH.secondaryInner, WATCH.below] },
  { feature: 'player', page: 'watch', selectors: WATCH.video },
  { feature: 'search', page: 'search', selectors: [SEARCH.primary] },
  { feature: 'search-marks', page: 'search', selectors: ITEMS.search },
];

export interface LayoutContext {
  page: 'home' | 'watch' | 'search' | 'other';
  /** FocusSpace is replacing YouTube's home right now. */
  homeReplaced: boolean;
  /** FocusSpace is active on this page (a Space, Focus Mode on). */
  active: boolean;
  /** Whether each FocusSpace surface actually mounted and is on screen. */
  mounted: { home: boolean; watch: boolean; search: boolean };
  /** FocusSpace is filtering search results. */
  searchFiltered: boolean;
}

const exists = (doc: ParentNode, selectors: string[]) =>
  selectors.some((s) => {
    try {
      return !!doc.querySelector(s);
    } catch {
      return false;
    }
  });

/** The features that are broken on this page right now. Pure: give it any document. */
export function checkLayout(doc: ParentNode, ctx: LayoutContext): LayoutFeature[] {
  const broken = new Set<LayoutFeature>();
  for (const anchor of CRITICAL_ANCHORS) {
    if (anchor.page !== 'any' && anchor.page !== ctx.page) continue;
    if (anchor.feature === 'home' && !ctx.homeReplaced) continue;
    if ((anchor.feature === 'watch-rail' || anchor.feature === 'player' || anchor.feature.startsWith('search')) && !ctx.active) continue;
    if (anchor.feature === 'search-marks' && (!ctx.searchFiltered || !exists(doc, ['ytd-search ytd-item-section-renderer #contents > *']))) continue;
    if (!exists(doc, anchor.selectors)) broken.add(anchor.feature);
  }
  // The anchor is there but FocusSpace's own surface still didn't mount: as broken for the learner.
  if (ctx.page === 'home' && ctx.homeReplaced && !ctx.mounted.home) broken.add('home');
  if (ctx.page === 'watch' && ctx.active && exists(doc, [WATCH.flexy]) && !ctx.mounted.watch) broken.add('watch-rail');
  // The sidebar only counts once YouTube has built it (it is lazy until opened).
  if (ctx.active && exists(doc, ['ytd-guide-renderer']) && !exists(doc, [GUIDE.sections])) broken.add('sidebar');
  return [...broken];
}

export interface LayoutHealth {
  issues: { feature: LayoutFeature; firstSeen: number; lastSeen: number; count: number }[];
}

/** Adds what was found now; keeps one row per feature and forgets rows not seen for a week. */
export function recordIssues(health: LayoutHealth, found: LayoutFeature[], now = Date.now()): LayoutHealth {
  const week = 7 * 86_400_000;
  const rows = health.issues.filter((r) => now - r.lastSeen < week);
  for (const feature of found) {
    const row = rows.find((r) => r.feature === feature);
    if (row) Object.assign(row, { lastSeen: now, count: row.count + 1 });
    else rows.push({ feature, firstSeen: now, lastSeen: now, count: 1 });
  }
  return { issues: rows };
}

/** Features seen broken in the last day — what the daily ping reports. */
export const recentIssues = (health: LayoutHealth, now = Date.now()) => health.issues.filter((r) => now - r.lastSeen < 86_400_000).map((r) => r.feature);
