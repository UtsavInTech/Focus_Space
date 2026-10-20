import { useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BrainCircuit, Code2, Languages, Layers, Music2 } from 'lucide-react';

const SPACES = [
  { id: 'feed', label: 'System Design', icon: Layers, caption: 'From Kafka to architecture. Give your next system a little structure.' },
  { id: 'japanese', label: 'Japanese', icon: Languages, caption: 'Grammar, conversations, and a whole new way to see the world.' },
  { id: 'web-development', label: 'Web Development', icon: Code2, caption: 'From your first JavaScript lesson to the things you want to build.' },
  { id: 'music', label: 'Music', icon: Music2, caption: 'Your favourites, your discoveries. A space to find your rhythm.' },
  { id: 'ai-ml', label: 'AI / ML', icon: BrainCircuit, caption: 'Follow your curiosity from machine learning foundations to AI engineering.' },
];

export function SpaceGallery() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const space = SPACES[active];

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? SPACES.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + SPACES.length) % SPACES.length;
    setActive(next);
    document.getElementById(`space-${SPACES[next].id}`)?.focus();
  };

  return <>
    <div className="fsl-space-topics" role="tablist" aria-label="Explore FocusSpace learning spaces">{SPACES.map((item, index) => <button type="button" role="tab" key={item.id} id={`space-${item.id}`} aria-selected={index === active} aria-controls="fsl-space-panel" tabIndex={index === active ? 0 : -1} onClick={() => setActive(index)} onKeyDown={e => onKey(e, index)}><item.icon size={16} />{item.label}</button>)}</div>
    <div id="fsl-space-panel" role="tabpanel" aria-labelledby={`space-${space.id}`}>
      <div className="fsl-feed-frame"><AnimatePresence mode="wait" initial={false}><motion.img key={space.id} src={`/light/${space.id}-1800.webp`} srcSet={`/light/${space.id}-800.webp 800w, /light/${space.id}-1800.webp 1800w`} sizes="(max-width: 700px) 94vw, 1200px" width={1800} height={1012} loading="lazy" decoding="async" alt={`FocusSpace ${space.label} space on YouTube`} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }} /></AnimatePresence></div>
      <div className="fsl-space-caption"><p aria-live="polite">{space.caption}</p><span>0{active + 1} / 0{SPACES.length}</span></div>
    </div>
  </>;
}
