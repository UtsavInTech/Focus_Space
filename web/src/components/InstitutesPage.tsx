import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { INSTITUTE_CONTACT, INSTITUTES } from '../content/institutes';
import { onLinkClick } from '../router';
import './institutes.css';

/** An invitation to discuss a proposed pilot, not a demo of a product already built. */
export default function InstitutesPage() {
  return <article className="fsw-institutes">
    <header className="fsw-institute-hero">
      <div className="fsw-institute-copy">
        <p className="fsw-institute-eyebrow">{INSTITUTES.eyebrow}</p>
        <h1>{INSTITUTES.headline[0]}<br /><span>{INSTITUTES.headline[1]}</span></h1>
        <p className="fsw-institute-intro">{INSTITUTES.intro}</p>
        <p className="fsw-institute-availability"><span>{INSTITUTES.status}</span>{INSTITUTES.availability}</p>
        <p className="fsw-institute-invitation">{INSTITUTES.invitation}</p>
        <div className="fsw-institute-actions">
          <a className="fsw-btn fsw-btn-primary" href={INSTITUTE_CONTACT}>{INSTITUTES.contactLabel}<ArrowUpRight size={16} aria-hidden="true" /></a>
          <a className="fsw-institute-text-link" href="/" onClick={onLinkClick('/')}>{INSTITUTES.studentLabel}<ArrowRight size={16} aria-hidden="true" /></a>
        </div>
      </div>
      <section className="fsw-institute-flow" aria-labelledby="institute-journey-title">
        <h2 id="institute-journey-title">{INSTITUTES.flowTitle}</h2>
        <ol>{INSTITUTES.flow.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>
      </section>
    </header>
    <section className="fsw-institute-details" aria-labelledby="institute-details-title">
      <div><h2 id="institute-details-title">{INSTITUTES.detailsTitle}</h2><p>{INSTITUTES.detailsIntro}</p></div>
      <div className="fsw-institute-rows">{INSTITUTES.details.map(item => <section key={item.title}><h3>{item.title}</h3><p>{item.text}</p></section>)}</div>
    </section>
    <aside className="fsw-institute-privacy" aria-labelledby="institute-privacy-title"><h2 id="institute-privacy-title">{INSTITUTES.privacyTitle}</h2><p>{INSTITUTES.privacy}</p></aside>
    <section className="fsw-institute-closing" aria-labelledby="institute-contact-title"><div><h2 id="institute-contact-title">{INSTITUTES.closingTitle}</h2><p>{INSTITUTES.closingText}</p></div><a className="fsw-btn fsw-btn-outline" href={INSTITUTE_CONTACT}>{INSTITUTES.contactLabel}<ArrowUpRight size={16} aria-hidden="true" /></a></section>
  </article>;
}
