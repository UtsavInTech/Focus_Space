import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * A streaming-style shelf: one heading, one horizontal line of cards that scrolls by a page with the
 * arrows (or a trackpad, or the keyboard). Arrows only appear when there is somewhere to go. The shelf
 * slides in once, the first time it comes into view — never again on scroll back.
 */
export function Row({ title, subtitle, icon, action, children, className }: { title: string; subtitle?: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, children]);

  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.86, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <m.section
      className={`fs-shelf${className ? ` ${className}` : ''}`}
      aria-label={title}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -60px 0px' }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
    >
      <header className="fs-shelf-head">
        <h2>
          {icon}
          {title}
        </h2>
        {subtitle && <span className="fs-shelf-sub">{subtitle}</span>}
        {action && <span className="fs-shelf-action">{action}</span>}
      </header>
      <div className="fs-shelf-frame">
        {!edges.start && (
          <button type="button" className="fs-shelf-arrow is-prev" aria-label={`Scroll ${title} back`} onClick={() => page(-1)}>
            <ChevronLeft size={26} aria-hidden />
          </button>
        )}
        <div className="fs-shelf-track" ref={track}>
          {children}
        </div>
        {!edges.end && (
          <button type="button" className="fs-shelf-arrow is-next" aria-label={`Scroll ${title} forward`} onClick={() => page(1)}>
            <ChevronRight size={26} aria-hidden />
          </button>
        )}
      </div>
    </m.section>
  );
}
