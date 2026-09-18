import { onLinkClick } from '../router';

/**
 * Deliberately no "80,000,000+ users" badge. FocusSpace has not shipped, and
 * inventing social proof is the one thing on a launch page that can never be
 * walked back. The trust line below the buttons says true things instead.
 */
const TRUST = ['No API key to bring', 'No account needed to start', 'Your history never leaves your browser'];

export function Hero() {
  return (
    <section className="fsw-hero" id="install">
      <div className="fsw-hero-copy">
        <p className="fsw-eyebrow">Chrome extension · Free to start</p>
        <h1>
          YouTube, organised around <span className="fsw-grad">what you came for</span>
        </h1>
        <p className="fsw-lede">
          Tell FocusSpace what you are learning. Your home page becomes your own subscriptions ranked against that
          intention, the best of the wider YouTube woven in, and the attention traps gone. On a video it follows the
          course you are on and turns what you watched into notes and mind maps.
        </p>

        <div className="fsw-hero-cta">
          <a className="fsw-btn fsw-btn-primary fsw-btn-lg" href="/#install" onClick={onLinkClick('/#install')}>
            Add to Chrome — Free
          </a>
          <a className="fsw-btn fsw-btn-ghost fsw-btn-lg" href="/pricing" onClick={onLinkClick('/pricing')}>
            See pricing
          </a>
        </div>

        <ul className="fsw-trust">
          {TRUST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <FeedPreview />
    </section>
  );
}

/**
 * A stylised preview of the rebuilt YouTube home — an illustration, not a
 * screenshot, and drawn in markup so it stays sharp and themed. The tier
 * labels are the extension's real vocabulary (docs/RELEVANCE.md).
 */
function FeedPreview() {
  const rows = [
    { title: 'Linked List — full lecture', channel: 'Apna College', tier: 'Excellent match', tone: 'best' },
    { title: 'Recursion, properly explained', channel: 'CodeWithHarry', tier: 'Strong match', tone: 'good' },
    { title: 'DSA sheet walkthrough · L6', channel: 'take U forward', tier: 'Strong match', tone: 'good' },
    { title: 'From YouTube · Trees in 40 min', channel: 'Abdul Bari', tier: 'Best match we found', tone: 'discovery' },
  ];

  return (
    <div className="fsw-preview" aria-hidden="true">
      <div className="fsw-preview-bar">
        <span className="fsw-preview-dot" />
        <span className="fsw-preview-dot" />
        <span className="fsw-preview-dot" />
        <span className="fsw-preview-url">youtube.com</span>
      </div>
      <div className="fsw-preview-body">
        <div className="fsw-preview-chips">
          <span className="is-active">DSA</span>
          <span>Arrays</span>
          <span>Linked Lists</span>
          <span>Trees</span>
        </div>
        <p className="fsw-preview-label">Continue watching</p>
        <div className="fsw-preview-resume">
          <div className="fsw-preview-thumb" />
          <div>
            <strong>Insert in a Linked List</strong>
            <span>▶ you are here · 18:20 of 48:50 · next unwatched: Display/Print</span>
          </div>
        </div>
        <p className="fsw-preview-label">From your subscriptions</p>
        {rows.map((row) => (
          <div className="fsw-preview-row" key={row.title}>
            <div className="fsw-preview-thumb" />
            <div>
              <strong>{row.title}</strong>
              <span>{row.channel}</span>
            </div>
            <em className={`fsw-tier is-${row.tone}`}>{row.tier}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
