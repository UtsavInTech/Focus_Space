import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { animate, motion, useInView, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { ArrowUpRight, BrainCircuit, Code2, Languages, Layers, RotateCcw } from 'lucide-react';
import './brand-finale.css';

type Phase = 'broken' | 'flying' | 'impact' | 'repairing' | 'ready';
const FLIGHT = 'M 1320 100 C 1320 630 720 600 720 250';
// The SVG group receives the sampled path transform; Motion owns the flight clock.
function flightTransform(t: number): string {
    const u = 1 - t;
    const x = u*u*u*1320 + 3*u*u*t*1320 + 3*u*t*t*720 + t*t*t*720;
    const y = u*u*u*100 + 3*u*u*t*630 + 3*u*t*t*600 + t*t*t*250;
    const dx = 3*u*u*(1320-1320) + 6*u*t*(720-1320) + 3*t*t*(720-720);
    const dy = 3*u*u*(630-100) + 6*u*t*(600-630) + 3*t*t*(250-600);
    return `translate(${x} ${y}) rotate(${Math.atan2(dy, dx) * 180 / Math.PI})`;
}

const FRACTURES = [
  { x: -15, y: 13, r: -4 }, { x: 7, y: -16, r: 3 }, { x: -5, y: 22, r: -3 },
  { x: 9, y: -10, r: 4 }, { x: -6, y: 16, r: -2 }, { x: 8, y: -18, r: 3 },
  { x: -8, y: 21, r: -4 }, { x: 10, y: -12, r: 2 }, { x: 4, y: 17, r: -3 }, { x: 13, y: -7, r: 3 },
];
const DIRECTIONS = [
  { name: 'System Design', detail: 'Build things that scale.', query: 'system design full course', icon: Layers },
  { name: 'Web Development', detail: 'Make your ideas real.', query: 'web development full course', icon: Code2 },
  { name: 'AI / ML', detail: 'Understand what’s next.', query: 'machine learning full course', icon: BrainCircuit },
  { name: 'Japanese', detail: 'Open up a new world.', query: 'Japanese beginner full course', icon: Languages },
];
const PHASE_COPY: Record<Phase, string> = {
  broken: 'A little scattered. A lot of possibility.', flying: 'One intention. A new direction.',
  impact: 'That’s your focus.', repairing: 'Watch it all come together.', ready: 'A little focus changes everything.',
};

/** A Motion-driven story: scattered lettering → a U-shaped shot → liquid repair → a new direction. */
export function BrandFinale() {
  const scene = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const entered = useInView(stage, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('broken');
  const [run, setRun] = useState(0);
  const progress = useMotionValue(0);
  const liquid = useMotionValue(0);
  const displacement = useRef<SVGFEDisplacementMapElement>(null);
  const fixed = !!reduced || phase === 'repairing' || phase === 'ready';
  const ready = !!reduced || phase === 'ready';
  const hit = phase === 'impact' || phase === 'repairing';
  const id = useId().replace(/:/g, '');
  const face = `${id}-face`, fade = `${id}-fade`, mask = `${id}-mask`, word = `${id}-word`, fluid = `${id}-fluid`;

  useEffect(() => {
    if (reduced) { setPhase('ready'); return; }
    if (!entered) return;
    setPhase('broken');
    const timers = [
      setTimeout(() => setPhase('flying'), 1000),
      setTimeout(() => setPhase('impact'), 3000),
      setTimeout(() => setPhase('repairing'), 3200),
      setTimeout(() => setPhase('ready'), 5300),
    ];
    return () => timers.forEach(clearTimeout);
  }, [entered, reduced, run]);

  useEffect(() => {
    if (phase !== 'flying' || reduced) return;
    progress.set(0);
    const flight = animate(progress, 1, { duration: 2, ease: [0.45, 0, 0.3, 1] });
    return () => flight.stop();
  }, [phase, reduced, progress]);

  useMotionValueEvent(liquid, 'change', value => displacement.current?.setAttribute('scale', String(value)));
  useEffect(() => {
    if (phase !== 'repairing' || reduced) { liquid.set(0); return; }
    const repair = animate(liquid, [0, 27, 9, 0], { duration: 1.7, times: [0, 0.2, 0.55, 1], ease: 'easeOut' });
    return () => repair.stop();
  }, [phase, reduced, liquid]);

  const arrowNode = useRef<SVGGElement>(null);
  useMotionValueEvent(progress, 'change', t => arrowNode.current?.setAttribute('transform', flightTransform(t)));
  const light = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || reduced) return;
    const box = event.currentTarget.getBoundingClientRect();
    scene.current?.style.setProperty('--beam-x', `${Math.max(20, Math.min(80, (event.clientX - box.left) / box.width * 100))}%`);
  };

  return (
    <section id="signature" className="fsw-finale" data-phase={ready ? 'ready' : phase} ref={scene}
      onPointerMove={light} onPointerLeave={() => scene.current?.style.removeProperty('--beam-x')}
      aria-label="FocusSpace — a little focus brings it all together">
      <div className="fsw-finale-heading"><span>A LITTLE INTENTION.</span><span>A WHOLE NEW YOUTUBE.</span></div>
      <div className="fsw-finale-story-head">
        <span className="fsw-finale-story-copy" aria-hidden="true"><i />{PHASE_COPY[reduced ? 'ready' : phase]}</span>
        <button type="button" className="fsw-finale-replay" onClick={() => setRun(value => value + 1)} disabled={!ready || !!reduced}>
          <RotateCcw size={13} aria-hidden="true" /> Replay the story
        </button>
      </div>
      <div className="fsw-finale-scene" ref={stage}>
        <div className="fsw-finale-floor" aria-hidden="true" />
        <svg className="fsw-finale-lettering" viewBox="0 0 1440 570" role="img"
          aria-label="An arrow carries focus into a fractured FocusSpace wordmark, which ripples and becomes whole." focusable="false">
          <defs>
            <linearGradient id={face} x1="0" y1="0" x2="0.7" y2="1"><stop offset="0%" stopColor="#fff0d3" /><stop offset="50%" stopColor="#b6a58a" /><stop offset="100%" stopColor="#685b48" /></linearGradient>
            <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="white" stopOpacity=".7" /><stop offset="100%" stopColor="white" stopOpacity="0" /></linearGradient>
            <mask id={mask}><rect width="1440" height="570" fill={`url(#${fade})`} /></mask>
            <filter id={fluid} x="-10%" y="-25%" width="120%" height="150%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency=".012 .022" numOctaves="2" seed="8" result="noise" />
              <feDisplacementMap ref={displacement} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <g id={word} style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif", fontSize: 232, fontWeight: 650, letterSpacing: "-.035em" }}>
              <g className="fsw-finale-extrusion">{Array.from({ length: 12 }, (_, i) => <text key={i} x="80" y={339-i} textLength="1280" lengthAdjust="spacingAndGlyphs">FocusSpace</text>)}</g>
              <text className="fsw-finale-face" x="80" y="328" textLength="1280" lengthAdjust="spacingAndGlyphs" fill={`url(#${face})`}>Focus<tspan className="fsw-finale-space">Space</tspan></text>
            </g>
            {FRACTURES.map((_, i) => <clipPath key={i} id={`${id}-piece-${i}`}><path d={`M${80+i*128} 80 l128 0 0 310 -128 0Z`} /></clipPath>)}
          </defs>
          <g aria-hidden="true">
            <motion.g className="fsw-finale-shadow" mask={`url(#${mask})`} initial={false} animate={{ opacity: fixed ? 1 : 0.18 }}>
              {Array.from({ length: 32 }, (_, i) => <text key={i} x="80" y="328" textLength="1280" lengthAdjust="spacingAndGlyphs" transform={`translate(720 328) scale(${1+i*.009} 1) translate(-720 -328) translate(0 ${i*4.5})`}>FocusSpace</text>)}
            </motion.g>
            {/* A small board at the far right contains the bow that launches the intention. */}
            <motion.g className="fsw-finale-launcher" initial={false} animate={{ opacity: ready ? 0.4 : 1 }} transform="translate(1320 100)">
              <rect x="-48" y="-61" width="96" height="122" rx="20" fill="#1c1915" stroke="#a4865455" />
              <text className="fsw-finale-launcher-label" x="0" y="-38" textAnchor="middle">INTENTION</text>
              <motion.path d="M -17 -25 Q 32 0 -17 25" stroke="#dfb780" strokeWidth="4" fill="none" initial={false} animate={{ d: phase === 'broken' ? 'M -17 -25 Q 42 0 -17 25' : 'M -17 -25 Q 32 0 -17 25' }} />
              <path d="M -17 -25 L -5 0 L -17 25 M -32 0 H 27 M 19 -6 L 28 0 L 19 6" stroke="#c88055" strokeWidth="2" fill="none" />
              <circle cx="0" cy="43" r="2" fill="#e6b778" />
            </motion.g>
            {!ready && <g className="fsw-finale-aim"><circle cx="720" cy="250" r="34" /><circle cx="720" cy="250" r="15" /><path d="M720 205v16 M720 279v16 M675 250h16 M749 250h16" /></g>}
            <path d={FLIGHT} className="fsw-finale-flight-guide" />
            {phase === 'flying' && <motion.path key={`trail-${run}`} d={FLIGHT} className="fsw-finale-flight-trail" initial={{ pathLength: 0, opacity: 0.7 }} animate={{ pathLength: 1, opacity: 0.25 }} transition={{ duration: 2, ease: [0.45, 0, 0.3, 1] }} />}
            <g filter={phase === 'repairing' ? `url(#${fluid})` : undefined}>
              {FRACTURES.map((piece, i) => <motion.g key={i} initial={false}
                animate={{ x: fixed ? 0 : piece.x, y: fixed ? 0 : piece.y, rotate: fixed ? 0 : piece.r, opacity: fixed ? 1 : 0.72 }}
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 105, damping: 18, delay: fixed ? Math.abs(i-4.5)*.045 : 0 }}
                style={{ originX: 0.5, originY: 0.5 }}>
                <g clipPath={`url(#${id}-piece-${i})`}><use href={`#${word}`} /></g>
              </motion.g>)}
            </g>
            {phase === 'flying' && <g ref={arrowNode} transform={flightTransform(0)}>
              <path d="M-67 0 H18 M7 -7 L20 0 L7 7 M-58 0 l-10 -7 M-58 0 l-10 7" stroke="#ffe7b1" strokeWidth="3" fill="none" />
              <rect x="-54" y="-29" width="63" height="20" rx="10" fill="#d3ac75" />
              <text className="fsw-finale-arrow-word" x="-22" y="-15" textAnchor="middle">FOCUS</text>
            </g>}
            {hit && <g key={`impact-${run}`}>
              {[0, 1, 2].map(i => <motion.circle key={i} cx="720" cy="250" className="fsw-finale-liquid-ring" initial={{ r: 6, opacity: 0.8 }} animate={{ r: 90+i*100, opacity: 0 }} transition={{ duration: 1.8, delay: i*.12, ease: 'easeOut' }} />)}
              <motion.circle cx="720" cy="250" r="16" fill="#ffe6b7" initial={{ opacity: .9, scale: .3 }} animate={{ opacity: 0, scale: 4 }} transition={{ duration: .65 }} style={{ transformOrigin: '720px 250px' }} />
            </g>}
          </g>
        </svg>
      </div>
      <motion.div className="fsw-finale-next" initial={false} animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 14 }}
        transition={{ duration: reduced ? 0 : .65 }} style={{ visibility: ready ? 'visible' : 'hidden' }}>
        <div className="fsw-finale-invitation"><p>A little focus. A new chapter.</p><h2>Who are you becoming?</h2><span>Choose something you’ve always wanted to learn.</span></div>
        <div className="fsw-finale-directions" aria-label="Explore courses on YouTube">
          {DIRECTIONS.map(({ name, detail, query, icon: Icon }) => <a key={name} href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">
            <Icon size={19} aria-hidden="true" /><span><strong>{name}</strong><small>{detail}</small></span><ArrowUpRight size={15} aria-hidden="true" />
          </a>)}
        </div>
      </motion.div>
      <div className="fsw-finale-baseline"><p>Make room for what matters.</p><a href="#main">Back to the beginning <ArrowUpRight size={15} aria-hidden="true" /></a></div>
      <span className="fsw-finale-sr" role="status">{ready ? 'FocusSpace is whole. Choose a learning direction below.' : 'A short animation: focus brings the scattered pieces together.'}</span>
    </section>
  );
}
