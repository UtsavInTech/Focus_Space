import { useEffect, useMemo } from 'react';
import { isExamId } from '@/modes/exams';
import { unlockAllSpaces } from '@/modes/service';
import { lockState, type LockState } from '@/modes/unlock';
import { useStorage } from './hooks';

/**
 * Whether new Spaces are locked right now (modes/unlock.ts). Once a learner has studied enough to open
 * them, that is recorded for good, so a pruned watch history never locks them again.
 */
export function useLockState(): LockState | null {
  const store = useStorage(['settings', 'watchHistory'] as const);
  const state = useMemo(() => (store ? lockState(store.settings, store.watchHistory) : null), [store]);
  const earned = !!store && isExamId(store.settings.exam) && !store.settings.spacesUnlocked && !!state && !state.locked;
  useEffect(() => {
    if (earned) void unlockAllSpaces();
  }, [earned]);
  return state;
}
