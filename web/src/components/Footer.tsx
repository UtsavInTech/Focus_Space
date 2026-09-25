import { onLinkClick } from '../router';
import { Logo, Wordmark } from './Logo';

export function Footer() {
  return (
    <footer className="fsw-footer">
      <div className="fsw-footer-inner">
        <div className="fsw-footer-brand">
          <a className="fsw-brand" href="/" onClick={onLinkClick('/')}>
            <Logo size={24} />
            <Wordmark />
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
          <a href="/privacy#your-data" onClick={onLinkClick('/privacy#your-data')}>Your data</a>
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
