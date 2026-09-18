import { ApiError } from '../http';

/**
 * Validation for the auth routes — separate from server/validate.ts (the AI
 * request validator). Same hand-written, no-framework convention (see
 * server/validate.ts's own note on this), kept in its own file so auth and
 * AI concerns never get tangled — the whole point of routing them under
 * /v1/auth/* and /v1/ai/* separately in the first place.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;
const MAX_EMAIL_LEN = 254;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** lower+trim — the same normalization the UNIQUE index in db.ts assumes, so "A@x.com" and "a@x.com" are one account. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface RegisterOrLoginRequest {
  email: string;
  password: string;
}

export function validateCredentials(raw: unknown): RegisterOrLoginRequest {
  if (!isPlainObject(raw)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object body.');
  const { email, password } = raw;
  if (typeof email !== 'string' || !email.trim()) throw new ApiError(400, 'invalid_request', 'A valid "email" is required.');
  const normalized = normalizeEmail(email);
  if (normalized.length > MAX_EMAIL_LEN || !EMAIL_RE.test(normalized)) throw new ApiError(400, 'invalid_request', 'A valid "email" is required.');
  if (typeof password !== 'string') throw new ApiError(400, 'invalid_request', '"password" is required.');
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    throw new ApiError(400, 'invalid_request', `"password" must be between ${MIN_PASSWORD_LEN} and ${MAX_PASSWORD_LEN} characters.`);
  }
  return { email: normalized, password };
}

const CODE_RE = /^\d{6}$/;
/** E.164 without the punctuation people type: 8–15 digits, no leading zero on the country code. */
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

export function normalizePhone(phone: string): string {
  const compact = phone.replace(/[\s()\-.]/g, '');
  return compact.startsWith('+') ? compact : `+${compact}`;
}

export function validateEmailOnly(raw: unknown): { email: string } {
  if (!isPlainObject(raw)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object body.');
  const { email } = raw;
  if (typeof email !== 'string' || !email.trim()) throw new ApiError(400, 'invalid_request', 'A valid "email" is required.');
  const normalized = normalizeEmail(email);
  if (normalized.length > MAX_EMAIL_LEN || !EMAIL_RE.test(normalized)) throw new ApiError(400, 'invalid_request', 'A valid "email" is required.');
  return { email: normalized };
}

export function validateEmailCode(raw: unknown): { email: string; code: string } {
  const { email } = validateEmailOnly(raw);
  const code = (raw as Record<string, unknown>).code;
  if (typeof code !== 'string' || !CODE_RE.test(code.trim())) throw new ApiError(400, 'invalid_request', 'Enter the 6-digit code.');
  return { email, code: code.trim() };
}

export function validateSignupCompletion(raw: unknown): { ticket: string; password: string } {
  if (!isPlainObject(raw)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object body.');
  const { ticket, password } = raw;
  if (typeof ticket !== 'string' || !ticket.trim()) throw new ApiError(400, 'invalid_request', 'A verification "ticket" is required.');
  if (typeof password !== 'string') throw new ApiError(400, 'invalid_request', '"password" is required.');
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    throw new ApiError(400, 'invalid_request', `"password" must be between ${MIN_PASSWORD_LEN} and ${MAX_PASSWORD_LEN} characters.`);
  }
  return { ticket: ticket.trim(), password };
}

export function validatePhoneOnly(raw: unknown): { phone: string } {
  if (!isPlainObject(raw)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object body.');
  const { phone } = raw;
  if (typeof phone !== 'string' || !phone.trim()) throw new ApiError(400, 'invalid_request', 'A valid "phone" number is required.');
  const normalized = normalizePhone(phone);
  if (!PHONE_RE.test(normalized)) throw new ApiError(400, 'invalid_request', 'Enter a phone number with its country code, e.g. +919876543210.');
  return { phone: normalized };
}

export function validatePhoneCode(raw: unknown): { phone: string; code: string } {
  const { phone } = validatePhoneOnly(raw);
  const code = (raw as Record<string, unknown>).code;
  if (typeof code !== 'string' || !CODE_RE.test(code.trim())) throw new ApiError(400, 'invalid_request', 'Enter the 6-digit code.');
  return { phone, code: code.trim() };
}

export function validateSpaceRequest(raw: unknown): { spaceId: string; name: string | null } {
  if (!isPlainObject(raw)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object body.');
  const { spaceId, name } = raw;
  if (typeof spaceId !== 'string' || !spaceId.trim() || spaceId.length > 80) throw new ApiError(400, 'invalid_request', 'A "spaceId" is required.');
  return { spaceId: spaceId.trim(), name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null };
}

export interface RefreshRequest {
  refreshToken: string;
}

export function validateRefreshRequest(raw: unknown): RefreshRequest {
  if (!isPlainObject(raw) || typeof raw.refreshToken !== 'string' || !raw.refreshToken.trim()) {
    throw new ApiError(400, 'invalid_request', 'A "refreshToken" is required.');
  }
  return { refreshToken: raw.refreshToken };
}
