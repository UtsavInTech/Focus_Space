import { useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
/** Where the learner last dragged the panel to, so it stays put between videos. */
const POS_KEY = 'focusspace.ai.pos';

interface Offset {
  /** Distance from the viewport's right and bottom edges, matching how the panel is anchored. */
  right: number;
  bottom: number;
}

const DEFAULT_OFFSET: Offset = { right: 20, bottom: 84 };

function readOffset(): Offset {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return DEFAULT_OFFSET;
    const parsed = JSON.parse(raw) as Partial<Offset>;
    if (typeof parsed.right !== 'number' || typeof parsed.bottom !== 'number') return DEFAULT_OFFSET;
    return { right: parsed.right, bottom: parsed.bottom };
  } catch {
    return DEFAULT_OFFSET;
  }
}

/** Keeps a remembered position usable after the window is resized or the panel is dragged off-screen. */
function clampOffset({ right, bottom }: Offset): Offset {
  const maxRight = Math.max(0, window.innerWidth - 120);
  const maxBottom = Math.max(0, window.innerHeight - 80);
  return { right: Math.min(Math.max(0, right), maxRight), bottom: Math.min(Math.max(0, bottom), maxBottom) };
}

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

  const [offset, setOffset] = useState<Offset>(DEFAULT_OFFSET);
  const drag = useRef<{ startX: number; startY: number; from: Offset } | null>(null);

  useEffect(() => setSeen(readSeen()), []);
  useEffect(() => setOffset(clampOffset(readOffset())), []);

  // A remembered corner can end up off-screen when the window shrinks — pull it back in.
  useEffect(() => {
    const onResize = () => setOffset((o) => clampOffset(o));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /**
   * Dragging by the panel's header. Pointer events (not mouse events) so a
   * trackpad, a touchscreen and a mouse all behave the same, and pointer
   * capture so the drag survives the cursor crossing YouTube's player — which
   * swallows mouse events it considers its own.
   */
  const startDrag = useCallback(
    (event: ReactPointerEvent) => {
      // Never hijack a click on a control inside the header (the close button).
      if ((event.target as HTMLElement).closest('button, a, input, textarea')) return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startY: event.clientY, from: offset };
    },
    [offset],
  );

  const onDrag = useCallback((event: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // Anchored to the right/bottom edges, so the deltas are inverted.
    setOffset(clampOffset({ right: d.from.right - (event.clientX - d.startX), bottom: d.from.bottom - (event.clientY - d.startY) }));
  }, []);

  const endDrag = useCallback(
    (event: ReactPointerEvent) => {
      if (!drag.current) return;
      drag.current = null;
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(offset));
      } catch {
        /* the panel simply starts in the default corner next time */
      }
    },
    [offset],
  );

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
        <div className="fs-ai-dock" role="dialog" aria-label="FocusSpace AI" style={{ right: offset.right, bottom: offset.bottom }}>
          <div className="fs-ai-drag" onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="Drag to move" />
          <ChatPanel homepage={homepage} language={settings.ai.language} onClose={() => setOpen(false)} />
        </div>
      )}
      <button
        type="button"
        className={`fs-ai-bubble${seen ? '' : ' is-pulsing'}${open ? ' is-open' : ''}`}
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
