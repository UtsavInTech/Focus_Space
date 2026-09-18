import { useState } from 'react';
import { FEATURES } from '../content/features';

/** The NoteGPT-style tab row: one line of features, one panel at a time. */
export function FeatureTabs() {
  const [active, setActive] = useState(FEATURES[0].id);
  const feature = FEATURES.find((f) => f.id === active) ?? FEATURES[0];

  return (
    <section className="fsw-section" id="features">
      <div className="fsw-section-head">
        <h2>One extension, the whole way through a course</h2>
        <p>From picking what you are learning to the notes you revise from the night before.</p>
      </div>

      <div className="fsw-tabs" role="tablist" aria-label="Features">
        {FEATURES.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            id={`tab-${f.id}`}
            aria-selected={f.id === active}
            aria-controls={`panel-${f.id}`}
            className={`fsw-tab${f.id === active ? ' is-active' : ''}`}
            onClick={() => setActive(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="fsw-panel" role="tabpanel" id={`panel-${feature.id}`} aria-labelledby={`tab-${feature.id}`}>
        <div className="fsw-panel-copy">
          <h3>{feature.headline}</h3>
          <p>{feature.body}</p>
        </div>
        <ul className="fsw-panel-points">
          {feature.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
