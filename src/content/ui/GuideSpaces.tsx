import { ExternalLink, Lock, Plus } from 'lucide-react';
import type { LearningMode, Settings } from '@/types/domain';
import { missingTemplates, selectMode } from '@/modes/service';
import { examInfo } from '@/modes/exams';
import { isSpaceLocked, unlockHint } from '@/modes/unlock';
import { useLockState } from '@/ui/use-lock';
import { SpaceIcon } from '@/ui/icons';
import { FocusMark, Wordmark } from '@/ui/components/primitives';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { spaNavigate } from '../youtube/spa';
import { welcomeStep } from './welcome-step';

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
  const choose = async (mode: LearningMode) => {
    await selectMode(mode.id);
    spaNavigate('/');
  };
  // FocusSpace's own Home (Library, History, Spaces) — the marketing site is for people who do not have it yet.
  const openHome = () => void sendMessage('dashboard/open', { route: '/' }).catch(() => undefined);
  // The welcome guide's last step points here, so the heading it names is the one that stands out.
  const store = useStorage(['welcome', 'auth'] as const);
  const pointedAt = !!store && welcomeStep(store.welcome, !!store.auth.user, true) === 'channels';
  // While new Spaces are locked (modes/unlock.ts), the whole map stays visible: the rest, each with a lock.
  const lock = useLockState();
  const examName = examInfo(lock?.examId)?.label ?? 'your exam';
  const locked = lock?.locked ? missingTemplates(modes).filter((m) => isSpaceLocked(m.id, lock, modes)) : [];

  return (
    <nav className="fs-guide" aria-label="FocusSpace spaces">
      <button type="button" className={`fs-guide-title${pointedAt ? ' is-pointed' : ''}`} onClick={openHome} title="Open FocusSpace: your Library, history and account">
        {/* Turning, as it does on the website's nav — the one place in YouTube's sidebar that is ours. */}
        <FocusMark size={22} active />
        <Wordmark />
        <ExternalLink size={14} aria-hidden />
      </button>
      {modes.map((m) => (
        <button key={m.id} type="button" className="fs-guide-item" aria-current={m.id === settings.activeModeId ? 'true' : undefined} onClick={() => void choose(m)} title={m.name}>
          <SpaceIcon name={m.icon} size={22} />
          <span>{m.name}</span>
        </button>
      ))}
      {lock?.locked ? (
        <>
          <div className="fs-guide-lock" title={unlockHint(lock, examName)}>
            <span className="fs-guide-lock-label">
              <Lock size={13} aria-hidden /> Unlocks as you study
            </span>
            <span className="fs-guide-lock-bar" aria-hidden>
              <span style={{ width: `${Math.max(4, lock.progress * 100)}%` }} />
            </span>
            <small>{unlockHint(lock, examName)}</small>
          </div>
          {locked.map((m) => (
            <span key={m.id} className="fs-guide-item is-locked" aria-disabled="true" title={`${m.name}: ${unlockHint(lock, examName)}`}>
              <SpaceIcon name={m.icon} size={22} />
              <span>{m.name}</span>
              <Lock size={14} aria-hidden className="fs-guide-lock-icon" />
            </span>
          ))}
        </>
      ) : (
        <button type="button" className="fs-guide-item" onClick={onCreate}>
          <Plus size={22} aria-hidden />
          <span>New space</span>
        </button>
      )}
    </nav>
  );
}
