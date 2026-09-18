import { useState } from 'react';
import { FAQ } from '../content/faq';

/**
 * One open item at a time. Real <button>s inside headings rather than
 * <details>, so the open state is controlled and the whole row is a single
 * keyboard-reachable control.
 */
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="fsw-section fsw-faq" id="faq">
      <div className="fsw-section-head">
        <h2>Frequently asked questions</h2>
        <p>
          Anything missing? The bubble in the corner answers questions about FocusSpace, and it costs nothing to ask.
        </p>
      </div>

      <div className="fsw-faq-list">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <div className={`fsw-faq-item${isOpen ? ' is-open' : ''}`} key={item.q}>
              <h3>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}>
                  <span>{item.q}</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </h3>
              {isOpen && <p>{item.a}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
