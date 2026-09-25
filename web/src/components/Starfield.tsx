import { useEffect, useRef, type RefObject } from 'react';

/**
 * The sky behind the feature steps: faint stars that twinkle, and shooting stars that cross from one
 * side to the other.
 *
 * It follows the reading, not the clock alone. `progress` is how far through the steps the reader is
 * (0 before step 01, 1 past the last): nothing falls before the first step, the sky fills as the course
 * goes on, and in the last stretch the shooting stars stop, so the section ends in a settled sky before
 * the pricing starts.
 *
 * One canvas, pinned to the viewport while the section is on screen, so it costs a screen's worth of
 * pixels however tall the section is — and nothing at all once it has scrolled away.
 */

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  colour: string;
}

interface Dust {
  x: number;
  y: number;
  radius: number;
  phase: number;
  speed: number;
  /** Shown once the sky is at least this full (0–1), so more appear as the reader goes on. */
  gate: number;
}

// Mostly cream, some mint, a rare one in the brand's red — the site's own palette, never a new colour.
const COLOURS = ['239, 226, 207', '239, 226, 207', '239, 226, 207', '239, 226, 207', '127, 214, 194', '127, 214, 194', '239, 90, 90'];

/** Shooting stars a second at the first step and at the last; the rate climbs between them. */
const RATE_START = 0.3;
const RATE_END = 1.2;
/** Faint twinkling stars behind everything — few enough that the sky stays quiet behind the text. */
const DUST_COUNT = 110;
/** The fraction of the section, at its end, over which the shooting stars taper to none. */
const WIND_DOWN = 0.1;

export function Starfield({ progress }: { progress: RefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    const dust: Dust[] = Array.from({ length: DUST_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      radius: 0.35 + Math.random() * 0.95,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.5,
      gate: Math.random(),
    }));
    let meteors: Meteor[] = [];
    let owed = 0;
    let last = 0;
    let frame = 0;
    let visible = false;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) draw(0, 0);
    };

    const spawn = () => {
      // Down and across, left to right, at a shallow angle — from the top edge or the left one.
      const angle = ((16 + Math.random() * 16) * Math.PI) / 180;
      // Unhurried: a star takes a few seconds to cross, so it can be followed rather than just glimpsed.
      const speed = 240 + Math.random() * 160;
      const fromTop = Math.random() < 0.65;
      meteors.push({
        x: fromTop ? Math.random() * width * 0.8 - width * 0.1 : -40,
        y: fromTop ? -20 : Math.random() * height * 0.55,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length: 110 + Math.random() * 120,
        colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      });
    };

    const draw = (dt: number, time: number) => {
      const p = progress.current ?? 0;
      ctx.clearRect(0, 0, width, height);

      // The dust: a third of it from the start, the rest arriving as the reader goes on.
      const fullness = p <= 0 ? 0.3 : Math.min(1, 0.3 + p * 0.9);
      for (const star of dust) {
        if (star.gate > fullness) continue;
        const twinkle = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * 0.001 * star.speed + star.phase);
        ctx.globalAlpha = 0.12 + twinkle * 0.33;
        ctx.fillStyle = 'rgb(239, 226, 207)';
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      if (still) {
        ctx.globalAlpha = 1;
        return;
      }

      // Nothing falls before the first step or after the last; the rate climbs between, then tapers.
      let rate = 0;
      if (p > 0 && p < 1) {
        rate = RATE_START + (RATE_END - RATE_START) * p;
        if (p > 1 - WIND_DOWN) rate *= (1 - p) / WIND_DOWN;
      }
      owed += rate * dt;
      while (owed >= 1) {
        spawn();
        owed -= 1;
      }

      meteors = meteors.filter((m) => m.x - m.length < width + 40 && m.y - m.length < height + 40);
      for (const m of meteors) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const speed = Math.hypot(m.vx, m.vy);
        const tailX = m.x - (m.vx / speed) * m.length;
        const tailY = m.y - (m.vy / speed) * m.length;
        const trail = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        trail.addColorStop(0, `rgba(${m.colour}, 0.85)`);
        trail.addColorStop(1, `rgba(${m.colour}, 0)`);
        ctx.globalAlpha = 1;
        // A little glow, and only a little: enough to read as light, never enough to haze the text above.
        ctx.shadowColor = `rgba(${m.colour}, 0.45)`;
        ctx.shadowBlur = 4;
        ctx.strokeStyle = trail;
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.shadowColor = `rgba(${m.colour}, 0.7)`;
        ctx.shadowBlur = 9;
        ctx.fillStyle = `rgba(${m.colour}, 0.95)`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      frame = 0;
      // A long gap (a background tab) resumes rather than releasing a burst of owed stars at once.
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      draw(dt, now);
      if (visible) frame = requestAnimationFrame(tick);
    };

    const sizer = new ResizeObserver(resize);
    sizer.observe(canvas);
    resize();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (still) return;
      if (visible && !frame) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
      if (!visible) {
        cancelAnimationFrame(frame);
        frame = 0;
        meteors = [];
        owed = 0;
      }
    });
    io.observe(canvas.parentElement ?? canvas);

    return () => {
      sizer.disconnect();
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [progress]);

  return (
    <div className="fsw-journey-sky" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
