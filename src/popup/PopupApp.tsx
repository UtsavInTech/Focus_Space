import { useState } from 'react';
import { ExternalLink, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useDocumentTheme, useStorage } from '@/ui/hooks';
import { Alert, Button, IconButton, Logo, Skeleton, Switch } from '@/ui/components/primitives';
import { ModePicker } from '@/ui/components/ModeChips';
import { activeModeOf, selectMode, setFocusEnabled } from '@/modes/service';
import { extensionAlive, sendMessage } from '@/messaging/runtime';
import { POPUP_LINKS, type PopupLink } from './links';

/**
 * Every popup action below used to fire the message and close the popup unconditionally, whether or not
 * the message actually succeeded (`{ ok: false, error }` responses and outright rejections — e.g. the
 * service worker being asleep and slow to wake, or the message channel already gone — were both
 * discarded). That made a real failure indistinguishable from "this button does nothing": the popup
 * closed either way, taking any error with it, and nothing on screen ever told the user what happened.
 * `runAction` is the one place every action now goes through: it keeps the popup open and shows the
 * problem when something goes wrong, and only closes it once the background has actually confirmed
 * success.
 */
function usePopupAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void action()
      .then((result) => {
        if (result.ok) {
          window.close();
        } else {
          setBusy(false);
          setError(result.error || 'That action did not go through. Try again.');
        }
      })
      .catch((err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'That action did not go through. Try again.');
      });
  };
  return { run, error, busy };
}

async function openDashboard(route = '/') {
  if (!extensionAlive()) return { ok: false, error: 'FocusSpace needs to be reloaded. Reopen this popup and try again.' };
  return sendMessage('dashboard/open', { route });
}

async function openSite(path = '/') {
  if (!extensionAlive()) return { ok: false, error: 'FocusSpace needs to be reloaded. Reopen this popup and try again.' };
  return sendMessage('site/open', { path });
}

async function openYouTube(url = 'https://www.youtube.com/') {
  if (!extensionAlive()) return { ok: false, error: 'FocusSpace needs to be reloaded. Reopen this popup and try again.' };
  return sendMessage('youtube/open', { url });
}

/** One place turns a link's declared surface into the message that opens it — see ./links.ts. */
function followLink(link: PopupLink) {
  if (link.surface === 'site') return openSite(link.target);
  if (link.surface === 'youtube') return openYouTube(link.target);
  return openDashboard(link.target);
}

/** Quick controls: Focus Mode on/off and which space. */
export function PopupApp() {
  const data = useStorage(['settings', 'modes'] as const);
  useDocumentTheme(data?.settings.theme, data?.settings.density);
  const { run, error, busy } = usePopupAction();

  if (!data) {
    return (
      <div className="fs-popup" aria-busy="true">
        <Skeleton height={28} width={140} />
        <Skeleton height={70} radius={14} />
        <Skeleton height={46} radius={12} />
      </div>
    );
  }

  const { settings, modes } = data;
  const mode = activeModeOf(settings, modes);
  const on = settings.focusEnabled && !!mode;

  return (
    <div className="fs-popup">
      <header className="fs-popup-head">
        <Logo size={24} />
        <IconButton label="Settings" icon={<SettingsIcon />} disabled={busy} onClick={() => run(() => openDashboard('/settings'))} />
      </header>

      <section className="fs-card fs-popup-focus" data-on={on}>
        <div className="fs-grow">
          <div className="fs-row">
            <span className={`fs-dot${on ? ' fs-dot-on' : ''}`} aria-hidden />
            <span className="fs-h3">Focus Mode {on ? 'on' : 'off'}</span>
          </div>
          <p className="fs-caption" style={{ marginTop: 2 }}>
            {on ? `YouTube is organised around ${mode.name}.` : 'Normal YouTube.'}
          </p>
        </div>
        <Switch label="Focus Mode" checked={on} onChange={(v) => setFocusEnabled(v)} />
      </section>

      <div>
        <span className="fs-eyebrow fs-popup-label">Space</span>
        <ModePicker modes={modes} value={mode?.id ?? null} onChange={(m) => selectMode(m.id)} />
      </div>

      <div className="fs-popup-foot">
        <Button variant="primary" icon={<ExternalLink />} loading={busy} onClick={() => run(openYouTube)}>
          Open YouTube
        </Button>
        <Button variant="secondary" icon={<Plus />} disabled={busy} onClick={() => run(() => openDashboard('/modes?new=1'))}>
          New space
        </Button>
      </div>
      <nav className="fs-popup-links" aria-label="FocusSpace">
        {POPUP_LINKS.map((link) => (
          <Button key={link.id} size="sm" variant="ghost" disabled={busy} onClick={() => run(() => followLink(link))}>
            {link.label}
          </Button>
        ))}
      </nav>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
