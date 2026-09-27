import { activeModeOf, effectiveFilters, needsFirstSpace } from '@/modes/service';
import { ALLOW_VIDEO_EVENT } from './allow-video';
import type { PageContext } from '@/integrations/youtube/urls';
import { getClassifier } from '@/ai/registry';
import { updateItem } from '@/storage/storage';
import { extensionAlive } from '@/messaging/runtime';
import type { WatchEntry } from '@/types/domain';
import type { ContentState, Store } from './store';
import type { Slot } from './ui/slots';
import { setFlags } from './youtube/filters/css-rules';
import { clearMarks, markSearchResults, markShortsChips, type MarkStats } from './youtube/filters/relevance-marker';
import { currentVideoElement, readVideoMetadata } from './youtube/metadata';
import { GUIDE, HOME_MOUNT_PARENT, MUTATION_NOISE, SEARCH, SHORTS_PAGE_VIDEO, WATCH } from './youtube/selectors';
import { spaNavigate } from './youtube/spa';
import { pageYouTube } from './data/youtube';

export interface Slots {
  overlay: Slot;
  home: Slot;
  watch: Slot;
  search: Slot;
  guide: Slot;
  aiEntry: Slot;
}

const PROGRESS_INTERVAL_MS = 5000;
const HISTORY_LIMIT = 300;

const sameStats = (a: MarkStats | null, b: MarkStats | null) => a === b || (!!a && !!b && a.total === b.total && a.off === b.off);

/**
 * Applies FocusSpace state to the live YouTube page: filter flags, UI slot
 * placement, search marks, watch-page data and progress. Everything that
 * touches YouTube's DOM goes through ./youtube.
 *
 * Performance rules: YouTube navigation is never blocked (watch data loads
 * after the player, cancellable); DOM mutations inside the player, comments,
 * chat and FocusSpace's own UI never trigger work; reconcile is throttled and
 * only touches what the current page needs.
 */
export function createController(store: Store<ContentState>, slots: Slots) {
  // A video FocusSpace AI was asked to play is the learner's explicit choice: no off-track nudge for it.
  window.addEventListener(ALLOW_VIDEO_EVENT, (event) => {
    const videoId = (event as CustomEvent<unknown>).detail;
    if (typeof videoId === 'string') store.set((s) => ({ dismissedNudges: [...s.dismissedNudges, videoId] }));
  });
  let reconcileTimer = 0;
  let progressTimer = 0;
  let redirectedShort: string | null = null;
  let holdCleanup: (() => void) | null = null;
  let watchAbort: AbortController | null = null;
  let lastSaved = { id: '', progress: 0, at: 0 };
  let homeScroll = 0;
  let navigatingAt = 0;
  let restoreTimer = 0;
  const observers: MutationObserver[] = [];

  const focus = () => {
    const s = store.get();
    const mode = activeModeOf(s.settings, s.modes);
    const active = s.ready && s.settings.focusEnabled && !!mode;
    const filters = effectiveFilters(s.settings, mode).filters;
    // FocusSpace's home replaces YouTube's when a Space is active — or when Focus Mode is on and there is
    // no Space yet, to show the picker. One definition for mounting it and for the CSS that reveals it.
    const showHome = (active && filters.replaceHomeFeed) || (s.ready && needsFirstSpace(s.settings, s.modes));
    return { s, mode, active, showHome, filters };
  };

  function apply() {
    const { s, active, showHome, filters: f } = focus();
    if (!s.ready) return;

    setFlags({
      shorts: active && f.hideShorts,
      home: showHome,
      'related-hide': active && f.relatedVideos !== 'show' && !s.showNativeRelated,
      endscreens: active && f.hideEndScreens,
      explore: active && f.hideExplore,
      comments: active && f.hideComments,
      notifications: active && f.hideNotifications,
      'search-dim': active && f.searchResults === 'dim' && !s.searchReveal,
      'search-focus': active && f.searchResults === 'focus' && !s.searchReveal,
    });

    // Shorts open as a normal video. replace() keeps "back" from bouncing into the Shorts feed.
    if (active && f.hideShorts && s.page.type === 'shorts' && s.page.videoId && redirectedShort !== s.page.videoId) {
      redirectedShort = s.page.videoId;
      document.querySelectorAll<HTMLVideoElement>(SHORTS_PAGE_VIDEO).forEach((v) => v.pause());
      location.replace(`/watch?v=${encodeURIComponent(s.page.videoId)}`);
      return;
    }

    if (!active) clearMarks();
    if (active && s.page.type === 'watch' && s.video && s.watch?.id !== s.video.id) void loadWatch(s.video.id);
    scheduleReconcile(0);
  }

  function onNavigate(ctx: PageContext, cause = '') {
    saveProgress(true);
    // Back/forward to home: put the feed back where the user left it (the feed stays mounted).
    if (ctx.type === 'home' && cause === 'popstate' && homeScroll > 0) restoreHomeScroll(homeScroll);
    store.set((s) => ({
      page: ctx,
      prevUrl: s.page.url !== ctx.url ? s.page.url : s.prevUrl,
      searchStats: null,
      searchReveal: false,
      showNativeRelated: false,
      homeVisited: s.homeVisited || ctx.type === 'home',
      video: ctx.type === 'watch' && ctx.videoId ? (s.video?.id === ctx.videoId ? s.video : { id: ctx.videoId, meta: null, failed: false }) : null,
      watch: ctx.type === 'watch' && s.watch?.id === ctx.videoId ? s.watch : null,
    }));
    if (ctx.type !== 'watch') {
      watchAbort?.abort();
      watchAbort = null;
    }
    apply();
  }

  /** One request for everything FocusSpace needs on a watch page; the player never waits for it. */
  async function loadWatch(id: string) {
    watchAbort?.abort();
    const controller = new AbortController();
    watchAbort = controller;
    const playlistId = new URL(location.href).searchParams.get('list');
    const stale = () => controller.signal.aborted || store.get().page.videoId !== id;
    store.set({ watch: { id, status: 'loading', data: null } });

    try {
      const data = await pageYouTube.watchNext(id, playlistId, controller.signal);
      if (stale()) return;
      if (data.title) {
        store.set({
          watch: { id, status: 'ready', data },
          video: { id, failed: false, meta: { videoId: id, title: data.title, description: data.description, channelId: data.channelId ?? undefined, channelTitle: data.channelTitle, channelHandle: data.channelHandle ?? undefined } },
        });
        return;
      }
      store.set({ watch: { id, status: 'ready', data } });
    } catch {
      if (stale()) return;
      store.set({ watch: { id, status: 'error', data: null } });
    }
    // Fallback identity: YouTube's public oEmbed endpoint (+ page DOM once it matches this video).
    const meta = await readVideoMetadata(id, stale).catch(() => null);
    if (!stale()) store.set({ video: { id, meta, failed: !meta } });
  }

  /** Local watch progress powers "Continue watching" and series continuity. */
  function saveProgress(force = false) {
    const { s, mode, active } = focus();
    if (!active || !mode || !s.settings.trackWatchHistory || s.page.type !== 'watch' || !s.video?.meta) return;
    const id = s.video.id;
    const flexyId = document.querySelector(WATCH.flexy)?.getAttribute('video-id');
    if (flexyId && flexyId !== id) return;
    if (document.querySelector(WATCH.adShowing)) return; // ad time isn't watch progress
    const video = currentVideoElement();
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || video.currentTime < 10) return;
    const progress = Math.min(1, video.currentTime / video.duration);
    if (!force && lastSaved.id === id && Math.abs(progress - lastSaved.progress) < 0.02 && Date.now() - lastSaved.at < 60_000) return;
    if (lastSaved.id === id && Math.abs(progress - lastSaved.progress) < 0.005) return;
    lastSaved = { id, progress, at: Date.now() };

    const meta = s.video.meta;
    const url = new URL(location.href);
    const topicId = getClassifier().classify(meta, mode).topicId;
    const durationSec = Math.round(video.duration);
    void updateItem('watchHistory', (list) => {
      const previous = list.find((e) => e.videoId === id);
      const entry: WatchEntry = {
        videoId: id,
        title: meta.title,
        channelTitle: meta.channelTitle ?? '',
        channelId: meta.channelId ?? null,
        modeId: mode.id,
        topicId,
        watchedAt: Date.now(),
        progress: Math.max(previous?.progress ?? 0, progress),
        durationSec,
        playlistId: url.searchParams.get('list'),
        playlistIndex: Number(url.searchParams.get('index')) || null,
      };
      return [entry, ...list.filter((e) => e.videoId !== id)].slice(0, HISTORY_LIMIT);
    }).catch(() => undefined);
  }

  function scheduleReconcile(delay = 250) {
    if (reconcileTimer) return;
    reconcileTimer = window.setTimeout(() => {
      reconcileTimer = 0;
      try {
        reconcile();
      } catch (err) {
        console.debug('[FocusSpace] reconcile failed', err);
      }
    }, delay);
  }

  function reconcile() {
    if (!extensionAlive()) return teardown();
    const { s, mode, active, showHome, filters: f } = focus();
    if (!s.ready || !document.body) return;

    // Home: stays attached inside YouTube's home browse element (hidden by YouTube on other pages).
    const homeParent = showHome ? document.querySelector(HOME_MOUNT_PARENT) : null;
    if (homeParent) slots.home.prepend(homeParent);
    else if (!showHome) slots.home.detach();

    let watch = false;
    if (active && s.page.type === 'watch') {
      const flexy = document.querySelector(WATCH.flexy);
      const inner = document.querySelector(WATCH.secondaryInner);
      const below = document.querySelector(WATCH.below);
      if (flexy?.hasAttribute('is-two-columns_') && inner) {
        slots.watch.place(inner, inner.querySelector(':scope > #related'));
        watch = true;
      } else if (below) {
        slots.watch.prepend(below);
        watch = true;
      }
    } else slots.watch.detach();

    let search = false;
    let searchStats: MarkStats | null = null;
    if (active && mode && s.page.type === 'search' && f.searchResults !== 'show') {
      const primary = document.querySelector(SEARCH.primary);
      if (primary) {
        slots.search.place(primary, primary.querySelector(SEARCH.sectionList));
        search = true;
      }
      searchStats = markSearchResults(mode, s.settings.debugRelevance);
    } else slots.search.detach();

    let guide = false;
    const sections = active ? document.querySelector(GUIDE.sections) : null;
    if (sections) {
      const first = sections.querySelector(GUIDE.section);
      slots.guide.place(sections, first?.nextElementSibling === slots.guide.host ? slots.guide.host.nextElementSibling : first?.nextElementSibling ?? null);
      guide = true;
    } else slots.guide.detach();

    // The slot container itself is always attached to `body` (never touches YouTube's masthead or chip
    // row, so nothing YouTube does to its own header can clip, reorder or hide it) — but it stays empty
    // unless FocusSpace is active: ContentApp.tsx only portals the AI bubble into it when `showAiEntry`
    // is true, which requires Focus Mode to be on. Attaching an empty container here costs nothing and
    // avoids re-finding a DOM anchor per page type; visibility is decided entirely by React state.
    slots.aiEntry.place(document.body, null);
    const aiEntry = true;

    if (active && f.hideShorts) markShortsChips();

    const patch: Partial<ContentState> = {};
    const home = slots.home.attached;
    if (s.slots.home !== home || s.slots.watch !== watch || s.slots.search !== search || s.slots.guide !== guide || s.slots.aiEntry !== aiEntry) patch.slots = { home, watch, search, guide, aiEntry };
    if (!sameStats(s.searchStats, searchStats)) patch.searchStats = searchStats;
    const ytDark = document.documentElement.hasAttribute('dark');
    if (ytDark !== s.ytDark) patch.ytDark = ytDark;
    if (Object.keys(patch).length) store.set(patch);
  }

  function startObservers() {
    const dom = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const target = m.target instanceof Element ? m.target : m.target.parentElement;
        if (target?.closest(MUTATION_NOISE)) continue;
        scheduleReconcile();
        return;
      }
    });
    dom.observe(document.body, { childList: true, subtree: true });
    const theme = new MutationObserver(() => scheduleReconcile(0));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
    observers.push(dom, theme);
    progressTimer = window.setInterval(() => saveProgress(), PROGRESS_INTERVAL_MS);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('yt-navigate-start', onNavigateStart);
    scheduleReconcile(0);
  }

  const onPageHide = () => saveProgress(true);
  const onNavigateStart = () => {
    navigatingAt = Date.now();
  };
  const onScroll = () => {
    if (store.get().page.type === 'home' && Date.now() - navigatingAt > 1500) homeScroll = window.scrollY;
  };

  /** YouTube swaps pages and resets scroll after the URL changes, so hold the position until it sticks. */
  function restoreHomeScroll(target: number) {
    window.clearInterval(restoreTimer);
    const started = Date.now();
    let steady = 0;
    restoreTimer = window.setInterval(() => {
      if (Date.now() - started > 3000) return window.clearInterval(restoreTimer);
      if (slots.home.host.getClientRects().length === 0) return; // home not displayed yet
      if (Math.abs(window.scrollY - target) < 40) {
        if (++steady >= 6) window.clearInterval(restoreTimer);
        return;
      }
      steady = 0;
      if (document.documentElement.scrollHeight >= target + window.innerHeight * 0.5) window.scrollTo(0, target);
    }, 50);
  }

  /** While an off-track prompt is open in Strict mode, keep the video paused until the user chooses. */
  function holdPlayback(hold: boolean) {
    holdCleanup?.();
    holdCleanup = null;
    if (!hold) return;
    const video = currentVideoElement();
    if (!video) return;
    const pause = () => video.pause();
    pause();
    video.addEventListener('play', pause);
    holdCleanup = () => video.removeEventListener('play', pause);
  }

  function stayFocused() {
    spaNavigate('/');
  }

  function watchAnyway(videoId: string) {
    store.set((s) => ({ dismissedNudges: [...s.dismissedNudges, videoId] }));
    holdPlayback(false);
    void currentVideoElement()?.play().catch(() => undefined);
  }

  function toggleNativeRelated() {
    store.set((s) => ({ showNativeRelated: !s.showNativeRelated }));
    apply();
  }

  function toggleSearchReveal() {
    store.set((s) => ({ searchReveal: !s.searchReveal }));
    apply();
  }

  function allowExplore(path: string) {
    store.set((s) => ({ exploreAllowed: [...s.exploreAllowed, path] }));
  }

  function teardown() {
    window.clearTimeout(reconcileTimer);
    window.clearInterval(progressTimer);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('yt-navigate-start', onNavigateStart);
    window.clearInterval(restoreTimer);
    observers.forEach((o) => o.disconnect());
    holdCleanup?.();
    watchAbort?.abort();
  }

  return { apply, onNavigate, startObservers, holdPlayback, stayFocused, watchAnyway, toggleNativeRelated, toggleSearchReveal, allowExplore };
}

export type Controller = ReturnType<typeof createController>;
