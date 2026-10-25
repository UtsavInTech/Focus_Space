import { useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Atom, Code2, GraduationCap, Languages, Layers, Music2 } from 'lucide-react';
import { SPACE_GALLERY } from '../content/home';

const SPACES = SPACE_GALLERY;
const ICONS = { exam: GraduationCap, science: Atom, code: Code2, layers: Layers, language: Languages, music: Music2 };

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
    <div className="fsl-space-topics" role="tablist" aria-label="Explore FocusSpace learning spaces">{SPACES.map((item, index) => { const Icon = ICONS[item.icon]; return <button type="button" role="tab" key={item.id} id={`space-${item.id}`} aria-selected={index === active} aria-controls="fsl-space-panel" tabIndex={index === active ? 0 : -1} onClick={() => setActive(index)} onKeyDown={e => onKey(e, index)}><Icon size={16} aria-hidden="true" />{item.label}</button>; })}</div>
    <div id="fsl-space-panel" role="tabpanel" aria-labelledby={`space-${space.id}`}>
      <div className="fsl-gallery-context"><p aria-live="polite">{space.caption}</p>{space.outline.length > 0 && <ol aria-label={`${space.label} learning map example`}>{space.outline.map(part => <li key={part}>{part}</li>)}</ol>}</div>
      <p className="fsl-gallery-image-label">{space.imageLabel}</p>
      <div className="fsl-feed-frame"><AnimatePresence mode="wait" initial={false}><motion.img key={space.image} src={`/light/${space.image}-1800.webp`} srcSet={`/light/${space.image}-800.webp 800w, /light/${space.image}-1800.webp 1800w`} sizes="(max-width: 700px) 94vw, 1200px" width={1800} height={1012} loading="lazy" decoding="async" alt={space.imageAlt} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }} /></AnimatePresence></div>
      <div className="fsl-space-caption"><p>{space.label}</p><span>0{active + 1} / 0{SPACES.length}</span></div>
    </div>
  </>;
}
