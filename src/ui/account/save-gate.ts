import type { AuthState } from '@/types/auth';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT } from '@/billing/plans';

/**
 * Saving to the Library needs a FocusSpace account. Without one, everything still works — notes and
 * mind maps generate, FocusSpace AI answers — but nothing is kept: the result lives in the panel until
 * it closes. Where a Save would be, the learner is told plainly what signing in gets them instead.
 *
 * The prompt sits inline, where the Save button would be or under the latest answer. It is never a
 * modal and never interrupts: it is a recommendation, not a wall.
 *
 * The background refuses `notes/save` for a signed-out learner too (service-worker.ts), so a surface
 * that forgets to check cannot quietly keep a guest's note. Pure on purpose — the service worker imports
 * it; the React side lives in ./use-can-save.ts.
 */

export const canSave = (auth: Pick<AuthState, 'user'> | null | undefined): boolean => !!auth?.user;

/** The error the background returns when a signed-out learner's save reaches it. */
export const SAVE_NEEDS_ACCOUNT = 'Sign in to FocusSpace to save to your Library.';

/**
 * Only what signing in really does today: saves are kept in this browser's Library under the account,
 * filed by Space, and a free account allows more Spaces. No sync, no "any device" — neither is built.
 */
export const SAVE_PROMPT = {
  note: {
    title: 'Sign in to save this',
    body: 'Notes and mind maps you save go to your Library in the FocusSpace extension, filed under their Space and kept with your account, so they are ready whenever you come back to revise.',
  },
  chat: {
    title: 'Sign in to save this conversation',
    body: `This chat will not be kept once you close the panel. Signed in, your conversations, notes and mind maps are saved to your Library under your FocusSpace account, so you can pick up where you left off. A free account also gives you ${FREE_SPACE_LIMIT} Spaces instead of ${GUEST_SPACE_LIMIT}.`,
  },
  library: 'Sign in to save notes, mind maps and AI chats here. Anything you create while signed out stays in the panel until you close it.',
  action: 'Sign in',
  dismiss: 'Not now',
} as const;
