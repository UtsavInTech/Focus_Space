import { ExternalLink, History, Library, Plus } from 'lucide-react';
import type { LearningMode, Settings } from '@/types/domain';
import { selectMode } from '@/modes/service';
import { SpaceIcon } from '@/ui/icons';
import { FocusMark, Wordmark } from '@/ui/components/primitives';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { spaNavigate } from '../youtube/spa';
import { welcomeStep } from './welcome-step';
import { subjectsOf } from '@/modes/groups';
import { homeNav, useHomeTopic } from './home/nav';

/**
 * A compact "FocusSpace" section in YouTube's own left sidebar.
 *
 * The heading is the way out to focusspace.xyz, which is why the section
 * needs no separate link. Sign-in
 * used to live up here as a second control; it moved to the website, which is
 * where an account is actually set up and managed. Settings → Account still
 * has it for anyone already signed in.
 */
export function GuideSpaces({ settings, modes, onCreate }: { settings: Settings; modes: LearningMode[]; onCreate: () => void }) {
  /** A Space opens at its home; a subject ("NEET → Chemistry") opens as its own page there. */
  const choose = async (mode: LearningMode, topicId: string | null = null) => {
    homeNav.set({ modeId: mode.id, topicId });
    await selectMode(mode.id);
    spaNavigate('/');
  };
  const active = modes.find((m) => m.id === settings.activeModeId) ?? null;
  const [openTopic] = useHomeTopic(active?.id ?? null);
  // The open Space shows its subjects under it: the hierarchy, where YouTube keeps its own navigation.
  const subjects = active ? subjectsOf(active) : [];
  // FocusSpace's own Home (Library, History, Spaces) — the marketing site is for people who do not have it yet.
  const openHome = () => void sendMessage('dashboard/open', { route: '/' }).catch(() => undefined);
  // The welcome guide's last step points here, so the heading it names is the one that stands out.
  const store = useStorage(['welcome', 'auth'] as const);
  const pointedAt = !!store && welcomeStep(store.welcome, !!store.auth.user, true) === 'channels';

  return (
    <nav className="fs-guide" aria-label="FocusSpace spaces">
      <button type="button" className={`fs-guide-title${pointedAt ? ' is-pointed' : ''}`} onClick={openHome} title="Open FocusSpace: your Library, history and account">
        {/* Turning, as it does on the website's nav — the one place in YouTube's sidebar that is ours. */}
        <FocusMark size={22} active />
        <Wordmark />
        <ExternalLink size={14} aria-hidden />
      </button>
      {modes.map((m) => (
        <div key={m.id} className="fs-guide-space">
          <button type="button" className="fs-guide-item" aria-current={m.id === settings.activeModeId ? 'true' : undefined} onClick={() => void choose(m)} title={m.name}>
            <SpaceIcon name={m.icon} size={22} />
            <span>{m.name}</span>
          </button>
          {m.id === active?.id && subjects.length >= 2 && (
            <div className="fs-guide-subs" role="group" aria-label={`${m.name} subjects`}>
              {subjects.map((sub) => (
                <button key={sub.id} type="button" className="fs-guide-sub" aria-current={openTopic === sub.id || sub.topics.some((t) => t.id === openTopic) ? 'true' : undefined} onClick={() => void choose(m, sub.id)} title={`${sub.title}: ${sub.topics.map((t) => t.name).join(', ')}`}>
                  <span>{sub.title}</span>
                  <small>{sub.topics.length}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" className="fs-guide-item" onClick={onCreate}>
        <Plus size={22} aria-hidden />
        <span>New space</span>
      </button>
      {/* FocusSpace's own pages, one click from YouTube: what you saved, and what you watched with it. */}
      <div className="fs-guide-sep" role="separator" />
      <button type="button" className="fs-guide-item" onClick={() => void sendMessage('dashboard/open', { route: '/library' }).catch(() => undefined)}>
        <Library size={22} aria-hidden />
        <span>FocusSpace Library</span>
      </button>
      <button type="button" className="fs-guide-item" onClick={() => void sendMessage('dashboard/open', { route: '/history' }).catch(() => undefined)}>
        <History size={22} aria-hidden />
        <span>FocusSpace History</span>
      </button>
    </nav>
  );
}
