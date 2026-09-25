import { useEffect, useRef } from 'react';

/**
 * The website's cursor sparkle (web/src/components/CursorSparkle.tsx), on the extension's own home too —
 * a copy rather than an import, as the logo is, because the site and the extension share no bundle.
 *
 * A few red sparks where the cursor moves — the brand's red, in the smallest amount that still reads as
 * light. Sparks come from distance travelled, not time, so a resting cursor shows nothing and a quick
 * sweep leaves a short trail rather than a cloud. Each drifts a little and is gone in about half a
 * second.
 *
 * Only for a mouse or trackpad (there is no cursor on a touch screen), never for reduced motion, and the
 * canvas takes no clicks. It draws only while sparks are alive, so a still page costs nothing.
 */

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  radius: number;
  colour: string;
}

// The brand red and the lighter red used for text on dark — nothing new.
const COLOURS = ['239, 68, 68', '255, 123, 123'];
/** Pixels of cursor travel per spark. */
const SPACING = 26;
const MAX_SPARKS = 40;

export function CursorSparkle() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (!window.matchMedia('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let sparks: Spark[] = [];
    let frame = 0;
    let travelled = 0;
    let lastX = NaN;
    let lastY = NaN;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      frame = 0;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      sparks = sparks.filter((s) => now - s.born < s.life);
      for (const s of sparks) {
        const age = (now - s.born) / s.life;
        const t = (now - s.born) / 1000;
        const x = s.x + s.vx * t;
        const y = s.y + s.vy * t + 18 * t * t; // a touch of fall, as a spark would
        const alpha = (1 - age) * 0.85;
        ctx.shadowColor = `rgba(${s.colour}, ${alpha * 0.8})`;
        ctx.shadowBlur = 6;
        ctx.fillStyle = `rgba(${s.colour}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, s.radius * (1 - age * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (sparks.length) frame = requestAnimationFrame(draw);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const { clientX: x, clientY: y } = event;
      if (!Number.isNaN(lastX)) travelled += Math.hypot(x - lastX, y - lastY);
      lastX = x;
      lastY = y;
      const now = performance.now();
      while (travelled >= SPACING && sparks.length < MAX_SPARKS) {
        travelled -= SPACING;
        const angle = Math.random() * Math.PI * 2;
        const speed = 6 + Math.random() * 22;
        sparks.push({
          x: x + (Math.random() - 0.5) * 8,
          y: y + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: now,
          life: 380 + Math.random() * 320,
          radius: 0.8 + Math.random() * 1.2,
          colour: COLOURS[Math.random() < 0.6 ? 0 : 1],
        });
      }
      if (travelled > SPACING) travelled = 0;
      if (sparks.length && !frame) frame = requestAnimationFrame(draw);
    };
    const onLeave = () => {
      lastX = NaN;
      lastY = NaN;
      travelled = 0;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="fs-cursor-sparkle" aria-hidden="true" />;
}
