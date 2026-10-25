import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import './hero-louvres.css';

/** Below this width the side walls have no room, so the hero uses louvres instead (hero-walls.css). */
export const LOUVRE_QUERY = '(max-width: 1279px)';

const SLATS = 5;

function useCompact() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(LOUVRE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(LOUVRE_QUERY);
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

/** One sculpted slat: the walls' fin profile, laid on its side. */
function Slat({ index, progress, reduced }: { index: number; progress: MotionValue<number>; reduced: boolean }) {
  const id = `${useId().replace(/:/g, '')}-${index}`;
  // Closed and steep as the film arrives, open and nearly flat once it has settled. Outer slats lag a little.
  const lag = Math.abs(index - (SLATS - 1) / 2) * 0.06;
  const rotateX = useTransform(progress, [0, 0.45 + lag, 1], [72, 8, -14]);
  const y = useTransform(progress, [0, 1], [(index - 2) * 14, (index - 2) * -10]);
  return (
    <motion.div className="fsl-slat" style={{ '--slat': index, ...(reduced ? {} : { rotateX, y }) } as CSSProperties}>
      <div className="fsl-slat-sway">
        <svg viewBox="0 0 700 120" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id={`${id}-metal`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#c2c4c0" /><stop offset=".16" stopColor="#f3f3ed" /><stop offset=".42" stopColor="#fffef7" /><stop offset=".76" stopColor="#d2d4cd" /><stop offset=".92" stopColor="#959b92" /><stop offset="1" stopColor="#eef0e8" />
            </linearGradient>
            <linearGradient id={`${id}-rim`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#fffdf0" stopOpacity=".15" /><stop offset=".45" stopColor="#e4d5a3" stopOpacity=".7" /><stop offset=".7" stopColor="#fff3c8" /><stop offset="1" stopColor="#d8c995" stopOpacity=".2" />
            </linearGradient>
          </defs>
          <path d="M0 0V57H220C325 57 355 110 475 110H700V48H480C375 48 338 0 240 0Z" fill={`url(#${id}-metal)`} />
          <path d="M0 57H220C325 57 355 110 475 110H700" stroke={`url(#${id}-rim)`} strokeWidth="2" fill="none" />
          <path d="M0 2H240C338 2 375 50 480 50H700" stroke="#fff" strokeOpacity=".65" strokeWidth="1" fill="none" />
        </svg>
      </div>
    </motion.div>
  );
}

/**
 * Phones and tablets: metal louvres behind the film. As the film scrolls into view the louvres turn open.
 * Driven by scroll position, so it works with touch; only the louvres' transforms move, never the film.
 */
export function HeroLouvres({ paused, children }: { paused: boolean; children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const compact = useCompact();
  const reduced = !!useReducedMotion();
  const [visible, setVisible] = useState(false);
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start end', 'center 40%'] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });
  const glow = useTransform(progress, [0, 1], [0.6, 1]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

  if (!compact) return <>{children}</>;
  const still = reduced || paused;
  return (
    <div ref={stage} className={`fsl-louvre-stage${visible && !still ? ' is-playing' : ''}`}>
      <motion.div className="fsl-louvres" aria-hidden="true" style={still ? undefined : { opacity: glow }}>
        <div className="fsl-louvre-light" />
        {Array.from({ length: SLATS }, (_, index) => <Slat key={index} index={index} progress={progress} reduced={still} />)}
      </motion.div>
      {/* The film itself never moves with the scroll: it plays exactly as on the desktop. */}
      <div className="fsl-louvre-film">{children}</div>
    </div>
  );
}
