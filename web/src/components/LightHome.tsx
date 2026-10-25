import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowRight, BookOpen, Check, MessageCircle, Network, Play, Plus, X } from 'lucide-react';
import { InstallCta } from './InstallCta';
import { ProductFilm } from './ProductFilm';
import { HeroWalls } from './HeroWalls';
import { HeroLouvres } from './HeroLouvres';
import { SpaceGallery } from './SpaceGallery';
import { EXAM_STORY, LIGHT_SPACE_COPY, QUIZ_COPY } from '../content/home';
import './cinema.css';
import './exam-story.css';

const SHOTS = [
  { id: 'ask', label: 'Ask anything', icon: MessageCircle, title: 'Stay curious. Stay in the video.', text: 'A concept didn’t click? Ask FocusSpace AI for an explanation or an example, right beside the lesson.' },
  { id: 'notes', label: 'Make notes', icon: BookOpen, title: 'Less pausing. More understanding.', text: 'Turn the current section, what you’ve watched, or the full video into notes. Choose English, Hindi, or Hinglish.' },
  { id: 'mindmap', label: 'Connect ideas', icon: Network, title: 'See the bigger picture.', text: 'Give a whole lesson a little structure. Explore an expandable mind map, open up a topic, and download it as SVG.' },
  { id: 'quiz', label: 'Quiz yourself', icon: Check, title: 'Make it stick.', text: QUIZ_COPY },
];

function ProductImage({ name, alt, eager = false }: { name: string; alt: string; eager?: boolean }) {
  return <img src={`/light/${name}-1800.webp`} srcSet={`/light/${name}-800.webp 800w, /light/${name}-1800.webp 1800w`} sizes="(max-width: 700px) 94vw, 1200px" width={1800} height={1012} alt={alt} loading={eager ? 'eager' : 'lazy'} {...{ fetchpriority: eager ? 'high' : 'auto' }} decoding="async" />;
}

export default function LightHome() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [filmPlaying, setFilmPlaying] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const expandTrigger = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const shot = SHOTS[active];

  useEffect(() => {
    if (reduced) return;
    // Native scrolling: no continuous animation ticker, wheel interception, or
    // full-resolution screenshots being scaled while the user scrolls.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('fsl-revealed');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px 40px 0px', threshold: 0 });
    root.current?.querySelectorAll('.fsl-section-head, .fsl-intro h2, .fsl-feature-details').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (!expanded) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = before; window.removeEventListener('keydown', onKey); expandTrigger.current?.focus(); };
  }, [expanded]);

  return <div className="fsl-home" ref={root}>
    <section className="fsl-hero-stage" id="install">
      <HeroWalls suspended={filmPlaying} paused={motionPaused} onPausedChange={setMotionPaused} />
      <div className="fsl-hero">
      <motion.div initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="fsl-hero-copy">
        <p className="fsl-eyebrow"><span /> A LITTLE INTENTION. A WHOLE NEW YOUTUBE.</p>
        <h1>Less rabbit hole.<br /><span>More possibility.</span></h1>
        <p className="fsl-hero-lede">Meet FocusSpace. Your corner of YouTube,<br className="fsl-desktop-break" /> made for what you came to learn.</p>
        <div className="fsl-actions"><InstallCta size="lg" /><a href="#features" className="fsl-text-link">Take a closer look <ArrowDown size={16} /></a></div>
        <p className="fsl-micro">A Chrome extension. A fresh way to learn.</p>
      </motion.div>
      <div className="fsl-hero-media">
        <span className="fsl-media-label"><span /> SEE THE DIFFERENCE. IN 43 SECONDS.</span>
        <HeroLouvres paused={motionPaused || filmPlaying}><ProductFilm onPlaybackChange={setFilmPlaying} /></HeroLouvres>
        <div className="fsl-image-caption"><span>From “just one more video” to “now I get it.”</span><span>THE FOCUSSPACE FILM</span></div>
      </div>
      </div>
      <div className="fsl-hero-note">
        <span>YOUR ATTENTION IS YOURS.</span>
        <blockquote>Make room for the person you’re becoming.</blockquote>
      </div>
    </section>

    <section className="fsl-intro" id="features">
      <p className="fsl-eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
      <h2><span className="fsl-story-line">You came to learn something.</span><br /><span className="fsl-story-line">Let’s keep it that way.</span></h2>
      <p>Your next skill is somewhere on YouTube. FocusSpace helps you find it, understand it, and hold on to it. All without leaving the place you already love to watch.</p>
      <div className="fsl-chapters"><a href="#spaces"><span>01</span> Find your focus <ArrowRight size={17} /></a><a href="#learn"><span>02</span> Go a little deeper <ArrowRight size={17} /></a><a href="#library"><span>03</span> Keep what clicks <ArrowRight size={17} /></a></div>
    </section>

    <section className="fsl-spaces" id="spaces">
      <div className="fsl-section-head"><div><p className="fsl-eyebrow">01 / FIND YOUR FOCUS</p><h2>A space for your<br />next big thing.</h2></div><p>{LIGHT_SPACE_COPY.intro}</p></div>
      <SpaceGallery />
      <div className="fsl-feature-details">{LIGHT_SPACE_COPY.details.map(item => <div key={item.title}><h3>{item.title}</h3><p>{item.text}</p></div>)}</div>
      <div className="fsl-exam-story">
        <div className="fsl-exam-intro"><p className="fsl-eyebrow">{EXAM_STORY.eyebrow}</p><h3>{EXAM_STORY.title}</h3><p>{EXAM_STORY.intro}</p></div>
        <ol className="fsl-exam-steps">{EXAM_STORY.steps.map((step, index) => <li key={step.title}><span aria-hidden="true">0{index + 1}</span><div><h4>{step.title}</h4><p>{step.text}</p></div></li>)}</ol>
        <div className="fsl-exam-figures">{EXAM_STORY.figures.map(figure => <figure key={figure.image}><div className="fsl-exam-shot"><ProductImage name={figure.image} alt={figure.alt} /></div><figcaption>{figure.caption}</figcaption></figure>)}</div>
        <p className="fsl-exam-note">{EXAM_STORY.note}</p>
      </div>
    </section>

    <section className="fsl-learn" id="learn">
      <div className="fsl-section-head"><div><p className="fsl-eyebrow">02 / GO A LITTLE DEEPER</p><h2>From watching.<br /><span>To understanding.</span></h2></div><p>A thoughtful learning companion.<br />Right beside every lesson.</p></div>
      <div className="fsl-tool-tabs" role="tablist" aria-label="Explore learning tools">{SHOTS.map((item, index) => <button type="button" key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={index === active} aria-controls="fsl-tool-panel" tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? SHOTS.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + SHOTS.length) % SHOTS.length; setActive(next); document.getElementById(`tab-${SHOTS[next].id}`)?.focus(); } }}><item.icon size={17} />{item.label}</button>)}</div>
      <div id="fsl-tool-panel" role="tabpanel" aria-labelledby={`tab-${shot.id}`} className="fsl-tool-panel">
        <AnimatePresence mode="wait"><motion.div key={shot.id} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}><div className="fsl-tool-image"><ProductImage name={shot.id} alt={`FocusSpace ${shot.label} tool in use beside a YouTube system design lesson`} /><button type="button" className="fsl-expand" aria-label="Enlarge product screenshot" ref={expandTrigger} onClick={() => setExpanded(true)}><Plus size={22} /></button></div><div className="fsl-tool-caption"><h3>{shot.title}</h3><p>{shot.text}</p></div></motion.div></AnimatePresence>
      </div>
    </section>

    <section className="fsl-notes-story"><div><p className="fsl-eyebrow">A NEW PERSPECTIVE</p><h2>Big ideas.<br />Beautifully<br /><span>connected.</span></h2><p>Turn a long lesson into a map you can explore. Follow a branch. Connect a thought. Come back when you need a refresher.</p><button type="button" className="fsl-text-link" onClick={() => { setActive(2); document.getElementById('learn')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); }}>Explore mind maps <ArrowRight size={17} /></button></div><div className="fsl-map-detail"><ProductImage name="mindmap" alt="Expandable mind map connecting system design concepts including API gateways, guardrails and semantic cache" /></div></section>

    <section className="fsl-library" id="library"><div className="fsl-section-head"><div><p className="fsl-eyebrow">03 / KEEP WHAT CLICKS</p><h2>Pick up where<br />curiosity left off.</h2></div><p>Your Spaces. Your saved notes.<br />Your next “aha.”<br />A home for your learning.</p></div><div className="fsl-dashboard-frame"><ProductImage name="home" alt="FocusSpace home dashboard with learning spaces, continue watching, saved notes, mind maps and AI chats" /></div><p className="fsl-library-caption">The good stuff stays with you. <span>Return to your videos, notes, mind maps, and conversations in your FocusSpace library.</span></p></section>

    <section className="fsl-finale"><div className="fsl-play-mark"><Play fill="currentColor" size={27} /></div><p className="fsl-eyebrow">SAME YOUTUBE. NEW POSSIBILITIES.</p><h2>A little more focus.<br />A lot more you.</h2><p>Make space for the things you want to learn.</p><div className="fsl-actions"><InstallCta size="lg" /></div><span className="fsl-micro">Start with a Space. See where it takes you.</span></section>
    {expanded && <div className="fsl-lightbox" role="dialog" aria-modal="true" aria-label={`${shot.label} product screenshot`} data-lenis-prevent onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}><button ref={close} type="button" aria-label="Close screenshot" onClick={() => setExpanded(false)}><X size={24} /></button><ProductImage name={shot.id} alt={`${shot.label} expanded product screenshot`} eager /></div>}
  </div>;
}
