import { describe, expect, it } from 'vitest';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT } from '@/billing/plans';
import { canSave, SAVE_PROMPT } from './save-gate';

describe('save gate', () => {
  it('lets only a signed-in learner save', () => {
    expect(canSave({ user: { id: 'u1', email: 'a@b.c' } })).toBe(true);
    expect(canSave({ user: null })).toBe(false);
    expect(canSave(null)).toBe(false);
    expect(canSave(undefined)).toBe(false);
  });

  it('states the Space allowance from the plans, not a copy of it', () => {
    expect(SAVE_PROMPT.chat.body).toContain(`${FREE_SPACE_LIMIT} Spaces instead of ${GUEST_SPACE_LIMIT}`);
  });

  // Signing in keeps saves in this browser under the account; nothing syncs anywhere yet.
  it('never promises sync or other devices', () => {
    const all = [SAVE_PROMPT.note.title, SAVE_PROMPT.note.body, SAVE_PROMPT.chat.title, SAVE_PROMPT.chat.body, SAVE_PROMPT.library].join(' ');
    expect(all).not.toMatch(/sync|any device|every device|all your devices|cloud|backup/i);
  });
});
