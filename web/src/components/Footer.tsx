import { onLinkClick } from '../router';
import { Logo, Wordmark } from './Logo';
import { Sparkle } from './Sparkle';

export function Footer() {
  return (
    <footer className="fsw-footer">
      <div className="fsw-footer-inner">
        <div className="fsw-footer-brand">
          <a className="fsw-brand" href="/" onClick={onLinkClick('/')}>
            {/* Alive as in the nav: the rings turn, the name sparkles, the ring gets no sparks. */}
            <Logo size={24} animated />
            <span className="fsw-brand-word">
              <Wordmark />
              <Sparkle from="text" rate={4} />
            </span>
          </a>
          <p>YouTube has the content. FocusSpace gives it structure.</p>
        </div>

        <nav aria-label="Product">
          <h4>Product</h4>
          <a href="/#features" onClick={onLinkClick('/#features')}>Features</a>
          <a href="/pricing" onClick={onLinkClick('/pricing')}>Pricing</a>
          <a href="/#faq" onClick={onLinkClick('/#faq')}>FAQ</a>
        </nav>

        <nav aria-label="Legal">
          <h4>Legal</h4>
          <a href="/data" onClick={onLinkClick('/data')}>Your data</a>
          <a href="/privacy" onClick={onLinkClick('/privacy')}>Privacy</a>
          <a href="/terms" onClick={onLinkClick('/terms')}>Terms</a>
          <a href="/refunds" onClick={onLinkClick('/refunds')}>Refunds</a>
          <a href="/contact" onClick={onLinkClick('/contact')}>Contact</a>
        </nav>
      </div>
      <p className="fsw-footer-legal">
        © {new Date().getFullYear()} FocusSpace. Not affiliated with, endorsed by, or connected to YouTube or Google.
      </p>
    </footer>
  );
}
