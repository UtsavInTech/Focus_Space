import { useEffect, useState } from 'react';
import { onLinkClick, usePath } from '../router';
import { useAuth } from '../auth';
import { Logo, Wordmark } from './Logo';
import { InstallCta } from './InstallCta';
import { Sparkle } from './Sparkle';

const LINKS = [
  { label: 'Features', to: '/#features' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'FAQ', to: '/#faq' },
  // Where a visitor's data lives, and what removing the extension deletes (DataPage.tsx).
  { label: 'Data', to: '/data' },
];

export function SiteNav() {
  const auth = useAuth();
  const path = usePath();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`fsw-nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="fsw-nav-inner">
        <a className="fsw-brand" href="/" onClick={onLinkClick('/')}>
          {/* Keyed on the route: the nav persists across pages, so remounting is what replays the spin-in. */}
          <Logo key={path} animated />
          {/* The sparks belong to the name, not the ring: the ring has its own motion. */}
          <span className="fsw-brand-word">
            <Wordmark />
            <Sparkle from="text" rate={5} />
          </span>
        </a>

        <nav className="fsw-nav-links" aria-label="Main">
          {LINKS.map((link) => (
            <a key={link.to} href={link.to} onClick={onLinkClick(link.to)}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="fsw-nav-actions">
          {/* `ready` guards against flashing "Sign in" at someone who already is. */}
          {auth.ready && auth.user ? (
            <a className="fsw-btn fsw-btn-outline" href="/account" onClick={onLinkClick('/account')}>
              My account
            </a>
          ) : (
            <a className="fsw-btn fsw-btn-ghost fsw-hide-sm" href="/signin" onClick={onLinkClick('/signin')}>
              Sign in
            </a>
          )}
          <InstallCta label="Add to Chrome" />
          <button
            type="button"
            className="fsw-nav-toggle"
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>

      {open && (
        <nav className="fsw-nav-drawer" aria-label="Main">
          {LINKS.map((link) => (
            <a
              key={link.to}
              href={link.to}
              onClick={(e) => {
                onLinkClick(link.to)(e);
                setOpen(false);
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
