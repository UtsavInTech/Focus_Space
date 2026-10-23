import type { ReactNode } from 'react';
import type { Settings } from '@/types/domain';
import { updateItem } from '@/storage/storage';

/** A card, the unit the settings and account pages are both built from: icon, title, one line, rows. */
export function Section({ id, title, description, icon, children }: { id: string; title: string; description?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="fs-settings-section">
      <header>
        {icon && (
          <span className="fs-section-icon" aria-hidden>
            {icon}
          </span>
        )}
        <span className="fs-section-titles">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </span>
      </header>
      <div className="fs-settings-rows">{children}</div>
    </section>
  );
}

export const patch = (p: Partial<Settings>) => updateItem('settings', (s) => ({ ...s, ...p }));

/** `limit: null` is an unlimited plan: it says so, with no bar to fill. */
export function Meter({ label, used, limit, unit }: { label: string; used: number; limit: number | null; unit: string }) {
  return (
    <div className="fs-meter">
      <div className="fs-meter-head">
        <span className="fs-label">{label}</span>
        <span className="fs-hint">{limit === null ? `Unlimited ${unit}` : `${used} of ${limit} ${unit}`}</span>
      </div>
      {limit !== null && (
        <div className="fs-meter-track">
          <span className="fs-meter-fill" style={{ width: `${Math.min(100, Math.round((used / Math.max(1, limit)) * 100))}%` }} />
        </div>
      )}
    </div>
  );
}

/** A usable http(s) address — the endpoint and server fields both check it before offering Save. */
export const isHttpUrl = (url: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};
