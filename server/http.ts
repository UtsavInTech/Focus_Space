import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Small HTTP helpers — the same minimal, dependency-free style as
 * scripts/ai-endpoint/server.mjs. No framework: this project doesn't use one
 * anywhere else, and the surface here (read a bounded JSON body, send a
 * typed JSON response) doesn't need one.
 *
 * Shared by both route groups (/v1/ai/* and /v1/auth/*, /v1/me) — one error
 * shape and one `ApiError` class, not a duplicate per domain.
 */

export type ErrorCode = 'invalid_request' | 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'space_limit' | 'invalid_signature' | 'unknown_purchase' | 'purchase_mismatch' | 'billing_unavailable' | 'upstream_error' | 'internal_error';

export interface ApiErrorResponse {
  ok: false;
  code: ErrorCode;
  error: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  toResponse(): ApiErrorResponse {
    return { ok: false, code: this.code, error: this.message };
  }
}

/** Local-dev CORS: permissive by necessity (unpacked extension ids vary per install) — see docs for the production note. */
/**
 * `*` is correct here and not laziness: this API authenticates with a Bearer
 * token, never a cookie, so there is no ambient authority for another origin
 * to abuse. A wildcard with credentials would be the dangerous combination,
 * and it is one the browser refuses outright.
 *
 * The rest are defence in depth for the few cases where a browser renders an
 * API response directly — an error page, a mistyped URL.
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-FocusSpace-Install, If-None-Match',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Reads the body as text, rejecting once it exceeds `maxBytes` — never buffers
 * an unbounded body.
 *
 * Exposed separately from `readJsonBody` because a signed webhook must be
 * verified against the *exact bytes received*: re-serialising parsed JSON
 * changes whitespace and key order, and the HMAC stops matching.
 */
export async function readTextBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError(413, 'invalid_request', 'Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads the request body as JSON, rejecting once it exceeds `maxBytes`. */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const text = await readTextBody(req, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_request', 'Malformed JSON body.');
  }
}

/**
 * The caller's address, for per-address limits. Behind a proxy (Railway in production) the socket's peer
 * is the proxy itself — keying on it made every signed-out learner share one allowance and one rate
 * limit. With `trustProxy`, the proxy's own record of the client is used: `X-Real-IP`, else the last
 * `X-Forwarded-For` entry (the one the proxy appended; earlier entries are whatever the client claimed).
 * Without a proxy those headers are the client's to forge, so they are ignored.
 */
export function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }, trustProxy: boolean): string {
  if (trustProxy) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim();
    const forwarded = req.headers['x-forwarded-for'];
    const list = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list[list.length - 1];
  }
  return req.socket.remoteAddress ?? 'unknown';
}
