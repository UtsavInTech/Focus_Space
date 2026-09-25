import { useEffect, useRef } from 'react';

/**
 * A few red sparks rising, all the time — the cursor's sparks (CursorSparkle.tsx), made to stay somewhere
 * worth noticing: the name in the nav, and the plan we recommend.
 *
 * `from` says where sparks start. "text" rises off a line of type, mostly its right half (the "Space" of
 * "FocusSpace"). "edge" rises off the outline of a box, so they frame a card without sitting on the
 * prices and words inside it. They are few, small and slow either way.
 *
 * The canvas reaches BLEED past the element on every side so sparks can drift beyond its edges, and takes
 * no clicks. It pauses with the tab (requestAnimationFrame), stops while off screen, and never runs under
 * prefers-reduced-motion. Its parent must be positioned; site.css sizes it (.fsw-sparkle).
 */

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  radius: number;
  twinkle: number;
  colour: string;
}

const COLOURS = ['239, 68, 68', '255, 123, 123'];
/** How far the canvas reaches past its element, in CSS pixels — site.css's .fsw-sparkle matches it. */
const BLEED = 14;

export function Sparkle({ from, rate }: { from: 'text' | 'edge'; /** Sparks a second. */ rate: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let width = 0;
    let height = 0;
    let sparks: Spark[] = [];
    let owed = 0;
    let last = 0;
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    /** Where a spark starts, and which way it drifts. */
    const origin = (): [number, number, number, number] => {
      const w = width - BLEED * 2;
      const h = height - BLEED * 2;
      if (from === 'text') {
        const along = Math.random() < 0.65 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.5;
        return [BLEED + along * w, BLEED + h * (0.25 + Math.random() * 0.6), (Math.random() - 0.5) * 8, -(5 + Math.random() * 11)];
      }
      // Anywhere on the outline, by length, drifting outward and a little up.
      let d = Math.random() * 2 * (w + h);
      const out = 4 + Math.random() * 8;
      const rise = -(3 + Math.random() * 8);
      if (d < w) return [BLEED + d, BLEED, (Math.random() - 0.5) * 6, -out + rise];
      d -= w;
      if (d < h) return [BLEED + w, BLEED + d, out, rise];
      d -= h;
      if (d < w) return [BLEED + w - d, BLEED + h, (Math.random() - 0.5) * 6, out * 0.4 + rise];
      d -= w;
      return [BLEED, BLEED + h - d, -out, rise];
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      owed += rate * dt;
      while (owed >= 1) {
        const [x, y, vx, vy] = origin();
        sparks.push({
          x,
          y,
          vx,
          vy,
          born: now,
          life: 1100 + Math.random() * 900,
          radius: 0.6 + Math.random() * 0.8,
          twinkle: Math.random() * Math.PI * 2,
          colour: COLOURS[Math.random() < 0.6 ? 0 : 1],
        });
        owed -= 1;
      }

      ctx.clearRect(0, 0, width, height);
      sparks = sparks.filter((s) => now - s.born < s.life);
      for (const s of sparks) {
        const age = (now - s.born) / s.life;
        const t = (now - s.born) / 1000;
        // In, hold, out — and a flicker on top, so they read as sparkle rather than dots.
        const envelope = Math.min(1, age / 0.2, (1 - age) / 0.35);
        const flicker = 0.65 + 0.35 * Math.sin(t * 14 + s.twinkle);
        const alpha = envelope * flicker * 0.8;
        ctx.shadowColor = `rgba(${s.colour}, ${alpha * 0.8})`;
        ctx.shadowBlur = 5;
        ctx.fillStyle = `rgba(${s.colour}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(s.x + s.vx * t, s.y + s.vy * t, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const start = () => {
      if (frame) return;
      last = 0;
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      sparks = [];
      owed = 0;
      ctx.clearRect(0, 0, width, height);
    };

    const sizer = new ResizeObserver(resize);
    sizer.observe(canvas);
    resize();
    // Nothing runs while it is off screen — the nav is always on screen, a pricing card mostly is not.
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()));
    io.observe(canvas);
    return () => {
      sizer.disconnect();
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [from, rate]);

  return <canvas ref={canvasRef} className="fsw-sparkle" aria-hidden="true" />;
}
