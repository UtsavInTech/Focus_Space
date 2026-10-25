import { useState } from 'react';
import { onLinkClick } from '../router';
import { InstallCta } from './InstallCta';
import { DEEP_HERO } from '../content/home';
import { nextTab } from '../tab-navigation';

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

        <p className="fsw-lede">{DEEP_HERO.intro}</p>

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

        <p className="fsw-hero-tagline">{DEEP_HERO.tagline}</p>
      </div>

      <HeroProductPreview />
    </section>
  );
}

/**
 * Real FocusSpace product previews showing the extension across
 * different learning modes.
 *
 * Visitors choose a capture with keyboard-operable tabs; screenshots remain still.
 */
function HeroProductPreview() {
  const [activeMode, setActiveMode] = useState(0);
  const pick = (index: number) => setActiveMode(index);

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
            id={`hero-space-${index}`}
            aria-controls="hero-space-panel"
            tabIndex={index === activeMode ? 0 : -1}
            onKeyDown={event => {
              const next = nextTab(event.key, index, HERO_MODES.length);
              if (next === null) return;
              event.preventDefault();
              pick(next);
              document.getElementById(`hero-space-${next}`)?.focus();
            }}
            aria-selected={index === activeMode}
            className={index === activeMode ? 'is-active' : ''}
            onClick={() => pick(index)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="fsw-product-image" id="hero-space-panel" role="tabpanel" aria-labelledby={`hero-space-${activeMode}`} tabIndex={0}>
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