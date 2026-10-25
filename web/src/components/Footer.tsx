import { ArrowUp, ArrowUpRight, Mail } from 'lucide-react';
import { onLinkClick } from '../router';
import { Logo, Wordmark } from './Logo';
import { Sparkle } from './Sparkle';
import { InstallCta } from './InstallCta';
import { INSTITUTE_CONTACT, INSTITUTE_LINK } from '../content/institutes';
import { CONTACT } from '../content/legal';
import { FooterStage } from './FooterStage';
import './footer.css';
import './footer-stage.css';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/#features' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'FAQ', to: '/#faq' },
      { label: 'Your data', to: '/data' },
    ],
  },
  {
    title: 'Institutes',
    links: [
      { label: INSTITUTE_LINK.label, to: INSTITUTE_LINK.to },
      { label: 'Talk to us about the pilot', href: INSTITUTE_CONTACT },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '/terms' },
      { label: 'Refunds', to: '/refunds' },
      { label: 'Contact', to: '/contact' },
    ],
  },
] as const;

/**
 * The end of every page: a dark stage in both appearances, ending on the wordmark lit by the hanging
 * FocusSpace lamp (FooterStage). On the home the brand finale sits just above it and already asks
 * visitors to install, so the closing call to action shows on the other pages only.
 */
export function Footer({ withCta = true }: { withCta?: boolean }) {
  return (
    <footer className="fsw-foot">
      {withCta && (
        <div className="fsw-foot-cta">
          <div>
            <p className="fsw-foot-eyebrow"><i /> YOUR ATTENTION IS YOURS.</p>
            <h2>A little more focus.<br /><span>A lot more you.</span></h2>
          </div>
          <InstallCta size="lg" />
        </div>
      )}

      <div className="fsw-foot-main">
        <div className="fsw-foot-brand">
          <a className="fsw-brand" href="/" onClick={onLinkClick('/')}>
            {/* Alive as in the nav: the rings turn, the name sparkles, the ring gets no sparks. */}
            <Logo size={28} animated />
            <span className="fsw-brand-word">
              <Wordmark tagline />
              <Sparkle from="text" rate={4} />
            </span>
          </a>
          <p>YouTube has the content. FocusSpace gives it structure.</p>
          <a className="fsw-foot-mail" href={`mailto:${CONTACT}`}><Mail size={15} aria-hidden="true" />{CONTACT}</a>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2>{column.title}</h2>
            {column.links.map((link) =>
              'href' in link ? (
                <a key={link.label} href={link.href}>{link.label} <ArrowUpRight size={13} aria-hidden="true" /></a>
              ) : (
                <a key={link.label} href={link.to} onClick={onLinkClick(link.to)}>{link.label}</a>
              ),
            )}
          </nav>
        ))}
      </div>

      <FooterStage />

      <div className="fsw-foot-base">
        <span>© {new Date().getFullYear()} FocusSpace</span>
        <span>Not affiliated with, endorsed by, or connected to YouTube or Google.</span>
        <a href="#main">Back to top <ArrowUp size={13} aria-hidden="true" /></a>
      </div>
    </footer>
  );
}
