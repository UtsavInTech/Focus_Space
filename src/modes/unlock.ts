import type { LearningMode, Settings, WatchEntry } from '@/types/domain';
import { isExamId } from './exams';

/**
 * Locked Spaces: someone who said "I'm preparing for UPSC" starts with exactly one Space — UPSC. Every
 * other Space stays on the map, visibly, with a lock and a progress bar, and opens once they have
 * really studied: `UNLOCK_MINUTES` of video watched in their exam Space. The point is the first week:
 * a new learner who could open fifteen Spaces on day one usually ends up in none of them.
 *
 * Nobody is trapped: Settings has "Open every Space now". Learners who did not choose an exam, and
 * every install from before exams existed (`exam: null`), never see a lock. Spaces a learner already
 * has are never locked — the lock is on making new ones.
 */

export const UNLOCK_MINUTES = 60;

type LockSettings = Pick<Settings, 'exam' | 'spacesUnlocked'>;

/** Minutes of video actually watched in a Space, from FocusSpace's own watch history. */
export function studiedMinutes(history: readonly WatchEntry[], modeId: string): number {
  let seconds = 0;
  for (const entry of history) {
    if (entry.modeId !== modeId || !entry.durationSec) continue;
    seconds += Math.max(0, Math.min(1, entry.progress)) * entry.durationSec;
  }
  return Math.floor(seconds / 60);
}

export interface LockState {
  /** True while new Spaces are locked. */
  locked: boolean;
  examId: string | null;
  studied: number;
  remaining: number;
  /** 0–1 towards unlocking. */
  progress: number;
}

export function lockState(settings: LockSettings, history: readonly WatchEntry[]): LockState {
  const examId = isExamId(settings.exam) ? settings.exam : null;
  if (!examId || settings.spacesUnlocked) return { locked: false, examId, studied: 0, remaining: 0, progress: 1 };
  const studied = studiedMinutes(history, examId);
  const remaining = Math.max(0, UNLOCK_MINUTES - studied);
  return { locked: remaining > 0, examId, studied, remaining, progress: Math.min(1, studied / UNLOCK_MINUTES) };
}

/** Whether this Space can't be opened yet. The exam Space and Spaces already made are always open. */
export function isSpaceLocked(spaceId: string, state: LockState, modes: readonly Pick<LearningMode, 'id'>[]): boolean {
  if (!state.locked) return false;
  return spaceId !== state.examId && !modes.some((m) => m.id === spaceId);
}

/** The one line a locked Space says about itself. */
export function unlockHint(state: LockState, examName: string): string {
  return state.remaining <= 1 ? `Unlocks after your next ${examName} video` : `Study ${state.remaining} more min of ${examName} to unlock`;
}
