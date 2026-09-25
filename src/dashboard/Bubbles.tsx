import { useEffect, useRef } from 'react';

/**
 * The dashboard's background: soft bubbles that form, glow faintly, drift very slowly and fade, so the
 * page feels alive without anything on it asking to be looked at.
 *
 * Each theme has its own light. Dark takes the website's colours — mint and cream, and a trace of the
 * brand's red — at a few percent opacity. Light is pink with a little purple. The bubbles follow a theme
 * change as it happens (the page's data-theme), and stay behind every card: they fill the gaps, never
 * the words.
 *
 * Deliberately cheap: one canvas at CSS-pixel resolution (a soft gradient gains nothing from retina
 * pixels), about thirty frames a second, paused with the tab, and a single still frame for reduced
 * motion.
 */

interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  born: number;
  life: number;
  /** Index into the theme's palette, so a theme change recolours it in place. */
  tone: number;
  wobble: number;
}

type Palette = { rgb: string; alpha: number }[];

const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: [
    { rgb: '127, 214, 194', alpha: 0.075 },
    { rgb: '127, 214, 194', alpha: 0.06 },
    { rgb: '239, 226, 207', alpha: 0.05 },
    { rgb: '239, 68, 68', alpha: 0.045 },
  ],
  // On a near-white page a colour needs far more opacity to be seen at all than it does on black. Pink
  // leads (three of four); purple is the accent — lilac reads stronger than pink at the same opacity.
  light: [
    { rgb: '244, 114, 182', alpha: 0.34 },
    { rgb: '236, 72, 153', alpha: 0.24 },
    { rgb: '249, 168, 212', alpha: 0.42 },
    { rgb: '192, 132, 252', alpha: 0.17 },
  ],
};

const COUNT = 14;
const FRAME_MS = 1000 / 30;

export function Bubbles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let theme: 'dark' | 'light' = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    let frame = 0;
    let lastDraw = 0;

    const make = (now: number, anyAge = false): Bubble => {
      const life = 18000 + Math.random() * 14000;
      const angle = Math.random() * Math.PI * 2;
      // Slow, but visibly moving: about the width of a card over a bubble's life.
      const speed = 8 + Math.random() * 10;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        // A slight upward lean, as bubbles rise.
        vy: Math.sin(angle) * speed - 4,
        radius: 50 + Math.random() * 110,
        // The first set starts part-way through life, so the page does not open on an empty sky.
        born: anyAge ? now - Math.random() * life : now,
        life,
        tone: Math.floor(Math.random() * PALETTES.dark.length),
        wobble: Math.random() * Math.PI * 2,
      };
    };
    let bubbles: Bubble[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      if (!bubbles.length) bubbles = Array.from({ length: COUNT }, () => make(performance.now(), true));
      if (still) draw(performance.now());
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      const palette = PALETTES[theme];
      bubbles = bubbles.map((b) => (now - b.born > b.life ? make(now) : b));
      for (const b of bubbles) {
        const age = Math.min(1, Math.max(0, (now - b.born) / b.life));
        const t = (now - b.born) / 1000;
        // Forming: it grows into itself and brightens; then it floats; then it fades.
        const form = Math.min(1, age / 0.25);
        const fade = Math.min(1, (1 - age) / 0.25);
        const glow = 0.85 + 0.15 * Math.sin(t * 0.6 + b.wobble);
        const { rgb, alpha } = palette[b.tone];
        const a = alpha * Math.min(form, fade) * glow;
        if (a <= 0.002) continue;
        const r = b.radius * (0.55 + 0.45 * form);
        const x = b.x + b.vx * t + Math.sin(t * 0.3 + b.wobble) * 22;
        const y = b.y + b.vy * t;

        const body = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r);
        body.addColorStop(0, `rgba(${rgb}, ${a * 1.4})`);
        body.addColorStop(0.7, `rgba(${rgb}, ${a * 0.6})`);
        body.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // A faint rim: what makes it read as a bubble rather than a blur.
        ctx.strokeStyle = `rgba(${rgb}, ${a * 0.55})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.86, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;
      draw(now);
    };

    // Follows a theme change as it happens: useDocumentTheme writes data-theme on <html>.
    const themeWatch = new MutationObserver(() => {
      theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      if (still) draw(performance.now());
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    resize();
    window.addEventListener('resize', resize);
    if (!still) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      themeWatch.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="fs-bubbles" aria-hidden="true" />;
}
