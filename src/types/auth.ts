/**
 * FocusSpace account state (Layer 2B). Purely local caching of what the
 * server told us — the server (server/auth/*) remains the source of truth
 * for the account itself; this is just enough to restore a session after an
 * extension/browser restart without asking the learner to sign in again.
 *
 * Anonymous is the default and fully-supported state: `user: null`. Nothing
 * else in FocusSpace reads this file — see docs/LAYER_2B_IDENTITY.md §O/§P
 * for why identity stays decoupled from every existing local feature.
 */

export interface AuthUser {
  id: string;
  /** Null for a phone-only account. */
  email: string | null;
  phone?: string | null;
  /** Whether the email address was confirmed with a code (Layer 2B verified sign-up). */
  emailVerified?: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
}
