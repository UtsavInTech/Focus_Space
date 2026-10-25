import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { Logo } from './Logo';

const WORD = ['F', 'o', 'c', 'u', 's', 'S', 'p', 'a', 'c', 'e'];
// Each shadow is 96 thin copies of the letter, one step further from the lamp each time, fading from
// nearly solid to nothing. Small even steps keep the edge smooth; the colour is the stage's own dark,
// so the far end melts into the background instead of stopping at a hard line.
const SHADOW_STEPS = 96;
const SHADOW_STEP = 0.0085; // × font size, so the shadow is about 0.8× the letter height long
const SHADOW_RGB = '13, 11, 12';
const SHADOW_FADE = Array.from({ length: SHADOW_STEPS }, (_, i) => (0.93 * (1 - (i + 1) / SHADOW_STEPS) ** 1.25).toFixed(3));

/**
 * The footer's stage: the FocusSpace ring hangs on a thread as a lamp, and the wordmark below is lit by
 * it. Each letter casts a long shadow away from the lamp (stacked text-shadows) and a gradient copy on
 * top glows brightest nearest the light. Drag the lamp and it swings back; the light and shadows follow.
 *
 * Only transforms, a few CSS variables and the letters' shadows change, and only while the stage is
 * on screen. Under reduced motion the lamp hangs still and the lighting is drawn once.
 */
export function FooterStage() {
  const stage = useRef<HTMLDivElement>(null);
  const lamp = useRef<HTMLButtonElement>(null);
  const thread = useRef<SVGLineElement>(null);
  const shadows = useRef<(HTMLSpanElement | null)[]>([]);
  const reduced = !!useReducedMotion();

  useEffect(() => {
    const root = stage.current;
    const bulb = lamp.current;
    const line = thread.current;
    if (!root || !bulb || !line) return;

    // Lamp position relative to its rest point, in px. Rest: centred, hanging `length` below the top.
    let width = 0, length = 0;
    let x = 0, y = 0, vx = 0, vy = 0;
    let dragging = false, visible = false, frame = 0, last = 0, time = 0;
    let letters: { cx: number; cy: number }[] = [];
    let fontSize = 160;
    let wordTop = 0;
    let shadowX = NaN, shadowY = NaN;

    const measure = () => {
      const box = root.getBoundingClientRect();
      width = box.width;
      length = Math.min(box.height * 0.36, 210);
      const first = shadows.current[0];
      if (first) fontSize = parseFloat(getComputedStyle(first).fontSize) || fontSize;
      root.style.setProperty('--word-size', `${fontSize}px`);
      const word = shadows.current[0]?.getBoundingClientRect();
      if (word) wordTop = word.top - box.top + word.height * 0.18;
      letters = shadows.current.map((el) => {
        if (!el) return { cx: 0, cy: 0 };
        const r = el.getBoundingClientRect();
        return { cx: r.left - box.left + r.width / 2, cy: r.top - box.top + r.height * 0.55 };
      });
    };

    const paint = () => {
      const lx = width / 2 + x;
      const ly = length + y;
      root.style.setProperty('--lamp-x', `${lx}px`);
      root.style.setProperty('--lamp-y', `${ly}px`);
      // The letters' faces are lit from just above their tops, following the lamp's swing.
      root.style.setProperty('--light-y', `${wordTop - fontSize * 0.2 + y * 0.6}px`);
      bulb.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -50%) rotate(${x * 0.08}deg)`;
      line.setAttribute('x1', String(width / 2));
      line.setAttribute('x2', String(lx));
      line.setAttribute('y2', String(ly - bulb.offsetHeight * 0.42));
      // Shadows are the expensive part: redraw them only when the light has moved enough to show.
      if (Math.abs(lx - shadowX) < 0.6 && Math.abs(ly - shadowY) < 0.6) return;
      shadowX = lx;
      shadowY = ly;
      const step = fontSize * SHADOW_STEP;
      letters.forEach(({ cx, cy }, i) => {
        const el = shadows.current[i];
        if (!el) return;
        const dx = cx - lx, dy = cy - ly;
        const d = Math.hypot(dx, dy) || 1;
        const ux = (dx / d) * step, uy = (dy / d) * step;
        const parts: string[] = [];
        for (let s = 0; s < SHADOW_STEPS; s += 1) {
          parts.push(`${(ux * (s + 1)).toFixed(2)}px ${(uy * (s + 1)).toFixed(2)}px 0 rgba(${SHADOW_RGB}, ${SHADOW_FADE[s]})`);
        }
        el.style.textShadow = parts.join(',');
      });
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min((now - (last || now)) / 1000, 1 / 30);
      last = now;
      time += dt;
      if (!dragging) {
        // A damped pendulum back to rest, plus a slow idle sway so the light never feels frozen.
        const sway = Math.sin(time * 0.9) * width * 0.012;
        vx += (-(x - sway) * 26 - vx * 4.2) * dt;
        vy += (-y * 30 - vy * 5) * dt;
        x += vx * dt;
        y += vy * dt;
      }
      paint();
      if (visible) frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame && visible && !reduced) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (reduced) return;
      dragging = true;
      try { bulb.setPointerCapture(e.pointerId); } catch { /* capture is a nicety; dragging still works */ }
      root.classList.add('is-dragging');
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const box = root.getBoundingClientRect();
      // The thread does not stretch much: keep the lamp within reach of its anchor.
      let px = e.clientX - box.left - width / 2;
      let py = e.clientY - box.top;
      const reach = Math.hypot(px, py), max = length * 1.35;
      if (reach > max) { px *= max / reach; py *= max / reach; }
      vx = (px - x) * 30;
      vy = (py - length - y) * 30;
      x = px;
      y = Math.max(py - length, -length * 0.7);
    };
    const onUp = () => {
      dragging = false;
      root.classList.remove('is-dragging');
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    const onResize = () => { measure(); shadowX = NaN; paint(); };

    measure();
    paint();
    // Webfonts change letter widths: measure again once they are in.
    void document.fonts?.ready.then(onResize);
    observer.observe(root);
    window.addEventListener('resize', onResize);
    bulb.addEventListener('pointerdown', onDown);
    bulb.addEventListener('pointermove', onMove);
    bulb.addEventListener('pointerup', onUp);
    bulb.addEventListener('pointercancel', onUp);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      bulb.removeEventListener('pointerdown', onDown);
      bulb.removeEventListener('pointermove', onMove);
      bulb.removeEventListener('pointerup', onUp);
      bulb.removeEventListener('pointercancel', onUp);
    };
  }, [reduced]);

  return (
    <div ref={stage} className="fsw-stage" aria-label="FocusSpace">
      <div className="fsw-stage-glow" aria-hidden="true"><span /><span /><span /></div>
      <svg className="fsw-stage-thread" aria-hidden="true"><line ref={thread} x1="0" y1="0" x2="0" y2="0" /></svg>
      {/* A real button so the lamp is reachable, but dragging is a flourish: it does nothing else. */}
      <button ref={lamp} type="button" className="fsw-stage-lamp" aria-hidden="true" tabIndex={-1}>
        <Logo size={96} tone="current" />
      </button>
      <div className="fsw-stage-word" aria-hidden="true">
        <span className="fsw-stage-shadows">{WORD.map((ch, i) => <span key={i} ref={(el) => { shadows.current[i] = el; }}>{ch}</span>)}</span>
        <span className="fsw-stage-lit">{WORD.join('')}</span>
      </div>
    </div>
  );
}
