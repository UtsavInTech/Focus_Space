import { describe, expect, it } from 'vitest';
import { welcomeStep } from './welcome-step';
import type { WelcomeChat } from '@/storage/schema';

const on = { active: true, signInSkipped: false, chat: null, talked: false, oneByOne: false, spacesSkipped: false };
const chat = (over: Partial<WelcomeChat>): WelcomeChat => ({ phase: 'channels', made: [{ id: 'dsa', name: 'DSA', channels: [] }], pending: ['dsa'], lines: [], finished: false, ...over });

describe('welcomeStep', () => {
  it('stays hidden unless the install switched it on', () => {
    expect(welcomeStep({ ...on, active: false }, false, false)).toBeNull();
  });

  it('asks a signed-out learner to sign in first', () => {
    expect(welcomeStep(on, false, false)).toBe('signin');
    expect(welcomeStep(on, false, true)).toBe('signin');
  });

  it('moves to Spaces once signed in, or once sign-in is put off', () => {
    expect(welcomeStep(on, true, false)).toBe('space');
    expect(welcomeStep({ ...on, signInSkipped: true }, false, false)).toBe('space');
  });

  it('ends on importing channels once a Space is chosen', () => {
    expect(welcomeStep(on, true, true)).toBe('channels');
  });

  it('goes straight to importing channels when they skip setting up Spaces', () => {
    expect(welcomeStep({ ...on, spacesSkipped: true }, true, false)).toBe('channels');
    expect(welcomeStep({ ...on, spacesSkipped: true }, false, false)).toBe('signin');
  });

  it('holds step 2 while the setup conversation is still going, even after its first Space', () => {
    expect(welcomeStep({ ...on, chat: chat({}) }, true, true)).toBe('space');
    expect(welcomeStep({ ...on, chat: chat({ finished: true }) }, true, true)).toBe('channels');
  });
});
