import { useEffect, useState } from 'react';
import { onLinkClick } from '../router';
import { InstallCta } from './InstallCta';

/**
 * Deliberately no "80,000,000+ users" badge. FocusSpace has not shipped, and
 * inventing social proof is the one thing on a launch page that can never be
 * walked back. What happens to a visitor's data has its own page (/data).
 */
const HERO_MODES = [
  {
    name: 'DSA',
    image: 'hero-dsa',
  },
  {
    name: 'Web Development',
    image: 'hero-web-development',
  },
  {
    name: 'System Design',
    image: 'hero-system-design',
  },
  {
    name: 'Spanish',
    image: 'hero-spanish',
  },
];

export function Hero() {
  return (
    <section className="fsw-hero" id="install">
      <div className="fsw-hero-copy">
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

        {/* What sets it apart, in one line: it learns the learner, and the learner shapes it. */}
        <p className="fsw-hero-tagline">
          YouTube that learns how you prefer to learn. <span>Add your own personal touch.</span>
        </p>
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
        {/* WebP at two widths (web/public/<name>-1600|900.webp): the screenshot is the largest thing on the
            page, and a phone should not download the desktop copy. The width and height stop the column
            jumping when it arrives; the first one is the page's main image, so it is fetched first and
            decoded without delay (no decoding="async" here). */}
        <img
          key={mode.image}
          src={`/${mode.image}-1600.webp`}
          srcSet={`/${mode.image}-900.webp 900w, /${mode.image}-1600.webp 1600w`}
          sizes="(max-width: 880px) 92vw, 560px"
          width={1600}
          height={900}
          fetchPriority={activeMode === 0 ? 'high' : 'auto'}
          alt={`FocusSpace ${mode.name} learning view`}
        />
      </div>
    </div>
  );
}