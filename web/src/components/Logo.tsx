/**
 * The FocusSpace mark: concentric rings narrowing onto a single point — the
 * product's whole idea in one glyph. Inline SVG rather than an image file so
 * it inherits `currentColor` and stays sharp in both themes.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13.5" stroke="currentColor" strokeWidth="1.5" opacity="0.28" />
      <circle cx="16" cy="16" r="8.5" stroke="currentColor" strokeWidth="1.75" opacity="0.6" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
    </svg>
  );
}
