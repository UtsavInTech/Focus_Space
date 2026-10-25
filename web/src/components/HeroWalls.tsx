import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import './hero-walls.css';

/** Sculpted side fins. Only their small 3D transforms move; the light is static. */
export function HeroWalls({ suspended = false, paused, onPausedChange }: { suspended?: boolean; paused: boolean; onPausedChange: (paused: boolean) => void }) {
  const scene = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);

  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  return <div ref={scene} className={`fsl-walls${visible && !hidden && !paused && !reduced && !suspended ? ' is-playing' : ''}`}>
    <div className="fsl-walls-art" aria-hidden="true">
      {['left', 'right'].map(side => <div key={side} className={`fsl-wall fsl-wall-${side}`}>
        <div className="fsl-wall-light" />
        {Array.from({ length: 6 }, (_, index) => {
          const gradient = `${id}-${side}-${index}`;
          return <div key={index} className="fsl-wall-fin" style={{ '--fin': index } as CSSProperties}>
            <svg viewBox="0 0 120 700" preserveAspectRatio="none" focusable="false">
              <defs>
                <linearGradient id={`${gradient}-metal`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor="#c2c4c0" /><stop offset=".16" stopColor="#f3f3ed" /><stop offset=".42" stopColor="#fffef7" /><stop offset=".76" stopColor="#d2d4cd" /><stop offset=".92" stopColor="#959b92" /><stop offset="1" stopColor="#eef0e8" />
                </linearGradient>
                <linearGradient id={`${gradient}-rim`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#fffdf0" stopOpacity=".15" /><stop offset=".45" stopColor="#e4d5a3" stopOpacity=".7" /><stop offset=".7" stopColor="#fff3c8" /><stop offset="1" stopColor="#d8c995" stopOpacity=".2" />
                </linearGradient>
              </defs>
              <path d="M0 0H57V220C57 325 110 355 110 475V700H48V480C48 375 0 338 0 240Z" fill={`url(#${gradient}-metal)`} />
              <path d="M57 0V220C57 325 110 355 110 475V700" stroke={`url(#${gradient}-rim)`} strokeWidth="2" fill="none" />
              <path d="M2 0V240C2 338 50 375 50 480V700" stroke="#fff" strokeOpacity=".65" strokeWidth="1" fill="none" />
            </svg>
          </div>;
        })}
      </div>)}
    </div>
    {!reduced && <button type="button" className="fsl-walls-toggle" aria-label={paused ? 'Play the hero animation' : 'Pause the hero animation'} onClick={() => onPausedChange(!paused)}>{paused ? <Play size={11} /> : <Pause size={11} />}<span>{paused ? 'Play motion' : 'Pause motion'}</span></button>}
  </div>;
}
