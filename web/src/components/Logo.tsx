/**
 * The FocusSpace mark, identical in geometry to the extension's
 * (src/ui/components/primitives.tsx): a target — outer ring, crosshair ticks, inner ring — with a play
 * triangle at its centre. Aim at one thing, then watch it.
 *
 * The two copies are deliberate and the shape is kept in step by hand: the site and the extension share
 * no bundle, and importing across that boundary would drag the extension's whole primitives module into
 * the marketing build for one glyph.
 *
 * `tone="brand"` is FocusSpace red and the default; `tone="current"` inherits `currentColor` for the
 * places that need it monochrome — white on a dark or coloured surface.
 */
export function Logo({
  size = 28,
  tone = 'brand',
  animated = false,
}: {
  size?: number;
  tone?: 'brand' | 'current';
  /**
   * The living version, for the nav: the outer ring (with its ticks) and the inner ring turn slowly in
   * opposite directions — a sight settling on its target — and the play triangle spins in once and
   * lands. Remount it to replay the spin. Everything stops under prefers-reduced-motion (site.css).
   */
  animated?: boolean;
}) {
  return (
    <svg
      className={animated ? 'fsw-logo is-animated' : 'fsw-logo'}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      style={{ color: tone === 'brand' ? 'var(--fs-brand)' : undefined }}
      aria-hidden="true"
      focusable="false"
    >
      <g className="fsw-logo-outer">
        <circle cx="16" cy="16" r="12.6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.75">
          <path d="M16 2v6" />
          <path d="M16 24v6" />
          <path d="M2 16h6" />
          <path d="M24 16h6" />
        </g>
      </g>
      <circle className="fsw-logo-inner" cx="16" cy="16" r="8.4" stroke="currentColor" strokeWidth="1.7" />
      {/* The wrapper takes the spin, so the path keeps its own nudge: a CSS transform would replace it. */}
      <g className="fsw-logo-play">
        {/* Optically centred: a triangle's visual centre sits left of its bounding box, hence the nudge. */}
        <path d="M13.2 11.5v9a.85.85 0 0 0 1.31.72l6.9-4.5a.85.85 0 0 0 0-1.44l-6.9-4.5a.85.85 0 0 0-1.31.72Z" fill="currentColor" transform="translate(-0.9 0)" />
      </g>
    </svg>
  );
}

/**
 * "FocusSpace": "Focus" in the surface's own text colour, "Space" in the brand red. Text rather than an
 * image, so it takes the page's font, scales with it, and is still selectable and read aloud as one word.
 */
/**
 * The signature under the name: "Intent-driven learning" in the nav, where space is tight, and the full
 * "Intent-driven learning for YouTube" wherever there is room for it, as in the logo.
 */
export function Wordmark({ tagline = false }: { tagline?: boolean | 'short' }) {
  return (
    <span className="fsw-wordmark">
      <span className="fsw-wordmark-name">
        Focus<span className="fsw-wordmark-accent">Space</span>
      </span>
      {tagline && <span className="fsw-wordmark-tagline">{tagline === 'short' ? 'Intent-driven learning' : 'Intent-driven learning for YouTube'}</span>}
    </span>
  );
}
