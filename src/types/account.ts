/**
 * Account shapes shared by the background clients, the messages protocol and
 * the UI — the extension's view of Layer 2B's verified sign-up / phone sign-in
 * and Layer 2C's Space allowance. Nothing here is persisted; `AuthState`
 * (src/types/auth.ts) remains the only stored account value.
 */

/** A verification code was sent. `devCode` appears only when the server runs with AUTH_DEV_CODES=1. */
export interface CodeSent {
  ok: true;
  /** Which sender delivered it — 'console' while no email/SMS provider is configured. */
  delivery: string;
  devCode?: string;
  expiresAt: number;
}

export interface SignupTicket {
  ok: true;
  ticket: string;
  expiresAt: number;
}

export interface ProfilePatch {
  name?: string | null;
  city?: string | null;
}

/** One payment as the account page lists it (server/usage/db.ts PaymentRow). */
export interface PaymentRecord {
  id: string;
  plan: string;
  period: string;
  currency: string;
  amount_minor: number;
  status: string;
  created_at: number;
}

export interface SpaceAllowanceView {
  plan: string;
  used: number;
  /** `null` is unlimited (Infinity does not survive JSON), never "unknown". */
  limit: number | null;
}

/**
 * The server's answer to "may I create one more Space?".
 *
 * `allowance: null` means there is no account/server to ask — the local,
 * anonymous experience, where FocusSpace applies the same Free-plan limit
 * itself so the rule a learner sees doesn't change when they sign in.
 */
export type SpaceAuthorization =
  | { ok: true; allowance: SpaceAllowanceView | null }
  | { ok: false; code: 'space_limit'; error: string; allowance: SpaceAllowanceView | null }
  | { ok: false; code: 'error'; error: string; allowance: null };
