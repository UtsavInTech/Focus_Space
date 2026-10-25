import { useEffect, useRef } from 'react';
import Lenis from 'lenis';

/**
 * Smooth, weighted scrolling for the Studio (Lenis): the page glides and settles instead of jumping.
 * Off for people who ask for reduced motion, and torn down when the Studio closes. Returns a way to go
 * back to the top when you walk into another room.
 */
export function useSmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const instance = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
    lenis.current = instance;
    let frame = requestAnimationFrame(function loop(time) {
      instance.raf(time);
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      instance.destroy();
      lenis.current = null;
    };
  }, []);
  return (top = 0) => {
    if (lenis.current) lenis.current.scrollTo(top, { immediate: true });
    else window.scrollTo(0, top);
  };
}
