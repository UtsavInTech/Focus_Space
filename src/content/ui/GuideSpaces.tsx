import { ExternalLink, Plus } from 'lucide-react';
import type { LearningMode, Settings } from '@/types/domain';
import { selectMode } from '@/modes/service';
import { SpaceIcon } from '@/ui/icons';
import { LogoMark } from '@/ui/components/primitives';
import { sendMessage } from '@/messaging/runtime';
import { spaNavigate } from '../youtube/spa';

/**
 * A compact "FocusSpace" section in YouTube's own left sidebar.
 *
 * The heading is the way out to focusspace.app — the same move NoteGPT makes
 * with its logo, and the reason the section needs no separate link. Sign-in
 * used to live up here as a second control; it moved to the website, which is
 * where an account is actually set up and managed. Settings → Account still
 * has it for anyone already signed in.
 */
export function GuideSpaces({ settings, modes, onCreate }: { settings: Settings; modes: LearningMode[]; onCreate: () => void }) {
  const choose = async (mode: LearningMode) => {
    await selectMode(mode.id);
    spaNavigate('/');
  };
  // FocusSpace's own Home (Library, History, Spaces) — the marketing site is for people who do not have it yet.
  const openHome = () => void sendMessage('dashboard/open', { route: '/' }).catch(() => undefined);

  return (
    <nav className="fs-guide" aria-label="FocusSpace spaces">
      <button type="button" className="fs-guide-title" onClick={openHome} title="Open FocusSpace — your Library, history and account">
        <LogoMark size={22} />
        <span>FocusSpace</span>
        <ExternalLink size={14} aria-hidden />
      </button>
      {modes.map((m) => (
        <button key={m.id} type="button" className="fs-guide-item" aria-current={m.id === settings.activeModeId ? 'true' : undefined} onClick={() => void choose(m)} title={m.name}>
          <SpaceIcon name={m.icon} size={22} />
          <span>{m.name}</span>
        </button>
      ))}
      <button type="button" className="fs-guide-item" onClick={onCreate}>
        <Plus size={22} aria-hidden />
        <span>New space</span>
      </button>
    </nav>
  );
}
