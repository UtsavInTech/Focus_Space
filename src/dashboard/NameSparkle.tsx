import { useEffect, useRef } from 'react';

/**
 * A few red sparks rising off "FocusSpace" in the dashboard's sidebar, all the time — the website nav's
 * sparkle (web/src/components/Sparkle.tsx, `from="text"`), so the product and its site feel like one
 * thing. Most rise from "Space", the red half; the turning mark beside the name keeps its own motion.
 *
 * A copy rather than an import, as the logo is: the site and the extension share no bundle. The canvas
 * reaches 14px past the name on every side (dashboard.css), takes no clicks, pauses with the tab and
 * never runs under prefers-reduced-motion.
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
const RATE = 5;
const BLEED = 14;

export function NameSparkle() {
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

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      owed += RATE * dt;
      while (owed >= 1) {
        const w = width - BLEED * 2;
        const h = height - BLEED * 2;
        const along = Math.random() < 0.65 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.5;
        sparks.push({
          x: BLEED + along * w,
          y: BLEED + h * (0.25 + Math.random() * 0.6),
          vx: (Math.random() - 0.5) * 8,
          vy: -(5 + Math.random() * 11),
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

    const sizer = new ResizeObserver(resize);
    sizer.observe(canvas);
    resize();
    frame = requestAnimationFrame(draw);
    return () => {
      sizer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="fs-name-sparkle" aria-hidden="true" />;
}
