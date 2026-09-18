import { useEffect, useState } from 'react';
import { navigate, onLinkClick } from '../router';
import { useAuth } from '../auth';
import * as api from '../api';
import type { UsageStatus } from '../api';
import { PLANS } from '../content/plans';
import { useExtension, type ExtensionLink } from '../extension';

/**
 * Everything about your account in one place: plan and credits from the
 * server, spaces, subscriptions and settings live from the extension.
 *
 * The two halves come from genuinely different places and that is visible in
 * the page rather than hidden: the server knows what you pay for, the browser
 * knows what you watch. When the extension is not installed, the page says so
 * and links to it instead of rendering empty panels.
 */
export function AccountPage() {
  const auth = useAuth();
  const ext = useExtension();
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

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
        if (alive) setUsageError(err instanceof api.ApiError ? err.message : 'Could not load your usage.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.ready, auth.user, auth]);

  if (!auth.ready) return <section className="fsw-account" aria-busy="true" />;
  if (!auth.user) return null;

  return (
    <section className="fsw-account">
      <header className="fsw-account-head">
        <div>
          <h1>Your account</h1>
          <p>{auth.user.email ?? auth.user.phone}</p>
        </div>
        <button type="button" className="fsw-btn fsw-btn-outline" onClick={() => void auth.signOut().then(() => navigate('/'))}>
          Sign out
        </button>
      </header>

      <PlanRow status={status} error={usageError} />

      {ext.status === 'connected' && ext.state ? (
        <>
          <SpacesPanel ext={ext} />
          <SettingsPanel ext={ext} />
          <SubscriptionsPanel ext={ext} />
        </>
      ) : (
        <NotInstalled checking={ext.status === 'checking'} />
      )}
    </section>
  );
}

function PlanRow({ status, error }: { status: UsageStatus | null; error: string | null }) {
  const plan = PLANS.find((p) => p.id === status?.plan) ?? PLANS[0];
  const used = status?.used ?? 0;
  const limit = status?.limit ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="fsw-account-grid fsw-account-grid-2">
      <article className="fsw-account-card">
        <h2>Plan</h2>
        <p className="fsw-account-big">{plan.name}</p>
        <p className="fsw-account-note">{plan.tagline}</p>
        <a className="fsw-btn fsw-btn-primary" href="/pricing" onClick={onLinkClick('/pricing')} style={{ marginTop: 14 }}>
          {plan.id === 'free' ? 'See plans' : 'Change plan'}
        </a>
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
    </div>
  );
}

function NotInstalled({ checking }: { checking: boolean }) {
  return (
    <article className="fsw-account-card fsw-account-wide">
      <h2>Your spaces and settings</h2>
      {checking ? (
        <p className="fsw-account-note">Looking for the FocusSpace extension…</p>
      ) : (
        <>
          <p className="fsw-account-note">
            Your spaces, channels and settings live inside the extension, in this browser — they are never uploaded. This
            page reads them directly from it, so it needs FocusSpace installed here to show them.
          </p>
          <a className="fsw-btn fsw-btn-primary" href="/#install" onClick={onLinkClick('/#install')} style={{ marginTop: 14 }}>
            Add FocusSpace to Chrome
          </a>
        </>
      )}
    </article>
  );
}

function SpacesPanel({ ext }: { ext: ExtensionLink }) {
  const [name, setName] = useState('');
  const state = ext.state!;

  function create(e: React.FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    setName('');
    void ext.createSpace(value);
  }

  return (
    <article className="fsw-account-card fsw-account-wide">
      <div className="fsw-panel-head">
        <h2>Your spaces</h2>
        <span className="fsw-account-note">{state.modes.length} in this browser</span>
      </div>

      <ul className="fsw-space-list">
        {state.modes.map((mode) => (
          <li key={mode.id} className={mode.id === state.activeModeId ? 'is-active' : undefined}>
            <button type="button" className="fsw-space-name" onClick={() => void ext.selectSpace(mode.id)} title="Make this the active space">
              <strong>{mode.name}</strong>
              <span>{mode.topics.length ? mode.topics.map((t) => t.name).join(' · ') : 'No topics yet'}</span>
            </button>
            {mode.id === state.activeModeId && <em className="fsw-space-badge">Active</em>}
            <button
              type="button"
              className="fsw-space-delete"
              aria-label={`Delete ${mode.name}`}
              // No confirm dialog: deleting a space removes an arrangement of YouTube,
              // not any content — and it can be recreated in one line below.
              onClick={() => void ext.deleteSpace(mode.id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <form className="fsw-space-new" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New space — e.g. System design" aria-label="New space name" />
        <button type="submit" className="fsw-btn fsw-btn-outline" disabled={!name.trim()}>
          Create
        </button>
      </form>

      {ext.error && <p className="fsw-auth-error" style={{ marginTop: 12 }}>{ext.error}</p>}
    </article>
  );
}

function SettingsPanel({ ext }: { ext: ExtensionLink }) {
  const state = ext.state!;
  return (
    <article className="fsw-account-card fsw-account-wide">
      <h2>Settings</h2>

      <div className="fsw-setting">
        <div>
          <strong>Focus Mode</strong>
          <span>When off, YouTube is left exactly as it is.</span>
        </div>
        <button type="button" className={`fsw-toggle${state.focusEnabled ? ' is-on' : ''}`} role="switch" aria-checked={state.focusEnabled} aria-label="Focus Mode" onClick={() => void ext.setFocus(!state.focusEnabled)}>
          <span />
        </button>
      </div>

      <div className="fsw-setting">
        <div>
          <strong>Notes language</strong>
          <span>Technical terms stay in English whichever you pick.</span>
        </div>
        <div className="fsw-seg" role="group" aria-label="Notes language">
          {[
            { id: 'en', label: 'English' },
            { id: 'hi', label: 'हिंदी' },
            { id: 'hinglish', label: 'Hinglish' },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className={state.settings.language === option.id ? 'is-active' : undefined}
              aria-pressed={state.settings.language === option.id}
              onClick={() => void ext.updateSettings({ ai: { language: option.id } })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fsw-setting">
        <div>
          <strong>Theme</strong>
          <span>How FocusSpace's own panels look on YouTube.</span>
        </div>
        <div className="fsw-seg" role="group" aria-label="Theme">
          {['system', 'light', 'dark'].map((theme) => (
            <button key={theme} type="button" className={state.settings.theme === theme ? 'is-active' : undefined} aria-pressed={state.settings.theme === theme} onClick={() => void ext.updateSettings({ theme })}>
              {theme[0].toUpperCase() + theme.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="fsw-setting">
        <div>
          <strong>Keep my channel list fresh</strong>
          <span>Refreshes your subscriptions in the background.</span>
        </div>
        <button
          type="button"
          className={`fsw-toggle${state.settings.autoSyncSubscriptions ? ' is-on' : ''}`}
          role="switch"
          aria-checked={state.settings.autoSyncSubscriptions}
          aria-label="Keep my channel list fresh"
          onClick={() => void ext.updateSettings({ autoSyncSubscriptions: !state.settings.autoSyncSubscriptions })}
        >
          <span />
        </button>
      </div>
    </article>
  );
}

function SubscriptionsPanel({ ext }: { ext: ExtensionLink }) {
  const channels = ext.state!.channels;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? channels : channels.slice(0, 12);

  return (
    <article className="fsw-account-card fsw-account-wide">
      <div className="fsw-panel-head">
        <h2>Channels FocusSpace knows</h2>
        <span className="fsw-account-note">{channels.length} in this browser</span>
      </div>

      {channels.length ? (
        <>
          <ul className="fsw-chip-list">
            {shown.map((channel) => (
              <li key={channel.id}>
                {channel.title}
                {channel.source !== 'subscription' && <em> · added</em>}
              </li>
            ))}
          </ul>
          {channels.length > 12 && (
            <button type="button" className="fsw-link" style={{ marginTop: 12 }} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show fewer' : `Show all ${channels.length}`}
            </button>
          )}
        </>
      ) : (
        <p className="fsw-account-note">
          No channels yet. On YouTube, open the space menu and choose “Import my subscriptions” — FocusSpace needs them
          to put your own creators first.
        </p>
      )}
    </article>
  );
}
