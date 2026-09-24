import { describe, expect, it } from 'vitest';
import { shouldShowAiEntry } from './ai-entry-visibility';

/**
 * Regression coverage for the real-world bug: the FocusSpace AI bubble stayed visible/usable on YouTube
 * even after Focus Mode was turned off, because it used to be gated on "a Space exists" rather than on
 * "FocusSpace is active" (Focus Mode on *and* a Space exists). `active` here is exactly what ContentApp.tsx
 * passes in — `s.ready && s.settings.focusEnabled && !!mode` — so `active: false` is the FocusSpace-OFF
 * case regardless of whether a Space was ever selected.
 */
describe('shouldShowAiEntry', () => {
  it('is hidden everywhere when FocusSpace is not active (the OFF case), even with a Space selected', () => {
    expect(shouldShowAiEntry(false, 'home')).toBe(false);
    expect(shouldShowAiEntry(false, 'watch')).toBe(false);
    expect(shouldShowAiEntry(false, 'search')).toBe(false);
  });

  it('is shown on the home and search pages while active', () => {
    expect(shouldShowAiEntry(true, 'home')).toBe(true);
    expect(shouldShowAiEntry(true, 'search')).toBe(true);
  });

  it('is hidden on the watch page while active, because "Learn with AI" already sits in the watch rail there', () => {
    expect(shouldShowAiEntry(true, 'watch')).toBe(false);
  });
});
