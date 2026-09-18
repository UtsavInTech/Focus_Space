import { useEffect, useState } from 'react';
import { navigate, onLinkClick } from '../router';
import { useAuth } from '../auth';
import * as api from '../api';
import type { UsageStatus } from '../api';
import { PLANS } from '../content/plans';

/**
 * The signed-in account page: who you are, what plan you are on, and how much
 * of this month's allowance you have used.
 *
 * Spaces, subscriptions and settings will live here too, but they need the
 * extension to sync what it knows first — those lists exist only in
 * `chrome.storage.local` today, and this page deliberately shows nothing it
 * cannot actually read rather than an empty panel that looks broken.
 */
export function AccountPage() {
  const auth = useAuth();
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.ready) return;
    if (!auth.user) {
      navigate('/signin');
      return;
    }
    let alive = true;
    void (async () => {
      const token = await auth.token();
      if (!token || !alive) return;
      try {
        const result = await api.usage(token);
        if (alive) setStatus({ plan: result.plan, period: result.period, used: result.used, limit: result.limit });
      } catch (err) {
        if (alive) setError(err instanceof api.ApiError ? err.message : 'Could not load your usage.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.ready, auth.user, auth]);

  if (!auth.ready) return <section className="fsw-account" aria-busy="true" />;
  if (!auth.user) return null;

  const plan = PLANS.find((p) => p.id === status?.plan) ?? PLANS[0];
  const used = status?.used ?? 0;
  const limit = status?.limit ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <section className="fsw-account">
      <header className="fsw-account-head">
        <div>
          <h1>Your account</h1>
          <p>{auth.user.email ?? auth.user.phone}</p>
        </div>
        <button
          type="button"
          className="fsw-btn fsw-btn-outline"
          onClick={() => void auth.signOut().then(() => navigate('/'))}
        >
          Sign out
        </button>
      </header>

      <div className="fsw-account-grid">
        <article className="fsw-account-card">
          <h2>Plan</h2>
          <p className="fsw-account-big">{plan.name}</p>
          <p className="fsw-account-note">{plan.tagline}</p>
          {plan.id === 'free' && (
            <a className="fsw-btn fsw-btn-primary" href="/pricing" onClick={onLinkClick('/pricing')} style={{ marginTop: 14 }}>
              See plans
            </a>
          )}
        </article>

        <article className="fsw-account-card">
          <h2>AI credits</h2>
          {error ? (
            <p className="fsw-account-note">{error}</p>
          ) : status ? (
            <>
              <p className="fsw-account-big">
                {used} <span>of {limit}</span>
              </p>
              <div className="fsw-meter" role="img" aria-label={`${used} of ${limit} credits used`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="fsw-account-note">Resets at the start of each month · {status.period}</p>
            </>
          ) : (
            <p className="fsw-account-note">Loading…</p>
          )}
        </article>

        <article className="fsw-account-card">
          <h2>Your spaces</h2>
          <p className="fsw-account-note">
            Your spaces and subscriptions live in your browser, where FocusSpace keeps them. Managing them here needs the
            extension to sync them first — that is the next thing being built.
          </p>
          <a className="fsw-btn fsw-btn-outline" href="https://www.youtube.com/" style={{ marginTop: 14 }}>
            Open YouTube
          </a>
        </article>
      </div>
    </section>
  );
}
