import { useEffect, useState } from 'react';
import { onLinkClick } from '../router';
import { InstallCta } from './InstallCta';

/**
 * Deliberately no "80,000,000+ users" badge. FocusSpace has not shipped, and
 * inventing social proof is the one thing on a launch page that can never be
 * walked back. The trust line below the buttons says true things instead.
 */
const TRUST = [
  'No API key to bring',
  'No account needed to start',
  'Your history never leaves your browser',
];

const HERO_MODES = [
  {
    name: 'DSA',
    image: '/hero-dsa.png',
  },
  {
    name: 'Web Development',
    image: '/hero-web-development.png',
  },
  {
    name: 'System Design',
    image: '/hero-system-design.png',
  },
  {
    name: 'Spanish',
    image: '/hero-spanish.png',
  },
];

export function Hero() {
  return (
    <section className="fsw-hero" id="install">
      <div className="fsw-hero-copy">
        <p className="fsw-eyebrow">Chrome extension · Free to start</p>

        <h1>
          YouTube, organised around{' '}
          <span className="fsw-grad">what you came for</span>
        </h1>

        <p className="fsw-lede">
          Tell FocusSpace what you are learning. Your home page becomes your
          own subscriptions ranked against that intention, the best of the
          wider YouTube woven in, and the attention traps gone. On a video it
          follows the course you are on and turns what you watched into notes
          and mind maps.
        </p>

        <div className="fsw-hero-cta">
          <InstallCta
            size="lg"
            withYouTube
            forVisitors={
              <a
                className="fsw-btn fsw-btn-ghost fsw-btn-lg"
                href="/pricing"
                onClick={onLinkClick('/pricing')}
              >
                See pricing
              </a>
            }
          />
        </div>

        <ul className="fsw-trust">
          {TRUST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <HeroProductPreview />
    </section>
  );
}

/**
 * Real FocusSpace product previews showing the extension across
 * different learning modes.
 *
 * The screenshots rotate automatically, while the mode buttons also
 * allow visitors to switch manually.
 */
function HeroProductPreview() {
  const [activeMode, setActiveMode] = useState(0);
  // Auto-rotation is an introduction, not a loop the visitor has to fight: the moment someone picks a
  // mode themselves, their choice is what stays on screen. Auto-advancing over a deliberate click is the
  // kind of thing that makes a page feel like a generic template rather than a product paying attention.
  const [autoplay, setAutoplay] = useState(true);

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => {
      setActiveMode((current) => (current + 1) % HERO_MODES.length);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [autoplay]);

  const pick = (index: number) => {
    setAutoplay(false);
    setActiveMode(index);
  };

  const mode = HERO_MODES[activeMode];

  return (
    <div className="fsw-preview fsw-real-product-preview">
      <div
        className="fsw-product-modes"
        role="tablist"
        aria-label="FocusSpace learning modes"
      >
        {HERO_MODES.map((item, index) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            aria-selected={index === activeMode}
            className={index === activeMode ? 'is-active' : ''}
            onClick={() => pick(index)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="fsw-product-image">
        <img
          key={mode.image}
          src={mode.image}
          alt={`FocusSpace ${mode.name} learning view`}
        />
      </div>
    </div>
  );
}