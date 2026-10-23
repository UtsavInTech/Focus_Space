import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { MASTHEAD_CONTAINER } from '../../youtube/selectors';

/**
 * Pins the Space bar (Space menu + topic chips) directly under YouTube's top bar, lined up with the
 * content column, for the whole time the home is open.
 *
 * CSS `position: sticky` was not enough: it only sticks while no ancestor clips overflow, and YouTube's
 * own page containers sometimes do — so the bar scrolled away. A fixed bar does not depend on any of
 * YouTube's markup. What it does need is where to sit, and that is *measured*, never assumed: the
 * masthead's bottom edge (56 px if YouTube ever renames it) and the home column's left edge and width,
 * which change when the sidebar opens or collapses. A spacer keeps the page from jumping under it.
 */
const FALLBACK_TOP = 56;

export function usePinnedBar() {
  const anchor = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchor.current;
    const column = el?.parentElement;
    if (!el || !column) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = column.getBoundingClientRect();
        const masthead = document.querySelector(MASTHEAD_CONTAINER)?.getBoundingClientRect();
        const top = masthead && masthead.height > 0 && masthead.bottom < 160 ? masthead.bottom : FALLBACK_TOP;
        const height = bar.current?.offsetHeight ?? 60;
        // Not laid out (home hidden, tab in the background): keep the bar in the page instead.
        if (rect.width < 200) return setBox(null);
        setBox((prev) => (prev && prev.top === top && prev.left === rect.left && prev.width === rect.width && prev.height === height ? prev : { top, left: rect.left, width: rect.width, height }));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(column);
    if (bar.current) ro.observe(bar.current);
    window.addEventListener('resize', measure);
    // Opening or collapsing YouTube's sidebar moves the column without resizing the window.
    const guide = new MutationObserver(measure);
    const app = document.querySelector('ytd-app');
    if (app) guide.observe(app, { attributes: true, attributeFilter: ['guide-persistent-and-visible', 'mini-guide-visible'] });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      guide.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const style: CSSProperties | undefined = box ? { position: 'fixed', top: box.top, left: box.left, width: box.width, margin: 0 } : undefined;
  const spacer: CSSProperties = { height: box ? box.height : 0 };
  return { anchor, bar, style, spacer, pinned: !!box };
}
