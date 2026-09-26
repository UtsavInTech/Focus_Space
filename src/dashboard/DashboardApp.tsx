import { CircleUser, ExternalLink, History, House, Layers, Library, Settings as SettingsIcon, Users } from 'lucide-react';
import { useDocumentTheme, useStorage } from '@/ui/hooks';
import { FocusMark, Skeleton, Switch, Wordmark } from '@/ui/components/primitives';
import { SpaceIcon } from '@/ui/icons';
import { activeModeOf, setFocusEnabled } from '@/modes/service';
import { sendMessage } from '@/messaging/runtime';
import { useRoute } from './router';
import { ModesPage } from './pages/ModesPage';
import { ModeEditorPage } from './pages/ModeEditorPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { HistoryPage } from './pages/HistoryPage';
import { AccountPage } from './pages/AccountPage';
import { Bubbles } from './Bubbles';
import { NameSparkle } from './NameSparkle';
import { CursorSparkle } from './CursorSparkle';

/**
 * The learning product's own home: what you made (Library), what you
 * watched (History) and what organises it (Spaces), with Subscriptions and Settings below. The marketing
 * site keeps pricing, FAQ and the account; everything here is the learner's.
 */
const NAV = [
  { to: '/', label: 'Home', icon: House, match: (s: string[]) => s.length === 0 },
  { to: '/library', label: 'Library', icon: Library, match: (s: string[]) => s[0] === 'library' },
  { to: '/history', label: 'History', icon: History, match: (s: string[]) => s[0] === 'history' },
  { to: '/modes', label: 'Spaces', icon: Layers, match: (s: string[]) => s[0] === 'modes' || s[0] === 'welcome' },
  // "Subscribed channels", not "Subscriptions": FocusSpace ranks channels per Space (your subscriptions
  // plus any you've added), which reads as a YouTube-account settings page under the bare word alone.
  { to: '/subscriptions', label: 'Subscribed channels', icon: Users, match: (s: string[]) => s[0] === 'subscriptions' },
  { to: '/account', label: 'Account', icon: CircleUser, match: (s: string[]) => s[0] === 'account' },
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
    case 'welcome':
      page = <ModesPage data={data} openCreate={false} />;
      break;
    case 'library':
      page = <LibraryPage segments={route.segments} />;
      break;
    case 'history':
      page = <HistoryPage data={data} />;
      break;
    case 'account':
      page = <AccountPage data={data} />;
      break;
    default:
      // Older links opened "/?new=1" to create a Space; they still do.
      page = route.query.get('new') === '1' ? <ModesPage data={data} openCreate /> : <HomePage data={data} />;
  }

  return (
    <div className="fs-app">
      <Bubbles />
      <CursorSparkle />
      <aside className="fs-sidebar">
        <a href="#/" className="fs-sidebar-logo" aria-label="FocusSpace home">
          {/* As on the website's nav: the mark's rings turn, and the name sparkles — the ring gets no sparks. */}
          <span className="fs-logo">
            <FocusMark size={26} animated />
            <span className="fs-brand-word">
              <Wordmark />
              <NameSparkle />
            </span>
          </span>
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
