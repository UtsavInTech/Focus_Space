import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUpRight, BrainCircuit, Check, Code2, Languages, Layers, Play } from 'lucide-react';
import { Logo } from './Logo';
import { InstallCta } from './InstallCta';
import './brand-finale.css';

const DIRECTIONS = [
  { name: 'System Design', detail: 'Build things that scale.', subject: 'Think in systems.', query: 'system design full course', icon: Layers, code: '01' },
  { name: 'Web Development', detail: 'Make your ideas real.', subject: 'Make something yours.', query: 'web development full course', icon: Code2, code: '02' },
  { name: 'AI / ML', detail: 'Understand what’s next.', subject: 'Follow the next question.', query: 'machine learning full course', icon: BrainCircuit, code: '03' },
  { name: 'Japanese', detail: 'Open up a new world.', subject: 'See the world differently.', query: 'Japanese beginner full course', icon: Languages, code: '04' },
];
const SETTLE = { type: 'spring' as const, stiffness: 95, damping: 21, mass: 1.1 };

/** Canva's focus-lens concept, implemented as responsive, native Motion components. */
export function BrandFinale() {
  const root = useRef<HTMLElement>(null);
  const seen = useInView(root, { once: true, amount: .22 });
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const selected = DIRECTIONS[active];
  const SelectedIcon = selected.icon;
  const settled = !!reduced || focused;

  useEffect(() => {
    if (!seen || reduced) return;
    const timer = setTimeout(() => setFocused(true), 1450);
    return () => clearTimeout(timer);
  }, [seen, reduced]);

  const choose = (index: number) => { setActive(index); setFocused(true); };

  return (
    <section id="signature" ref={root} className="fsw-focus-ending" aria-labelledby="fsw-ending-title" data-settled={settled}>
      <div className="fsw-ending-topline"><span><i /> A LITTLE INTENTION. A NEW DIRECTION.</span><span>THE NEXT CHAPTER / 04</span></div>
      <div className="fsw-ending-composition">
        <div className="fsw-ending-copy">
          <p className="fsw-ending-overline">You’ve got places to go.</p>
          <h2 id="fsw-ending-title">Make room for<br />who you’re<br /><em>becoming.</em></h2>
          <p className="fsw-ending-description">The next skill. The new perspective. The thing you keep meaning to learn. Give it a little space.</p>
          <div className="fsw-ending-actions"><InstallCta label="Add to Chrome — free" size="lg" /><a href="#fsw-ending-directions">Find your next thing <ArrowDown size={14} aria-hidden="true" /></a></div>
          <span className="fsw-ending-footnote">Your YouTube. With a little more intention.</span>
        </div>

        <div className="fsw-ending-visual" aria-label="Scattered learning topics finding their focus">
          <span className="fsw-ending-coordinate is-top">A PLACE FOR YOUR CURIOSITY</span>
          <svg className="fsw-ending-guides" viewBox="0 0 560 470" fill="none" aria-hidden="true">
            <path d="M28 44h16M28 44v16M532 44h-16M532 44v16M28 426h16M28 426v-16M532 426h-16M532 426v-16" />
            <circle cx="285" cy="225" r="161" strokeDasharray="2 8" />
            <path d="M285 44v24M285 382v44M28 225h24M508 225h24" />
            <motion.path d="M530 225H285" className="fsw-ending-beam" initial={false} animate={{ pathLength: seen || reduced ? 1 : 0, opacity: settled ? .18 : .9 }} transition={{ pathLength: { duration: reduced ? 0 : 1.2, delay: .2 }, opacity: { duration: .8 } }} />
            <motion.circle cx="285" cy="225" className="fsw-ending-ripple" initial={false} animate={{ r: settled ? 156 : 60, opacity: settled ? 0 : .4 }} transition={{ duration: reduced ? 0 : 1.4, ease: 'easeOut' }} />
          </svg>
          <motion.div className="fsw-ending-lens" aria-hidden="true" initial={false}
            animate={{ rotate: settled ? 0 : -18, scale: settled ? 1 : .94 }} transition={reduced ? { duration: 0 } : SETTLE}>
            <div className="fsw-ending-lens-edge"><div className="fsw-ending-lens-face"><div className="fsw-ending-lens-inner"><Logo size={82} tone="current" /></div></div></div>
            <span className="fsw-ending-lens-tick is-one" /><span className="fsw-ending-lens-tick is-two" />
          </motion.div>
          <motion.div className="fsw-ending-float is-system" initial={false} animate={{ x: settled ? 0 : -17, y: settled ? 0 : -13, rotate: settled ? -6 : -13, opacity: settled ? .8 : .6 }} transition={reduced ? { duration: 0 } : SETTLE} aria-hidden="true"><Layers /><span>System Design<small>Think bigger.</small></span></motion.div>
          <motion.div className="fsw-ending-float is-japanese" initial={false} animate={{ x: settled ? 0 : 19, y: settled ? 0 : -16, rotate: settled ? 7 : 15, opacity: settled ? .8 : .6 }} transition={reduced ? { duration: 0 } : { ...SETTLE, delay: .1 }} aria-hidden="true"><Languages /><span>Japanese<small>A new perspective.</small></span></motion.div>
          <motion.div className="fsw-ending-float is-ai" initial={false} animate={{ x: settled ? 0 : 18, y: settled ? 0 : 20, rotate: settled ? 5 : 13, opacity: settled ? .7 : .5 }} transition={reduced ? { duration: 0 } : { ...SETTLE, delay: .15 }} aria-hidden="true"><BrainCircuit /><span>AI / ML<small>Stay curious.</small></span></motion.div>
          <motion.div className="fsw-ending-learning-card" initial={false} animate={{ y: settled ? 0 : 18, rotate: settled ? -3 : -7, opacity: settled ? 1 : .6 }} transition={reduced ? { duration: 0 } : { ...SETTLE, delay: .2 }}>
            <span className="fsw-ending-card-label"><i /> YOUR NEXT CHAPTER <Check size={12} aria-hidden="true" /></span>
            <AnimatePresence mode="wait" initial={false}><motion.div key={selected.name} className="fsw-ending-card-content" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .16 }}><SelectedIcon size={23} aria-hidden="true" /><strong>{selected.name}</strong><span>{selected.subject}</span></motion.div></AnimatePresence>
            <div className="fsw-ending-card-bottom"><span><Play size={10} fill="currentColor" aria-hidden="true" /> One good place to begin.</span><ArrowUpRight size={13} aria-hidden="true" /></div>
          </motion.div>
          <span className="fsw-ending-visual-caption"><i /> FROM SCATTERED TO SOMETHING THAT MATTERS.</span>
        </div>
      </div>

      <div className="fsw-ending-directions" id="fsw-ending-directions">
        <div className="fsw-ending-directions-heading"><p>Who are you becoming?</p><a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(selected.query)}`} target="_blank" rel="noreferrer">Explore {selected.name} <ArrowUpRight size={14} aria-hidden="true" /></a></div>
        <div className="fsw-ending-choices" role="group" aria-label="Choose your next learning direction">
          {DIRECTIONS.map(({ name, detail, icon: Icon, code }, i) => <button key={name} type="button" aria-pressed={active === i} onClick={() => choose(i)}><span className="fsw-ending-choice-code">{code}</span><span className="fsw-ending-choice-content"><Icon size={19} aria-hidden="true" /><strong>{name}</strong><small>{detail}</small></span><ArrowUpRight size={16} className="fsw-ending-choice-arrow" aria-hidden="true" />{active === i && <motion.span className="fsw-ending-choice-line" layoutId="ending-choice" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 30 }} />}</button>)}
        </div>
      </div>
    </section>
  );
}
