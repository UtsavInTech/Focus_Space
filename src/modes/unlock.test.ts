import { describe, expect, it } from 'vitest';
import type { WatchEntry } from '@/types/domain';
import { isSpaceLocked, lockState, studiedMinutes, UNLOCK_MINUTES } from './unlock';

const watched = (modeId: string, minutes: number, progress = 1): WatchEntry =>
  ({ videoId: `${modeId}-${minutes}-${progress}`, title: '', channelTitle: '', channelId: null, modeId, topicId: null, watchedAt: 0, progress, durationSec: minutes * 60, playlistId: null, playlistIndex: null }) as WatchEntry;

describe('locked Spaces', () => {
  it('never locks anything for learners without an exam, or from before exams existed', () => {
    expect(lockState({ exam: null, spacesUnlocked: false }, []).locked).toBe(false);
    expect(lockState({ exam: 'none', spacesUnlocked: false }, []).locked).toBe(false);
  });

  it('locks every other Space for a new UPSC learner, but never the UPSC Space or Spaces they have', () => {
    const state = lockState({ exam: 'upsc', spacesUnlocked: false }, []);
    expect(state.locked).toBe(true);
    expect(isSpaceLocked('upsc', state, [])).toBe(false);
    expect(isSpaceLocked('ssc', state, [])).toBe(true);
    expect(isSpaceLocked('dsa', state, [{ id: 'dsa' }])).toBe(false);
  });

  it('counts only what was watched in the exam Space, and opens at the threshold', () => {
    const history = [watched('upsc', 40, 0.5), watched('dsa', 120)];
    expect(studiedMinutes(history, 'upsc')).toBe(20);
    expect(lockState({ exam: 'upsc', spacesUnlocked: false }, history).remaining).toBe(UNLOCK_MINUTES - 20);
    expect(lockState({ exam: 'upsc', spacesUnlocked: false }, [...history, watched('upsc', UNLOCK_MINUTES)]).locked).toBe(false);
  });

  it('opens everything when chosen in Settings', () => {
    expect(lockState({ exam: 'upsc', spacesUnlocked: true }, []).locked).toBe(false);
  });
});
