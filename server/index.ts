// FocusSpace API (Layer 2A) — the extension's real backend, replacing "extension
// → OpenRouter directly" with "extension → FocusSpace API → AI Orchestrator →
// OpenRouter". The key lives only in this process's environment.
//
//   OPENROUTER_API_KEY=sk-or-... npm run ai-api
//   → FocusSpace Settings → Learning companion → My endpoint → http://127.0.0.1:8788/v1/ai/complete
//
// Env: PORT (8788), HOST (127.0.0.1), OPENROUTER_MODEL (openai/gpt-4o-mini), MAX_TOKENS (700).
//
// One route, not three (/v1/ai/chat, /v1/ai/action, /v1/ai/notes as sketched
// in the design): the extension has exactly one configured endpoint URL
// (Settings → AI → "Your endpoint") and sends every action to it — a single
// dispatching route is what makes "point the existing extension at this API"
// a configuration change, not a code change. `action` in the body is what
// distinguishes a chat turn from a point action from a notes request; see
// orchestrator.ts.
//
// scripts/ai-endpoint/server.mjs (the original reference relay) is untouched
// and still works — it's the simpler, zero-orchestration option for anyone
// who just wants a raw OpenRouter relay for local dev.
import { createServer } from 'node:http';
import { ApiError, CORS_HEADERS, readJsonBody, sendJson, type ApiErrorResponse } from './http';
import { loadOpenRouterConfig } from './openrouter';
import { orchestrate } from './orchestrator';
import { validateAiApiRequest } from './validate';
import { getDb } from './auth/db';
import {
  authenticate,
  completeEmailSignup,
  loadAuthConfig,
  login,
  logout,
  refresh,
  register,
  startEmailSignup,
  startPhoneSignIn,
  tryAuthenticate,
  verifyEmailSignup,
  verifyPhoneSignIn,
  type AuthConfig,
} from './auth/service';
import { validateCredentials, validateEmailCode, validateEmailOnly, validatePhoneCode, validatePhoneOnly, validateRefreshRequest, validateSignupCompletion, validateSpaceRequest } from './auth/validate';
import { RateLimiter } from './auth/rate-limit';
import { loadSenders } from './notify/sender';
import { getUsageDb } from './usage/db';
import { anonymousKey, assertAnonymousQuota, commitUsage, recordAnonymousUsage, releaseUsage, reserveUsage, usageStatus } from './usage/service';
import { registerSpace, spaceAllowance, unregisterSpace } from './usage/spaces';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '127.0.0.1';
/** Generous enough for a full-video note's context; still a hard cap — see validate.ts for the finer-grained per-field limits. */
const MAX_BODY_BYTES = 256 * 1024;
/** Auth bodies are just an email + password (or a refresh token) — a much tighter cap than the AI route needs. */
const AUTH_MAX_BODY_BYTES = 8 * 1024;
const ROUTE = '/v1/ai/complete';
const HEALTH_ROUTE = '/v1/health';
const AUTH_REGISTER_ROUTE = '/v1/auth/register';
const AUTH_LOGIN_ROUTE = '/v1/auth/login';
const AUTH_REFRESH_ROUTE = '/v1/auth/refresh';
const AUTH_LOGOUT_ROUTE = '/v1/auth/logout';
const ME_ROUTE = '/v1/me';
const ME_USAGE_ROUTE = '/v1/me/usage';
const ME_SPACES_ROUTE = '/v1/me/spaces';
// Verified sign-up (email → code → password) and phone OTP sign-in. Same /v1/auth/* group, same
// AuthConfig, same session issuing as register/login — see server/auth/service.ts.
const SIGNUP_START_ROUTE = '/v1/auth/signup/start';
const SIGNUP_VERIFY_ROUTE = '/v1/auth/signup/verify';
const SIGNUP_COMPLETE_ROUTE = '/v1/auth/signup/complete';
const PHONE_START_ROUTE = '/v1/auth/phone/start';
const PHONE_VERIFY_ROUTE = '/v1/auth/phone/verify';
const AUTH_ROUTES = new Set([AUTH_REGISTER_ROUTE, AUTH_LOGIN_ROUTE, AUTH_REFRESH_ROUTE, AUTH_LOGOUT_ROUTE, SIGNUP_START_ROUTE, SIGNUP_VERIFY_ROUTE, SIGNUP_COMPLETE_ROUTE, PHONE_START_ROUTE, PHONE_VERIFY_ROUTE, ME_ROUTE, ME_USAGE_ROUTE]);

// Layer 2C — a burst/abuse safety net for the anonymous half of /v1/ai/complete, structurally separate
// from the persisted, user_id-keyed usage/entitlement system below (see docs/LAYER_2C_USAGE_ENTITLEMENTS.md,
// "Rate limiting vs. quota"). Reuses the exact same RateLimiter class Layer 2B already established for
// login/register, keyed by IP since there is no account identity to key an anonymous caller by.
const anonymousAiLimiter = new RateLimiter(30, 10 * 60_000);

// Verification-code delivery (email/SMS). No provider is configured by default: codes are logged by
// the development sender, and only returned to the caller when AUTH_DEV_CODES=1 — never in production.
// See server/notify/sender.ts.
const senders = loadSenders();

let config;
try {
  config = loadOpenRouterConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// Auth is additive (§14): a server started without AUTH_TOKEN_SECRET must keep serving /v1/ai/complete
// exactly as Layer 2A did. Only the /v1/auth/* and /v1/me routes become unavailable in that case — the
// whole process must never refuse to start over a missing auth secret the AI routes don't need.
let authConfig: AuthConfig | null = null;
try {
  authConfig = loadAuthConfig();
} catch (err) {
  console.warn(`[FocusSpace API] Auth routes disabled: ${err instanceof Error ? err.message : String(err)}`);
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  try {
    // Unauthenticated on purpose (no secret, no config value) — just "is this process up and configured",
    // for fast local diagnosis. Never reveals whether the OpenRouter key or auth secret is actually valid.
    if (req.method === 'GET' && req.url === HEALTH_ROUTE) {
      sendJson(res, 200, { ok: true, status: 'ok', model: config.model, auth: authConfig ? 'enabled' : 'disabled' });
      return;
    }

    // ── AI (Layer 2A contract unchanged; Layer 2C adds server-side usage/entitlement enforcement for
    // authenticated callers only — anonymous access is untouched, see docs/LAYER_2C_USAGE_ENTITLEMENTS.md). ──
    if (req.method === 'POST' && req.url === ROUTE) {
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const request = validateAiApiRequest(body);

      // A present-but-invalid/expired token degrades to anonymous rather than failing the request outright —
      // the AI companion must keep working even with a stale token; identity here is optional context, not a gate.
      const identity = authConfig ? tryAuthenticate(getDb(), authConfig, req.headers.authorization) : null;

      if (!identity) {
        const ip = req.socket.remoteAddress ?? 'unknown';
        if (!anonymousAiLimiter.attempt(ip)) throw new ApiError(429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.');
        // A small daily allowance without an account (Layer 2C). Checked before the upstream call and
        // recorded only after a successful one, so a failed request never costs the learner anything.
        const anonDb = getUsageDb();
        const key = anonymousKey(ip, authConfig?.tokenSecret ?? config.model);
        assertAnonymousQuota(anonDb, key, request.action);
        const result = await orchestrate(request, { config });
        recordAnonymousUsage(anonDb, key, request.action);
        sendJson(res, 200, result);
        return;
      }

      const usageDb = getUsageDb();
      const reservation = reserveUsage(usageDb, identity.user.id, request.action, request.idempotencyKey ?? null);
      try {
        const result = await orchestrate(request, { config });
        if (reservation.kind === 'ok') commitUsage(usageDb, reservation.id, { model: result.model, promptTokens: result.usage?.promptTokens ?? null, completionTokens: result.usage?.completionTokens ?? null });
        sendJson(res, 200, result);
      } catch (err) {
        if (reservation.kind === 'ok') releaseUsage(usageDb, reservation.id);
        throw err;
      }
      return;
    }

    // ── Auth (Layer 2B) — every route below 503s with a clear message if AUTH_TOKEN_SECRET isn't set,
    // rather than the process refusing to start (see the authConfig load above). ──
    const path = (req.url ?? '').split('?')[0];
    if (AUTH_ROUTES.has(path) || path === ME_SPACES_ROUTE) {
      if (!authConfig) throw new ApiError(503, 'internal_error', 'Authentication is not configured on this server.');
      const db = getDb();
      const userAgent = req.headers['user-agent'] ?? null;

      if (req.method === 'POST' && path === AUTH_REGISTER_ROUTE) {
        const { email, password } = validateCredentials(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 201, { ok: true, ...register(db, authConfig, email, password, userAgent) });
        return;
      }
      if (req.method === 'POST' && path === AUTH_LOGIN_ROUTE) {
        const { email, password } = validateCredentials(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...login(db, authConfig, email, password, userAgent) });
        return;
      }
      // ── Verified sign-up: email → code → password ──
      if (req.method === 'POST' && path === SIGNUP_START_ROUTE) {
        const { email } = validateEmailOnly(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...(await startEmailSignup(db, authConfig, senders, email)) });
        return;
      }
      if (req.method === 'POST' && path === SIGNUP_VERIFY_ROUTE) {
        const { email, code } = validateEmailCode(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...verifyEmailSignup(db, authConfig, email, code) });
        return;
      }
      if (req.method === 'POST' && path === SIGNUP_COMPLETE_ROUTE) {
        const { ticket, password } = validateSignupCompletion(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 201, { ok: true, ...completeEmailSignup(db, authConfig, ticket, password, userAgent) });
        return;
      }

      // ── Phone sign-in (OTP) ──
      if (req.method === 'POST' && path === PHONE_START_ROUTE) {
        const { phone } = validatePhoneOnly(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...(await startPhoneSignIn(db, authConfig, senders, phone)) });
        return;
      }
      if (req.method === 'POST' && path === PHONE_VERIFY_ROUTE) {
        const { phone, code } = validatePhoneCode(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...verifyPhoneSignIn(db, authConfig, phone, code, userAgent) });
        return;
      }

      if (req.method === 'POST' && path === AUTH_REFRESH_ROUTE) {
        const { refreshToken } = validateRefreshRequest(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...refresh(db, authConfig, refreshToken) });
        return;
      }
      if (req.method === 'POST' && path === AUTH_LOGOUT_ROUTE) {
        const { sessionId } = authenticate(db, authConfig, req.headers.authorization);
        logout(db, sessionId);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && path === ME_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        sendJson(res, 200, { ok: true, user });
        return;
      }
      // Layer 2C — unlike /v1/ai/complete's fail-open policy, this route has nothing meaningful to answer
      // for an unverified caller, so it requires a genuinely valid token and 401s otherwise.
      if (req.method === 'GET' && path === ME_USAGE_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        sendJson(res, 200, { ok: true, ...usageStatus(getUsageDb(), user.id) });
        return;
      }

      // ── Spaces allowance (Layer 2C entitlement, enforced here — not in the UI) ──
      if (path === ME_SPACES_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const usageDb = getUsageDb();
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, ...spaceAllowance(usageDb, user.id), spaces: usageDb.listSpaces(user.id).map((s) => ({ spaceId: s.space_id, name: s.name, createdAt: s.created_at })) });
          return;
        }
        if (req.method === 'POST') {
          const { spaceId, name } = validateSpaceRequest(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
          sendJson(res, 200, { ok: true, ...registerSpace(usageDb, user.id, spaceId, name) });
          return;
        }
        if (req.method === 'DELETE') {
          const spaceId = new URL(req.url ?? '', 'http://localhost').searchParams.get('spaceId');
          if (!spaceId) throw new ApiError(400, 'invalid_request', 'A "spaceId" query parameter is required.');
          sendJson(res, 200, { ok: true, ...unregisterSpace(usageDb, user.id, spaceId) });
          return;
        }
      }
    }

    sendJson(
      res,
      404,
      { ok: false, code: 'invalid_request', error: `Not found. Use POST ${ROUTE}, GET ${HEALTH_ROUTE}, GET ${ME_USAGE_ROUTE}, ${ME_SPACES_ROUTE}, or one of the /v1/auth/* routes.` } satisfies ApiErrorResponse,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      sendJson(res, err.status, { ok: false, code: err.code, error: err.message } satisfies ApiErrorResponse);
      return;
    }
    // Never leak internal stack traces, request bodies, or secrets — log a short message locally only.
    console.error('[FocusSpace API] unexpected error:', err instanceof Error ? err.message : String(err));
    sendJson(res, 500, { ok: false, code: 'internal_error', error: 'Something went wrong handling that request.' } satisfies ApiErrorResponse);
  }
});

// Without this, a port already in use crashes with a raw Node stack trace instead of a clear message —
// the single most likely reason "npm run ai-api" would appear to produce no listener.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop whatever is using it, or set PORT to something else, e.g.: PORT=8789 OPENROUTER_API_KEY=... npm run ai-api`);
  } else {
    console.error(`FocusSpace API failed to start: ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`FocusSpace API on http://${HOST}:${PORT}${ROUTE} (model ${config.model})`);
});
