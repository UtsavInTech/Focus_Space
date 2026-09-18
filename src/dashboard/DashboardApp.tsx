import { ExternalLink, Layers, Settings as SettingsIcon, Users } from 'lucide-react';
import { useDocumentTheme, useStorage } from '@/ui/hooks';
import { Logo, Skeleton, Switch } from '@/ui/components/primitives';
import { SpaceIcon } from '@/ui/icons';
import { activeModeOf, setFocusEnabled } from '@/modes/service';
import { sendMessage } from '@/messaging/runtime';
import { useRoute } from './router';
import { ModesPage } from './pages/ModesPage';
import { ModeEditorPage } from './pages/ModeEditorPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SettingsPage } from './pages/SettingsPage';

const NAV = [
  { to: '/', label: 'Spaces', icon: Layers, match: (s: string[]) => s.length === 0 || s[0] === 'modes' || s[0] === 'welcome' },
  { to: '/subscriptions', label: 'Subscriptions', icon: Users, match: (s: string[]) => s[0] === 'subscriptions' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, match: (s: string[]) => s[0] === 'settings' },
];

export type DashboardData = NonNullable<ReturnType<typeof useDashboardData>>;
const useDashboardData = () => useStorage(['settings', 'modes'] as const);

export const openYouTube = (url = 'https://www.youtube.com/') => void sendMessage('youtube/open', { url }).catch(() => undefined);

/** Space management and settings. Watching happens on YouTube itself. */
export function DashboardApp() {
  const data = useDashboardData();
  const route = useRoute();
  useDocumentTheme(data?.settings.theme, data?.settings.density);

  if (!data) {
    return (
      <div className="fs-page" aria-busy="true">
        <Skeleton width={220} height={30} />
        <Skeleton height={140} radius={14} />
        <Skeleton height={260} radius={14} />
      </div>
    );
  }

  const mode = activeModeOf(data.settings, data.modes);
  const [section, param] = route.segments;
  let page;
  switch (section) {
    case 'subscriptions':
      page = <SubscriptionsPage data={data} />;
      break;
    case 'settings':
      page = <SettingsPage data={data} />;
      break;
    case 'modes':
      page = param ? <ModeEditorPage key={param} data={data} modeId={param} /> : <ModesPage data={data} openCreate={route.query.get('new') === '1'} />;
      break;
    default:
      page = <ModesPage data={data} openCreate={route.query.get('new') === '1'} />;
  }

  return (
    <div className="fs-app">
      <aside className="fs-sidebar">
        <a href="#/" className="fs-sidebar-logo" aria-label="FocusSpace spaces">
          <Logo size={26} />
        </a>
        <nav className="fs-nav" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, match }) => (
            <a key={to} href={`#${to}`} className="fs-nav-item" aria-current={match(route.segments) ? 'page' : undefined}>
              <Icon aria-hidden />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="fs-sidebar-foot">
          <div className="fs-card fs-focus-mini">
            <span className={`fs-dot${data.settings.focusEnabled ? ' fs-dot-on' : ''}`} aria-hidden />
            <div className="fs-grow">
              <div className="fs-body-sm" style={{ fontWeight: 600 }}>
                Focus {data.settings.focusEnabled ? 'on' : 'off'}
              </div>
              <div className="fs-caption fs-truncate fs-row" style={{ gap: 4 }}>
                {mode ? (
                  <>
                    <SpaceIcon name={mode.icon} size={12} /> {mode.name}
                  </>
                ) : (
                  'No space'
                )}
              </div>
            </div>
            <Switch label="Focus Mode" checked={data.settings.focusEnabled} onChange={(v) => setFocusEnabled(v)} />
          </div>
          <button type="button" className="fs-nav-item" style={{ border: 'none', background: 'none', cursor: 'pointer', width: '100%' }} onClick={() => openYouTube()}>
            <ExternalLink aria-hidden />
            <span>Open YouTube</span>
          </button>
        </div>
      </aside>
      <main className="fs-main">
        <div className="fs-page" key={route.path}>
          {page}
        </div>
      </main>
    </div>
  );
}
