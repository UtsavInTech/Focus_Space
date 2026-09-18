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

export type ErrorCode = 'invalid_request' | 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'space_limit' | 'invalid_signature' | 'billing_unavailable' | 'upstream_error' | 'internal_error';

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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
