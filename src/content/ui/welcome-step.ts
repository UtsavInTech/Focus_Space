import type { WelcomeState } from '@/storage/schema';

/** The three steps the first-run guide walks through, in order. */
export type WelcomeStep = 'signin' | 'space' | 'channels';

export const WELCOME_STEPS: { id: WelcomeStep; label: string }[] = [
  { id: 'signin', label: 'Sign in' },
  { id: 'space', label: 'Your Spaces' },
  { id: 'channels', label: 'Your channels' },
];

/**
 * Which step the guide is on — read off the account, the Spaces and the setup conversation rather than
 * stored separately, so signing in on the website or picking a subject on the page moves it along by
 * itself. A conversation in progress holds step 2 until it is finished, even once its first Space exists.
 * `null` hides the guide.
 */
export function welcomeStep(welcome: WelcomeState, signedIn: boolean, hasSpace: boolean): WelcomeStep | null {
  if (!welcome.active) return null;
  if (!signedIn && !welcome.signInSkipped) return 'signin';
  if (!hasSpace || (welcome.chat && !welcome.chat.finished)) return 'space';
  return 'channels';
}
