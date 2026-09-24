import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../http';

/**
 * Google sign-in, as an ordinary OAuth 2.0 authorization-code flow run entirely by this server.
 *
 * The client secret lives in this process's environment and nowhere else. Neither the website nor the
 * extension ever holds it, ever sees an authorization code, or ever talks to Google directly: the
 * browser is redirected to Google, Google redirects back *here*, and this server does the exchange. The
 * only thing that reaches a client afterwards is a FocusSpace handoff code (auth/handoff.ts).
 *
 * That choice is what lets the extension offer "Continue with Google" without shipping a client secret
 * or a redirect URI of its own, and without `chrome.identity` — the extension opens the website, the
 * website runs this flow, and the result comes back over the existing externally_connectable channel.
 *
 * Configuration (all server-side, none of it in any build output):
 *
 *   GOOGLE_CLIENT_ID      the OAuth 2.0 Web application client id
 *   GOOGLE_CLIENT_SECRET  its secret
 *   GOOGLE_REDIRECT_URI   this server's own callback, e.g. https://api.focusspace.xyz/v1/auth/google/callback
 *
 * Unset, every Google route answers "not configured" and every other form of sign-in is unaffected —
 * the same additive rule the rest of the auth layer follows.
 */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function loadGoogleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Identity only. FocusSpace asks for no Google data beyond who you are. */
const SCOPES = 'openid email profile';

/** How long a started sign-in stays valid. Long enough to pick an account, short enough to be useless later. */
const STATE_TTL_MS = 10 * 60_000;

export interface GoogleProfile {
  /** Google's stable, never-reused id for this account. The thing worth storing. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/**
 * CSRF protection, without a session to hang it on.
 *
 * The state is `<nonce>.<issuedAt>.<returnTo>` with an HMAC over it, signed with the server's existing
 * token secret. Nothing is stored: the signature is what makes the value trustworthy when it comes back,
 * and the timestamp is what stops an old one being replayed. `returnTo` rides along so the callback
 * knows which surface started this, and is validated against an allow-list before it is ever used.
 */
export function createState(secret: string, returnTo: string, now = Date.now()): string {
  const payload = `${randomBytes(16).toString('base64url')}.${now}.${Buffer.from(returnTo, 'utf8').toString('base64url')}`;
  return `${payload}.${sign(payload, secret)}`;
}

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function verifyState(state: unknown, secret: string, now = Date.now()): { returnTo: string } {
  const invalid = new ApiError(400, 'invalid_request', 'That Google sign-in could not be verified. Start again.');
  if (typeof state !== 'string') throw invalid;
  const parts = state.split('.');
  if (parts.length !== 4) throw invalid;
  const [nonce, issuedAt, encodedReturn, signature] = parts;
  const expected = sign(`${nonce}.${issuedAt}.${encodedReturn}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw invalid;
  const at = Number(issuedAt);
  if (!Number.isFinite(at) || now - at > STATE_TTL_MS || at > now + 60_000) throw invalid;
  return { returnTo: Buffer.from(encodedReturn, 'base64url').toString('utf8') };
}

export function authorizeUrl(config: GoogleConfig, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  // Ask every time rather than silently reusing whichever account Google last used — a shared computer
  // signing someone into the wrong FocusSpace account is worse than one extra click.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Decodes an id_token's payload. The token came straight from Google's endpoint over TLS in the exchange below, so its signature is not re-verified here — see the note in `exchangeCode`. */
function decodeIdToken(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new ApiError(502, 'upstream_error', 'Google returned a token FocusSpace could not read.');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new ApiError(502, 'upstream_error', 'Google returned a token FocusSpace could not read.');
  }
}

/**
 * Exchanges the authorization code for Google's id_token and reads the profile out of it.
 *
 * The id_token's signature is not independently verified, and that is safe *only* because of how it
 * arrives: this is a direct, server-to-server HTTPS POST to Google's own token endpoint, authenticated
 * with the client secret. Nothing between here and Google can substitute a token, so there is no
 * attacker-supplied path into this function — which is exactly the condition Google's own documentation
 * gives for skipping local validation. If this ever accepts an id_token from a *client* instead, that
 * stops being true and full JWKS verification becomes mandatory.
 */
export async function exchangeCode(config: GoogleConfig, code: string): Promise<GoogleProfile> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
  } catch {
    throw new ApiError(502, 'upstream_error', 'FocusSpace could not reach Google. Try again in a moment.');
  }

  const body = (await res.json().catch(() => null)) as { id_token?: unknown; error_description?: unknown } | null;
  if (!res.ok || typeof body?.id_token !== 'string') {
    // Google's own description is useful to an operator and meaningless to an attacker, but it is not
    // shown to the learner: the route turns every failure into the same sentence.
    throw new ApiError(502, 'upstream_error', typeof body?.error_description === 'string' ? `Google refused the sign-in: ${body.error_description}` : 'Google refused the sign-in.');
  }

  const claims = decodeIdToken(body.id_token);
  const sub = typeof claims.sub === 'string' ? claims.sub : null;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
  // `email_verified` arrives as a boolean or the string "true" depending on the flow.
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!sub || !email) throw new ApiError(502, 'upstream_error', 'Google did not return an email address for that account.');
  // An unverified Google address must never match an existing FocusSpace account: that is account
  // takeover by signing up to Google with someone else's address.
  if (!emailVerified) throw new ApiError(403, 'forbidden', 'That Google account’s email address is not verified. Verify it with Google first.');

  return { sub, email, emailVerified, name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null };
}
