import type { ReactNode } from 'react';
import type { LegalDoc } from '../content/legal';

/**
 * One layout for every legal page — they differ only in words, and, for Privacy, a `lead` block: the
 * plain-language "Your data" summary sits above the policy instead of on a page of its own.
 */
export function LegalPage({ doc, lead }: { doc: LegalDoc; lead?: ReactNode }) {
  return (
    <article className="fsw-legal">
      <header>
        <h1>{doc.title}</h1>
        <p className="fsw-legal-intro">{doc.intro}</p>
        <p className="fsw-legal-updated">Last updated {doc.updated}</p>
      </header>

      {lead}

      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
