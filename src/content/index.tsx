import { createRoot } from 'react-dom/client';
import stylesCss from '@/ui/styles.css?inline';
import { defaultsFor } from '@/storage/schema';
import { bindToOwner, getItems, subscribe } from '@/storage/storage';
import { listen } from '@/messaging/runtime';
import { detectPage } from '@/integrations/youtube/urls';
import { readSubscriptionsFromSession } from '@/integrations/youtube/innertube';
import contentCss from './ui/content.css?inline';
import { createStore, type ContentState } from './store';
import { createController } from './controller';
import { injectStylesheet, setFlags } from './youtube/filters/css-rules';
import { watchNavigation } from './youtube/navigation';
import { Slot } from './ui/slots';
import { ContentApp } from './ui/ContentApp';
import { pageYouTube } from './data/youtube';
import { startTranscriptCapture } from './data/knowledge';

declare global {
  interface Window {
    __focusSpaceContent?: boolean;
  }
}

const STORAGE_KEYS = ['settings', 'modes'] as const;

function whenBodyReady(fn: () => void) {
  if (document.body) fn();
  else document.addEventListener('DOMContentLoaded', fn, { once: true });
}

function main() {
  if (window.__focusSpaceContent) return;
  window.__focusSpaceContent = true;

  // Signing out, or in as someone else, replaces the data this page is showing: reload rather than keep
  // the previous person's Spaces, feed or answers on screen (storage/ownership.ts).
  void bindToOwner(() => location.reload());

  // 1. Filters first, at document_start, so distractions never flash.
  injectStylesheet();
  // Captions the player loads (even before any UI exists) feed the knowledge map.
  startTranscriptCapture();
  setFlags({ pending: true });
  const pendingFallback = window.setTimeout(() => setFlags({ pending: false }), 2500);

  // 2. Answer the background worker (subscription import runs with the page's session).
  listen({
    'content/ping': () => ({ ok: true }),
    'content/read-subscriptions': () => readSubscriptionsFromSession(),
    'content/youtube': async (req) => {
      try {
        const data = req.op === 'channelUploads' ? await pageYouTube.channelUploads(req.channelId) : await pageYouTube.searchChannels(req.query);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'YouTube request failed' };
      }
    },
  });

  const page = detectPage(location.href);
  const store = createStore<ContentState>({
    ready: false,
    settings: defaultsFor('settings'),
    modes: defaultsFor('modes'),
    page,
    prevUrl: null,
    video: null,
    watch: null,
    searchStats: null,
    searchReveal: false,
    showNativeRelated: false,
    slots: { home: false, watch: false, search: false, guide: false, aiEntry: false },
    homeVisited: page.type === 'home',
    ytDark: false,
    dismissedNudges: [],
    exploreAllowed: [],
  });

  const css = `${stylesCss}\n${contentCss}`;
  const slots = {
    overlay: new Slot('overlay', css, 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147482000;'),
    // ytd-browse doesn't stretch its children; the home needs the full content width.
    home: new Slot('home', css, 'width:100%;flex:1 1 100%;min-width:0;'),
    watch: new Slot('watch', css, 'margin-bottom:16px;'),
    search: new Slot('search', css, 'margin:8px 0 16px;'),
    guide: new Slot('guide', css),
    // Placed either among the home chip row's own chips or the masthead's buttons — both flex rows, so inline-flex fits either without extra sizing rules.
    aiEntry: new Slot('ai-entry', css, 'display:inline-flex;align-items:center;'),
  };
  const controller = createController(store, slots);

  // 3. State: load, then follow every change made from any FocusSpace surface.
  subscribe(STORAGE_KEYS, (changes) => {
    store.set(changes);
    controller.apply();
  });
  getItems(STORAGE_KEYS).then((data) => {
    window.clearTimeout(pendingFallback);
    store.set({ ...data, ready: true });
    setFlags({ pending: false });
    controller.apply();
  });

  // 4. SPA navigation.
  watchNavigation((ctx, cause) => controller.onNavigate(ctx, cause));

  // 5. UI + DOM observers once the body exists.
  whenBodyReady(() => {
    document.body.appendChild(slots.overlay.host);
    createRoot(slots.overlay.container).render(<ContentApp store={store} slots={slots} controller={controller} />);
    controller.startObservers();
  });
}

main();
