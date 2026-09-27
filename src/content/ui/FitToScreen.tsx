import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * A box on the watch page that ends where the window ends.
 *
 * YouTube's side column has no height of its own, so a chat (or a quiz) placed in it grows down the
 * page and takes its question box — or its "Next question" — below the fold: to ask again you had to
 * scroll the page, and the video went with it. This measures how much of the window is left below the
 * box's top edge and caps the box there; what is inside scrolls instead. As the page is scrolled down
 * the box moves up and gets taller, so it always fills exactly what is visible.
 */
export function FitToScreen({ className, min = 320, gap = 12, children }: { className: string; min?: number; gap?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = Math.max(0, el.getBoundingClientRect().top);
        el.style.maxHeight = `${Math.max(min, window.innerHeight - top - gap)}px`;
      });
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit);
    };
  }, [min, gap]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
