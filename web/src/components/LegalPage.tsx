import type { LegalDoc } from '../content/legal';

/** One layout for every legal page — they differ only in words. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <article className="fsw-legal">
      <header>
        <h1>{doc.title}</h1>
        <p className="fsw-legal-intro">{doc.intro}</p>
        <p className="fsw-legal-updated">Last updated {doc.updated}</p>
      </header>

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
