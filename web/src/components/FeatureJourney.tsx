import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import { FEATURES, JOURNEY_INTRO, STAGES, type Shot } from '../content/features';
import { Starfield } from './Starfield';

/**
 * The features as the course a learner actually takes: before pressing play, while watching, when
 * revising.
 *
 * On wide screens the steps scroll on the left while, pinned on the right, every screenshot of the
 * extension turns on a shared spine — one whole page each, continuously, on its own clock rather than the
 * scroll's, so the product is always moving beside the words describing it. A line down the left of the
 * steps fills as you read, at every width. On narrow screens there is no room for the pages: each step
 * shows its own screenshots inline instead.
 */

const PAGES: Shot[] = FEATURES.flatMap((f) => f.shots);

const src = (name: string, width: 560 | 960) => `/journey/${name}-${width}.webp`;
const srcSet = (name: string) => `${src(name, 560)} 560w, ${src(name, 960)} 960w`;

export function FeatureJourney() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(FEATURES[0].id);

  // One scroll handler: which step spans the middle of the viewport, and how far down the section the
  // reader is — for the marked step and the line. Written straight to a CSS variable; React only hears
  // about it when the step actually changes.
  const activeRef = useRef(active);
  /** How far through the steps the reader is, 0–1 — the line's length, and how full the sky is. */
  const progressRef = useRef(0);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const steps = [...body.querySelectorAll<HTMLElement>('[data-step]')];
    let frame = 0;

    const measure = () => {
      frame = 0;
      const reading = window.innerHeight * 0.5;
      const bodyRect = body.getBoundingClientRect();
      let index = 0;
      while (index + 1 < steps.length && steps[index + 1].getBoundingClientRect().top <= reading) index++;
      progressRef.current = Math.min(1, Math.max(0, (reading - bodyRect.top) / bodyRect.height));
      body.style.setProperty('--fsw-journey-progress', progressRef.current.toFixed(4));

      const id = steps[index].getAttribute('data-step')!;
      if (id !== activeRef.current) {
        activeRef.current = id;
        setActive(id);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const activeIndex = FEATURES.findIndex((f) => f.id === active);

  return (
    <section className="fsw-section fsw-journey" id="features">
      <Starfield progress={progressRef} />
      <div className="fsw-section-head" data-reveal>
        <h2>{JOURNEY_INTRO.title}</h2>
        <p>{JOURNEY_INTRO.text}</p>
      </div>

      <div className="fsw-journey-body" ref={bodyRef}>
        <ol className="fsw-journey-steps">
          {FEATURES.map((f, i) => (
            <li
              key={f.id}
              id={`feature-${f.id}`}
              className="fsw-journey-step"
              data-step={f.id}
              data-reveal
              data-state={i === activeIndex ? 'current' : i < activeIndex ? 'past' : 'ahead'}
            >
              <p className="fsw-journey-meta">
                <span className="fsw-journey-num" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>
                  {STAGES[f.stage]} · {f.label}
                </span>
              </p>
              <h3>{f.headline}</h3>
              <p className="fsw-journey-text">{f.body}</p>
              <ul className="fsw-journey-points">
                {f.points.map((point, j) => (
                  <li key={point} data-reveal style={{ '--fsw-reveal-delay': `${120 + j * 70}ms` } as CSSProperties}>
                    {point}
                  </li>
                ))}
              </ul>

              {/* Narrow screens only: this step's pages, as plain screenshots. */}
              {f.shots.length > 0 && (
                <div className={`fsw-journey-shots${f.shots.length > 1 ? ' is-row' : ''}`}>
                  {f.shots.map((shot) => (
                    <figure key={shot.name} className="fsw-journey-shot">
                      <img src={src(shot.name, 560)} srcSet={srcSet(shot.name)} sizes="92vw" alt={shot.alt} loading="lazy" decoding="async" />
                      <figcaption>{shot.caption}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>

        <PageTurn />
      </div>
    </section>
  );
}

/*
 * A book, open in a box, turning its own pages.
 *
 * The book lies open in a V: a left and a right page that never move, with the thickness of the pages
 * beneath them showing at the edges. Between them LEAVES leaves turn, continuously and evenly spaced, from
 * lying on the right page to lying on the left. Like a real leaf, each carries two different
 * screenshots — one on its front, the next on its back — so turning it reveals a new spread: the page
 * just turned on the left, the next page waiting on the right.
 *
 * Four leaves carry all eight screenshots in order by being reused: a leaf fades out as it settles on the
 * left and, while it is out of sight, takes the next two screenshots before it rises again on the right.
 * So the book reads 01 → 08 and starts over, and no screenshot is ever on screen twice.
 */
const LEAVES = 4;
const SECONDS_PER_TURN = 3;
const CYCLE_MS = LEAVES * SECONDS_PER_TURN * 1000;
/** How far the open pages lie off flat: the right page at -OPEN, the left at -180 + OPEN. */
const OPEN = 24;
/** A leaf on the right is the page being looked at until it lifts nearly edge-on (cos 78° ≈ a fifth of its width). */
const OPEN_LIMIT = -78;
/** How much of its travel, at each end, a leaf spends fading in or out over the open pages. */
const FADE = 0.12;

function PageTurn() {
  const stageRef = useRef<HTMLDivElement>(null);
  /** The page arriving on the right, as an index into PAGES — the one the caption names. */
  const [right, setRight] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const playingRef = useRef(playing);
  const hoverRef = useRef(false);
  const wakeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    playingRef.current = playing;
    wakeRef.current();
  }, [playing]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const leaves = [...stage.querySelectorAll<HTMLElement>('[data-leaf]')];
    // NaN, not -1: passes before the first are negative, and -1 is a real one.
    const carried = leaves.map(() => NaN);
    // Start with the leaf carrying page 01 standing on the right, just before it turns.
    let elapsed = 0.4 * CYCLE_MS;
    let last = 0;
    let frame = 0;
    let visible = false;
    let named = -1;
    let fetched = false;

    /** Give a leaf the two screenshots of its pass through the book: page 2q on the front, 2q + 1 behind. */
    const dress = (leaf: HTMLElement, pass: number) => {
      const imgs = leaf.querySelectorAll('img');
      [2 * pass, 2 * pass + 1].forEach((n, k) => {
        const shot = PAGES[((n % PAGES.length) + PAGES.length) % PAGES.length];
        const img = imgs[k];
        img.srcset = srcSet(shot.name);
        img.src = src(shot.name, 560);
      });
    };

    const place = () => {
      const turn = elapsed / CYCLE_MS;
      // The right-hand page of the spread: the front of the top leaf on the right. Once a leaf lifts nearly
      // edge-on it shows little of itself, and the page it is uncovering is the one being looked at.
      let topRight = { angle: Infinity, pass: 0 };
      leaves.forEach((leaf, i) => {
        const along = turn - i / LEAVES;
        const phase = ((along % 1) + 1) % 1;
        // Which pass through the book this is, counted across all leaves in the order they enter.
        const pass = Math.floor(along) * LEAVES + i;
        if (pass !== carried[i]) {
          carried[i] = pass;
          dress(leaf, pass);
        }
        const angle = -OPEN - phase * (180 - 2 * OPEN);
        leaf.style.setProperty('--a', angle.toFixed(2));
        // Darker as it stands edge-on to the light; lit when lying open.
        leaf.style.setProperty('--shade', (Math.sin(((angle + 180) * Math.PI) / 180) ** 3 * 0.22).toFixed(3));
        // On the faces, not the leaf: opacity below 1 on a 3D element flattens it in Chrome, which turns off
        // backface hiding and would show a mirrored screenshot through the back of a fading leaf.
        leaf.style.setProperty('--fade', Math.min(1, phase / FADE, (1 - phase) / FADE).toFixed(3));
        // Leaves never cross except at the spine, so the one standing tallest is simply in front.
        leaf.style.zIndex = String(200 - Math.round(Math.abs(angle + 90)));
        if (angle >= OPEN_LIMIT && angle < topRight.angle) topRight = { angle, pass };
      });
      const next = ((2 * topRight.pass) % PAGES.length + PAGES.length) % PAGES.length;
      if (next !== named) {
        named = next;
        setRight(next);
      }
    };

    const tick = (now: number) => {
      frame = 0;
      // A long gap (a background tab, a pause) resumes where it left off rather than jumping ahead.
      if (last) elapsed += Math.min(64, now - last);
      last = now;
      place();
      wake();
    };
    const wake = () => {
      const running = visible && playingRef.current && !hoverRef.current;
      if (running && !frame) frame = requestAnimationFrame(tick);
      if (!running) {
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
      }
    };
    wakeRef.current = wake;

    place();
    // Nothing turns while the book is off screen — and the screenshots are fetched once it is near.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !fetched) {
          fetched = true;
          PAGES.forEach((shot) => (new Image().src = src(shot.name, 560)));
        }
        wake();
      },
      { rootMargin: '200px 0px' },
    );
    io.observe(stage);
    const enter = () => {
      hoverRef.current = true;
      wake();
    };
    const leave = () => {
      hoverRef.current = false;
      wake();
    };
    stage.addEventListener('pointerenter', enter);
    stage.addEventListener('pointerleave', leave);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointerenter', enter);
      stage.removeEventListener('pointerleave', leave);
      wakeRef.current = () => undefined;
    };
  }, []);

  return (
    <div className="fsw-book-wrap">
      <div className="fsw-book-box">
        <div className="fsw-book" ref={stageRef} role="img" aria-label={`A book of FocusSpace screenshots, turning its pages: ${PAGES.map((p) => p.caption).join('; ')}.`}>
          <div className="fsw-book-spine">
            <div className="fsw-book-cover is-left" aria-hidden="true" />
            <div className="fsw-book-cover is-right" aria-hidden="true" />
            {Array.from({ length: LEAVES }, (_, i) => (
              <div key={i} className="fsw-book-leaf" data-leaf={i} aria-hidden="true">
                <div className="fsw-book-face is-front">
                  <img alt="" decoding="async" sizes="300px" />
                </div>
                <div className="fsw-book-face is-back">
                  <img alt="" decoding="async" sizes="300px" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="fsw-book-caption">
          <span className="fsw-book-count">
            {/* One page, not a spread: with several leaves in the air, the page open on the left is not the one
                before it. */}
            {String(right + 1).padStart(2, '0')} <span>/ {String(PAGES.length).padStart(2, '0')}</span>
          </span>
          <span className="fsw-book-title" aria-hidden="true">
            {PAGES[right].caption}
          </span>
          {/* Anything that moves on its own for more than five seconds needs a way to stop it (WCAG 2.2.2). */}
          <button type="button" className="fsw-book-toggle" aria-pressed={!playing} aria-label={playing ? 'Pause the turning pages' : 'Play the turning pages'} onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
