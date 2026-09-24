import { DATA_GROUPS, DATA_NEVER } from '../content/data-summary';

/**
 * The plain-language "Your data" summary, shown above the Privacy policy rather than as a second page —
 * two pages saying the same thing in different words is how they end up disagreeing. This is the version
 * people read; the sections below it are the version they quote.
 */
export function DataSummary() {
  return (
    <section className="fsw-data" id="your-data" aria-labelledby="your-data-heading">
      <h2 id="your-data-heading">Your data, in short</h2>
      <p className="fsw-data-lead">
        FocusSpace is built so that most of what it knows about you never leaves your browser. Here is the whole picture, before the
        detail below.
      </p>

      <div className="fsw-data-grid">
        {DATA_GROUPS.map((group) => (
          <article key={group.id} className="fsw-data-card" data-tone={group.tone}>
            <h3>{group.title}</h3>
            <p>{group.summary}</p>
            <ul>
              {group.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="fsw-data-never">
        <h3>What FocusSpace never does</h3>
        <ul>
          {DATA_NEVER.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
