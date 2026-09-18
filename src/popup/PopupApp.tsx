import { ExternalLink, Home, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useDocumentTheme, useStorage } from '@/ui/hooks';
import { Button, IconButton, Logo, Skeleton, Switch } from '@/ui/components/primitives';
import { ModePicker } from '@/ui/components/ModeChips';
import { activeModeOf, selectMode, setFocusEnabled } from '@/modes/service';
import { sendMessage } from '@/messaging/runtime';

async function openDashboard(route = '/') {
  await sendMessage('dashboard/open', { route });
  window.close();
}

async function openSite(path = '/') {
  await sendMessage('site/open', { path });
  window.close();
}

async function openYouTube() {
  await sendMessage('youtube/open', { url: 'https://www.youtube.com/' });
  window.close();
}

/** Quick controls: Focus Mode on/off and which space. */
export function PopupApp() {
  const data = useStorage(['settings', 'modes'] as const);
  useDocumentTheme(data?.settings.theme, data?.settings.density);

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
        <IconButton label="Settings" icon={<SettingsIcon />} onClick={() => openDashboard('/settings')} />
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
        <Button variant="primary" icon={<ExternalLink />} onClick={openYouTube}>
          Open YouTube
        </Button>
        <Button variant="secondary" icon={<Plus />} onClick={() => openDashboard('/?new=1')}>
          New space
        </Button>
      </div>
      <nav className="fs-popup-links">
        <Button size="sm" variant="ghost" onClick={() => openDashboard('/')}>
          Manage spaces
        </Button>
        <Button size="sm" variant="ghost" onClick={() => openDashboard('/subscriptions')}>
          Subscriptions
        </Button>
        <Button size="sm" variant="ghost" icon={<Home />} onClick={() => openSite('/')}>
          FocusSpace home
        </Button>
      </nav>
    </div>
  );
}
