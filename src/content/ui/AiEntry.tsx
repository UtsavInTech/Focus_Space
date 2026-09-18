import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import type { LearningMode, Settings } from '@/types/domain';
import type { PageType } from '@/integrations/youtube/urls';
import { OverlayRootContext } from '@/ui/components/Modal';
import { buildHomepageContext } from '@/learning/ai/homepage-context';
import { HOME_CHIPS, queryAll } from '../youtube/selectors';
import { useFeedView } from '../data/hooks';
import { useVisibleFeed, type VisibleVideo } from '../data/visible-feed';
import { readVisibleYouTubeVideos } from '../data/page-videos';
import { ChatPanel } from './ChatPanel';
import { useDraggable } from './useDraggable';

/**
 * FocusSpace AI — a floating launcher in the bottom-right corner, where every
 * other assistant on the web lives, rather than a button in YouTube's
 * masthead. Two reasons it moved: the masthead is crowded and YouTube
 * rearranges it, and a corner bubble is a shape people already know how to
 * use without being told.
 *
 * Both the launcher and the panel are portalled into the always-unclipped
 * overlay shadow root that `Modal` and `OffTrackNudge` already use. Nothing is
 * rendered into YouTube's own DOM, so no YouTube layout change can clip,
 * scroll away or reorder it — which is exactly what made the in-masthead
 * version fragile.
 *
 * Context comes from `useVisibleFeed()` — what the home view is actually
 * showing, Continue watching included — falling back to the library feed on
 * pages that have no home view (a watch page, search). Before this, the entry
 * built its context from the subscription half of the feed alone, so on a
 * space with no matching subscriptions the AI was handed an empty list and
 * answered "there are no videos" while the page was full of them.
 */

/** Remembered so the glow stops for good once the learner has noticed it. */
const SEEN_KEY = 'focusspace.ai.seen';

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Storage can be blocked on youtube.com; a bubble that pulses again is harmless.
    return false;
  }
}

export function AiEntry({ settings, mode, pageType }: { settings: Settings; mode: LearningMode; pageType: PageType }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(true); // assume seen until storage answers, so the page never flashes a pulse
  const overlayRoot = useContext(OverlayRootContext);
  const { view } = useFeedView(mode);
  const visible = useVisibleFeed();
  const [nativeChips, setNativeChips] = useState<string[]>([]);
  const [pageVideos, setPageVideos] = useState<VisibleVideo[]>([]);

  /*
   * The launcher is what moves; the panel is anchored to it. Dragging the
   * thing you can always see is more predictable than dragging the panel and
   * leaving the button behind.
   */
  const drag = useDraggable({ key: 'focusspace.ai.pos', anchor: 'right', initial: { x: 20, y: 20 } });

  useEffect(() => setSeen(readSeen()), []);

  /*
   * Read the page only when the panel actually opens — no reason to touch the
   * DOM while idle. The video read is a fallback for when FocusSpace has
   * nothing of its own to describe (Focus Mode off, or a page it does not
   * rebuild); with Focus on, `useVisibleFeed()` is richer and wins below.
   */
  useEffect(() => {
    if (!open) return;
    setNativeChips(
      queryAll([`${HOME_CHIPS.bar} ${HOME_CHIPS.chip}`])
        .map((el) => (el.textContent ?? '').trim())
        .filter(Boolean)
        .slice(0, 20),
    );
    setPageVideos(readVisibleYouTubeVideos());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  function toggle() {
    if (drag.dragging) return; // the pointer-up that ended a drag is not a click
    setOpen((o) => !o);
    if (!seen) {
      setSeen(true);
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* see readSeen */
      }
    }
  }

  const homepage = buildHomepageContext({
    pageType,
    spaceName: mode.name,
    activeCategory: visible.activeCategory,
    topicNames: mode.topics.map((t) => t.name),
    nativeCategoryChips: nativeChips,
    feedVideos: visible.videos.length ? visible.videos : view?.items?.length ? view.items : pageVideos,
    subscriptions: (view?.channels ?? []).filter((c) => c.source === 'subscription'),
    language: settings.ai.language,
  });

  if (!overlayRoot) return null;

  return createPortal(
    <>
      {open && (
        <div className="fs-ai-dock" role="dialog" aria-label="FocusSpace AI" style={{ right: drag.offset.x, bottom: drag.offset.y + 62 }}>
          <ChatPanel homepage={homepage} language={settings.ai.language} onClose={() => setOpen(false)} />
        </div>
      )}
      <button
        type="button"
        className={`fs-ai-bubble${seen ? '' : ' is-pulsing'}${open ? ' is-open' : ''}${drag.dragging ? ' is-dragging' : ''}`}
        style={{ right: drag.offset.x, bottom: drag.offset.y }}
        {...drag.handlers}
        title="Drag to move, click to open"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={open ? 'Close FocusSpace AI' : 'Ask FocusSpace AI'}
        onClick={toggle}
      >
        {open ? <X size={18} aria-hidden /> : <Sparkles size={18} aria-hidden />}
        <span className="fs-ai-bubble-label">{open ? 'Close' : 'FocusSpace AI'}</span>
        {!seen && !open && <span className="fs-ai-bubble-dot" aria-hidden />}
      </button>
    </>,
    overlayRoot,
  );
}
