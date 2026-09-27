// FocusSpace API (Layer 2A) — the extension's real backend, replacing "extension
// → OpenRouter directly" with "extension → FocusSpace API → AI Orchestrator →
// OpenAI". The key lives only in this process's environment.
//
//   OPENAI_API_KEY=sk-... npm run ai-api
//   → FocusSpace Settings → Learning companion → My endpoint → http://127.0.0.1:8788/v1/ai/complete
//
// Env: PORT (8788), HOST (127.0.0.1), OPENAI_MODEL (gpt-4o-mini), MAX_TOKENS (700).
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
// who just wants a raw OpenAI relay for local dev.
import { createServer } from 'node:http';
import { ApiError, clientIp, CORS_HEADERS, readJsonBody, readTextBody, sendJson, type ApiErrorResponse } from './http';
import { callOpenAI, callOpenAIJson, loadOpenAIConfig, loadVoiceConfig, speak, transcribe } from './openai';
import { parseSetupAnswer, setupPrompt, transcriptionHint, validateSetupRequest, validateSpeechText } from './setup/service';
import { orchestrate } from './orchestrator';
import { validateAiApiRequest } from './validate';
import { getDb } from './auth/db';
import {
  authenticate,
  completeEmailSignup,
  completePasswordReset,
  loadAuthConfig,
  login,
  logout,
  refresh,
  startEmailSignup,
  startPasswordReset,
  startPhoneSignIn,
  tryAuthenticate,
  verifyEmailSignup,
  verifyPasswordReset,
  updateProfile,
  verifyPhoneSignIn,
  type AuthConfig,
} from './auth/service';
import { signInWithGoogle } from './auth/service';
import { createHandoff, redeemHandoff } from './auth/handoff';
import { authorizeUrl, createState, exchangeCode, loadGoogleConfig, verifyState } from './auth/google';
import { validateCredentials, validateEmailCode, validateEmailOnly, validatePhoneCode, validatePhoneOnly, validateRefreshRequest, validateSignupCompletion, validateSpaceRequest } from './auth/validate';
import { RateLimiter } from './auth/rate-limit';
import { loadSenders } from './notify/sender';
import { getUsageDb } from './usage/db';
import { anonymousKeys, assertAnonymousAllowed, commitUsage, parseInstallId, recordAnonymous, releaseUsage, reserveUsage, usageStatus } from './usage/service';
import { registerSpace, spaceAllowance, unregisterSpace } from './usage/spaces';
import { activitySubject, isAdmin, metrics, recordActive } from './usage/activity';
import { assertVoiceAllowed, parsePurpose, recordVoice, secondsHeard, secondsToSay, voiceStatus, type VoiceCaller } from './usage/voice';
import { resolvePlan } from './usage/entitlements';
import { loadRazorpayConfig, verifyWebhookSignature } from './billing/razorpay';
import { applyWebhook, cancelPlan, confirmPayment, confirmSubscription, startCheckout, startSubscription } from './billing/service';
import { buildReceipt } from './billing/receipt';
import { getOutlineDb } from './outline/db';
import { outlineDailyLimit, outlineFor, validateOutlineRequest, validateTranscriptKey, validateVideoId } from './outline/service';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '127.0.0.1';
/** Generous enough for a full-video note's context; still a hard cap — see validate.ts for the finer-grained per-field limits. */
const MAX_BODY_BYTES = 256 * 1024;
/** Auth bodies are just an email + password (or a refresh token) — a much tighter cap than the AI route needs. */
const AUTH_MAX_BODY_BYTES = 8 * 1024;
const ROUTE = '/v1/ai/complete';
/** Whole-video outlines (server/outline). GET reads a stored one; POST sends the transcript and gets one made if it is missing. */
const OUTLINE_ROUTE = '/v1/outline';
/** A three-hour lecture's captions, in a script that takes three bytes a character, with room to spare. */
const OUTLINE_MAX_BODY_BYTES = 2 * 1024 * 1024;
const HEALTH_ROUTE = '/v1/health';
const AUTH_LOGIN_ROUTE = '/v1/auth/login';
const AUTH_REFRESH_ROUTE = '/v1/auth/refresh';
const AUTH_LOGOUT_ROUTE = '/v1/auth/logout';
const ME_ROUTE = '/v1/me';
const ME_USAGE_ROUTE = '/v1/me/usage';
const ME_PROFILE_ROUTE = '/v1/me/profile';
const ME_SPACES_ROUTE = '/v1/me/spaces';
// Verified sign-up (email → code → password) and phone OTP sign-in. Same /v1/auth/* group, same
// AuthConfig, same session issuing as register/login — see server/auth/service.ts.
const BILLING_CHECKOUT_ROUTE = '/v1/billing/checkout';
const BILLING_SUBSCRIBE_ROUTE = '/v1/billing/subscribe';
const BILLING_SUBSCRIBE_CONFIRM_ROUTE = '/v1/billing/subscribe/confirm';
const BILLING_CANCEL_ROUTE = '/v1/billing/cancel';
const BILLING_CONFIRM_ROUTE = '/v1/billing/confirm';
const BILLING_WEBHOOK_ROUTE = '/v1/billing/webhook';
const ME_PAYMENTS_ROUTE = '/v1/me/payments';
/** `/v1/me/payments/:id/receipt` — a dynamic segment, matched by prefix/suffix below rather than added to AUTH_ROUTES (which only does exact matches). */
const receiptPath = (path: string): string | null => {
  if (!path.startsWith(`${ME_PAYMENTS_ROUTE}/`) || !path.endsWith('/receipt')) return null;
  const id = path.slice(ME_PAYMENTS_ROUTE.length + 1, -'/receipt'.length);
  return id ? decodeURIComponent(id) : null;
};

const SIGNUP_START_ROUTE = '/v1/auth/signup/start';
const SIGNUP_VERIFY_ROUTE = '/v1/auth/signup/verify';
const SIGNUP_COMPLETE_ROUTE = '/v1/auth/signup/complete';
const RESET_START_ROUTE = '/v1/auth/reset/start';
const RESET_VERIFY_ROUTE = '/v1/auth/reset/verify';
const RESET_COMPLETE_ROUTE = '/v1/auth/reset/complete';
const PHONE_START_ROUTE = '/v1/auth/phone/start';
const PHONE_VERIFY_ROUTE = '/v1/auth/phone/verify';
const HANDOFF_CREATE_ROUTE = '/v1/auth/handoff/create';
const HANDOFF_REDEEM_ROUTE = '/v1/auth/handoff/redeem';
/** Both are plain browser navigations, not API calls: they redirect rather than return JSON. */
const GOOGLE_START_ROUTE = '/v1/auth/google/start';
const GOOGLE_CALLBACK_ROUTE = '/v1/auth/google/callback';
/** The first-run setup assistant: understanding what someone said, and talking with them (server/setup). */
const SETUP_ROUTE = '/v1/setup/understand';
const VOICE_TRANSCRIBE_ROUTE = '/v1/voice/transcribe';
const VOICE_SPEAK_ROUTE = '/v1/voice/speak';
/** Active-use counts (server/usage/activity.ts): the extension's daily "used today", and the admin view of it. */
const ACTIVITY_ROUTE = '/v1/activity';
const ADMIN_METRICS_ROUTE = '/v1/admin/metrics';
const activityLimiter = new RateLimiter(120, 60 * 60_000);
/** A turn carries the learner's Spaces and their creators, or channel search results to choose from. */
const SETUP_MAX_BODY_BYTES = 48 * 1024;
/** ~30 s of browser webm/opus is well under 1 MB; base64 adds a third. */
const VOICE_MAX_BODY_BYTES = 1_500_000;

/**
 * Where a finished Google sign-in is allowed to send the browser back to. An allow-list, because
 * `returnTo` arrives from the query string: an open redirect here would let anyone bounce a victim off
 * FocusSpace's own domain, and the handoff code in the fragment would go with them.
 */
const WEB_ORIGINS = (process.env.WEB_ORIGINS ?? 'https://focusspace.xyz,http://localhost:5174')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/** Resolves `returnTo` against the allow-list, falling back to the first configured site origin. */
function safeReturnTo(returnTo: string): string {
  const fallback = `${WEB_ORIGINS[0] ?? ''}/signin`;
  if (!returnTo) return fallback;
  try {
    const url = new URL(returnTo);
    return WEB_ORIGINS.includes(url.origin) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

const google = loadGoogleConfig();
if (!google) console.warn('[FocusSpace API] Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI), every other sign-in method is unaffected.');

const AUTH_ROUTES = new Set([HANDOFF_CREATE_ROUTE, HANDOFF_REDEEM_ROUTE, ME_PROFILE_ROUTE, BILLING_SUBSCRIBE_ROUTE, BILLING_SUBSCRIBE_CONFIRM_ROUTE, BILLING_CANCEL_ROUTE, BILLING_CHECKOUT_ROUTE, BILLING_CONFIRM_ROUTE, ME_PAYMENTS_ROUTE, AUTH_LOGIN_ROUTE, AUTH_REFRESH_ROUTE, AUTH_LOGOUT_ROUTE, SIGNUP_START_ROUTE, SIGNUP_VERIFY_ROUTE, SIGNUP_COMPLETE_ROUTE, RESET_START_ROUTE, RESET_VERIFY_ROUTE, RESET_COMPLETE_ROUTE, PHONE_START_ROUTE, PHONE_VERIFY_ROUTE, ME_ROUTE, ME_USAGE_ROUTE]);

// Layer 2C — a burst/abuse safety net for the anonymous half of /v1/ai/complete, structurally separate
// from the persisted, user_id-keyed usage/entitlement system below (see docs/LAYER_2C_USAGE_ENTITLEMENTS.md,
// "Rate limiting vs. quota"). Reuses the exact same RateLimiter class Layer 2B already established for
// login/register, keyed by IP since there is no account identity to key an anonymous caller by.
const anonymousAiLimiter = new RateLimiter(30, 10 * 60_000);
/** New outlines per caller (account, install or address) per day. Stored ones are free and unlimited. */
const outlineLimiter = new RateLimiter(40, 24 * 60 * 60_000);
/**
 * The setup assistant is free — it is how someone starts — so it is bounded by rate rather than billed:
 * per caller (account, install or address), enough for a long, chatty setup and nowhere near enough to
 * use as a general-purpose transcription or text-to-speech service.
 */
const setupLimiter = new RateLimiter(80, 30 * 60_000);
const listenLimiter = new RateLimiter(90, 30 * 60_000);
// Replies are spoken a sentence or two at a time (so the first is heard sooner): more, smaller calls.
const speakLimiter = new RateLimiter(240, 30 * 60_000);
const voiceDailyLimiter = new RateLimiter(900, 24 * 60 * 60_000);
const voice = loadVoiceConfig();
/** Reading a setup turn — corrections, several actions at once — needs more care than chat; measured on real turns. */
const SETUP_MODEL = process.env.SETUP_MODEL ?? 'gpt-4.1-mini';
/** Railway fronts the API with a proxy; its record of the client's address is the one to trust there (http.ts clientIp). */
const TRUST_PROXY = process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : process.env.NODE_ENV === 'production';

// Verification-code delivery (email/SMS). No provider is configured by default: codes are logged by
// the development sender, and only returned to the caller when AUTH_DEV_CODES=1 — never in production.
// See server/notify/sender.ts.
const senders = loadSenders();

// Payments are optional infrastructure: the API must serve AI, accounts and usage
// perfectly well on a deployment where Razorpay is not configured yet — which is
// every deployment until the account's website is approved.
const razorpay = loadRazorpayConfig();
if (!razorpay) console.warn('[FocusSpace API] Razorpay is not configured, checkout is unavailable, everything else is unaffected.');
// Says which mode is live, without ever printing a key, and shouts about the one setting that fails
// silently: without the webhook secret every webhook is rejected, so a renewal or a payment completed
// after the browser closed is never recorded.
if (razorpay) {
  console.log(`[FocusSpace API] Razorpay ${razorpay.test ? 'TEST' : 'LIVE'} mode (key ${razorpay.keyId.slice(0, 12)}…).`);
  if (!razorpay.webhookSecret) {
    console.error('[FocusSpace API] RAZORPAY_WEBHOOK_SECRET is unset, every webhook will be rejected, so renewals and payments completed without the browser will not be recorded. Create the webhook in this Razorpay mode and set its secret.');
  }
}

function requireRazorpay() {
  if (!razorpay) throw new ApiError(503, 'billing_unavailable', 'Payments are not available yet. Nothing was charged.');
  return razorpay;
}

let config;
try {
  config = loadOpenAIConfig();
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
    // for fast local diagnosis. Never reveals whether the OpenAI key or auth secret is actually valid.
    if (req.method === 'GET' && req.url === HEALTH_ROUTE) {
      sendJson(res, 200, { ok: true, status: 'ok', model: config.model, auth: authConfig ? 'enabled' : 'disabled' });
      return;
    }

    // Razorpay's webhook, not a browser: no Authorization header, no CORS, and the
    // signature over the raw bytes is the only thing that makes it trustworthy. It is
    // handled before the auth routes so nothing tries to authenticate it.
    if (req.method === 'POST' && req.url === BILLING_WEBHOOK_ROUTE) {
      const config = requireRazorpay();
      const raw = await readTextBody(req, AUTH_MAX_BODY_BYTES);
      const signature = String(req.headers['x-razorpay-signature'] ?? '');
      if (!verifyWebhookSignature(config, raw, signature)) {
        sendJson(res, 400, { ok: false, code: 'invalid_signature', error: 'Signature mismatch.' });
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { ok: false, code: 'invalid_request', error: 'Malformed JSON body.' });
        return;
      }
      // Always 200 once the signature checks out: an event we do not act on is not a
      // failure, and Razorpay retries anything else for days.
      const grant = applyWebhook(getUsageDb(), event);
      sendJson(res, 200, { ok: true, applied: !!grant?.granted });
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
        const ip = clientIp(req, TRUST_PROXY);
        const installId = parseInstallId(req.headers['x-focusspace-install']);
        // Burst protection per install (or address), so one busy network is not one bucket.
        if (!anonymousAiLimiter.attempt(installId ?? ip)) throw new ApiError(429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.');
        // A small daily allowance without an account (Layer 2C). Checked before the upstream call and
        // recorded only after a successful one, so a failed request never costs the learner anything.
        const anonDb = getUsageDb();
        const keys = anonymousKeys(ip, installId, authConfig?.tokenSecret ?? config.model);
        assertAnonymousAllowed(anonDb, keys, request.action);
        const result = await orchestrate(request, { config });
        recordAnonymous(anonDb, keys, request.action);
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

    const path = (req.url ?? '').split('?')[0];

    // ── Video outlines. Public video data only: no account needed, nothing about the caller stored. ──
    if (path === OUTLINE_ROUTE && (req.method === 'GET' || req.method === 'POST')) {
      const db = getOutlineDb();
      if (req.method === 'GET') {
        const query = new URL(req.url ?? '', 'http://localhost').searchParams;
        const stored = db.get(validateVideoId(query.get('videoId')), validateTranscriptKey(query.get('key')));
        sendJson(res, 200, { ok: true, sections: stored?.sections ?? null });
        return;
      }
      const request = validateOutlineRequest(await readJsonBody(req, OUTLINE_MAX_BODY_BYTES));
      const identity = authConfig ? tryAuthenticate(getDb(), authConfig, req.headers.authorization) : null;
      const caller = identity?.user.id ?? parseInstallId(req.headers['x-focusspace-install']) ?? clientIp(req, TRUST_PROXY);
      const result = await outlineFor(
        request,
        { db, model: config.model, dailyLimit: outlineDailyLimit(), complete: (prompt, maxTokens) => callOpenAI(prompt, { ...config, maxTokens }) },
        () => outlineLimiter.attempt(caller),
      );
      sendJson(res, 200, { ok: true, sections: result.sections, cached: result.cached });
      return;
    }

    // ── Active use: one "used today" per install (hashed), and the numbers, for the admin only. ──
    if (req.method === 'POST' && path === ACTIVITY_ROUTE) {
      const installId = parseInstallId(req.headers['x-focusspace-install']);
      if (!installId) throw new ApiError(400, 'invalid_request', 'No install id.');
      if (!activityLimiter.attempt(clientIp(req, TRUST_PROXY))) throw new ApiError(429, 'rate_limited', 'Too many requests.');
      const identity = authConfig ? tryAuthenticate(getDb(), authConfig, req.headers.authorization) : null;
      recordActive(getUsageDb(), activitySubject(installId, authConfig?.tokenSecret ?? config.model), !!identity);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && path === ADMIN_METRICS_ROUTE) {
      if (!isAdmin(req.headers.authorization, process.env.ADMIN_TOKEN)) throw new ApiError(401, 'unauthorized', 'Not authorised.');
      sendJson(res, 200, { ok: true, metrics: metrics(getUsageDb()) });
      return;
    }

    // ── Setup assistant (first run): understand → Spaces / channels; listen; speak. ──
    if (req.method === 'POST' && (path === SETUP_ROUTE || path === VOICE_TRANSCRIBE_ROUTE || path === VOICE_SPEAK_ROUTE)) {
      const identity = authConfig ? tryAuthenticate(getDb(), authConfig, req.headers.authorization) : null;
      const caller = identity?.user.id ?? parseInstallId(req.headers['x-focusspace-install']) ?? clientIp(req, TRUST_PROXY);
      const slowDown = () => new ApiError(429, 'rate_limited', 'That’s a lot of talking for one setup. Give it a few minutes and try again.');
      // Voice is metered per account (monthly) or, signed out, per install (daily, setup only) — server/usage/voice.ts.
      const voiceCaller = (): VoiceCaller =>
        identity ? { kind: 'user', userId: identity.user.id } : { kind: 'guest', key: anonymousKeys(clientIp(req, TRUST_PROXY), parseInstallId(req.headers['x-focusspace-install']), authConfig?.tokenSecret ?? config.model).allowance };

      if (path === SETUP_ROUTE) {
        const request = validateSetupRequest(await readJsonBody(req, SETUP_MAX_BODY_BYTES));
        if (!setupLimiter.attempt(caller)) throw slowDown();
        const maxTokens = request.task === 'pick' || request.task === 'channels' ? 300 : 2600;
        const { data } = await callOpenAIJson(setupPrompt(request), { ...config, model: SETUP_MODEL, maxTokens });
        sendJson(res, 200, { ok: true, answer: parseSetupAnswer(request, data) });
        return;
      }

      if (path === VOICE_TRANSCRIBE_ROUTE) {
        const body = (await readJsonBody(req, VOICE_MAX_BODY_BYTES)) as { audio?: unknown; mime?: unknown; hint?: unknown; purpose?: unknown } | null;
        const audio = typeof body?.audio === 'string' ? Buffer.from(body.audio, 'base64') : null;
        const mime = typeof body?.mime === 'string' && /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(body.mime) ? body.mime.split(';')[0] : 'audio/webm';
        if (!audio || audio.length < 1_000) throw new ApiError(400, 'invalid_request', 'The recording was empty.');
        const purpose = parsePurpose(body?.purpose);
        const seconds = secondsHeard(audio.length);
        assertVoiceAllowed(getUsageDb(), voiceCaller(), purpose, seconds);
        if (!listenLimiter.attempt(caller) || !voiceDailyLimiter.attempt(caller)) throw slowDown();
        const hint = typeof body?.hint === 'string' ? body.hint.slice(0, 300) : '';
        const heard = await transcribe(audio, mime, config.apiKey, voice, transcriptionHint(hint));
        recordVoice(getUsageDb(), voiceCaller(), purpose, seconds);
        sendJson(res, 200, { ok: true, text: heard });
        return;
      }

      const speakBody = await readJsonBody(req, AUTH_MAX_BODY_BYTES);
      const text = validateSpeechText(speakBody);
      const purpose = parsePurpose((speakBody as { purpose?: unknown } | null)?.purpose);
      const seconds = secondsToSay(text);
      assertVoiceAllowed(getUsageDb(), voiceCaller(), purpose, seconds);
      if (!speakLimiter.attempt(caller) || !voiceDailyLimiter.attempt(caller)) throw slowDown();
      const audio = await speak(text, config.apiKey, voice);
      recordVoice(getUsageDb(), voiceCaller(), purpose, seconds);
      sendJson(res, 200, { ok: true, audio: audio.toString('base64'), mime: 'audio/mpeg' });
      return;
    }

    /*
     * ── Google sign-in ──────────────────────────────────────────────────────
     *
     * Two browser navigations, not API calls, so they redirect rather than answer JSON — and they sit
     * ahead of the JSON auth block for that reason. The client secret never leaves this process: the
     * browser only ever sees Google's own consent screen and, at the end, a FocusSpace handoff code.
     *
     * The code comes back in the URL *fragment*, which is never sent to a server and never lands in
     * server logs or a Referer header. It is single-use and dies in a minute (auth/handoff.ts), and the
     * page that receives it exchanges it immediately and strips it from the address bar.
     */
    if (req.method === 'GET' && (path === GOOGLE_START_ROUTE || path === GOOGLE_CALLBACK_ROUTE)) {
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const redirect = (to: string) => {
        res.writeHead(302, { ...CORS_HEADERS, Location: to });
        res.end();
      };

      if (!authConfig || !google) {
        // Nothing to sign in *with* — say so on the page the learner came from rather than in raw JSON.
        redirect(`${safeReturnTo(query.get('returnTo') ?? '')}#error=google_unavailable`);
        return;
      }

      if (path === GOOGLE_START_ROUTE) {
        redirect(authorizeUrl(google, createState(authConfig.tokenSecret, safeReturnTo(query.get('returnTo') ?? ''))));
        return;
      }

      // ── callback ──
      // Cancelling at Google's screen is an ordinary outcome, not a failure: it comes back as
      // ?error=access_denied and the learner simply returns to where they were.
      let returnTo = safeReturnTo('');
      try {
        returnTo = verifyState(query.get('state'), authConfig.tokenSecret).returnTo;
      } catch {
        redirect(`${returnTo}#error=google_state`);
        return;
      }
      if (query.get('error') || !query.get('code')) {
        redirect(`${returnTo}#error=${query.get('error') === 'access_denied' ? 'google_cancelled' : 'google_failed'}`);
        return;
      }
      try {
        const profile = await exchangeCode(google, String(query.get('code')));
        const result = signInWithGoogle(getDb(), authConfig, profile, req.headers['user-agent'] ?? null);
        const { code } = createHandoff(getDb(), result.user.id, 'google');
        redirect(`${returnTo}#handoff=${encodeURIComponent(code)}`);
      } catch (err) {
        // The real reason is for the operator's log; the learner gets one sentence and a way to retry.
        console.warn('[FocusSpace API] Google sign-in failed:', err instanceof Error ? err.message : err);
        redirect(`${returnTo}#error=google_failed`);
      }
      return;
    }

    // ── Auth (Layer 2B) — every route below 503s with a clear message if AUTH_TOKEN_SECRET isn't set,
    // rather than the process refusing to start (see the authConfig load above). ──
    const paymentReceiptId = req.method === 'GET' ? receiptPath(path) : null;
    if (AUTH_ROUTES.has(path) || path === ME_SPACES_ROUTE || paymentReceiptId !== null) {
      if (!authConfig) throw new ApiError(503, 'internal_error', 'Authentication is not configured on this server.');
      const db = getDb();
      const userAgent = req.headers['user-agent'] ?? null;

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

      // ── Password reset ──
      // Same three steps as sign-up, ending somewhere different: a new password and
      // every old session revoked.
      if (req.method === 'POST' && path === RESET_START_ROUTE) {
        const { email } = validateEmailOnly(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...(await startPasswordReset(db, authConfig, senders, email)) });
        return;
      }
      if (req.method === 'POST' && path === RESET_VERIFY_ROUTE) {
        const { email, code } = validateEmailCode(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...verifyPasswordReset(db, authConfig, email, code) });
        return;
      }
      if (req.method === 'POST' && path === RESET_COMPLETE_ROUTE) {
        const { ticket, password } = validateSignupCompletion(await readJsonBody(req, AUTH_MAX_BODY_BYTES));
        sendJson(res, 200, { ok: true, ...completePasswordReset(db, authConfig, ticket, password, userAgent) });
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
      /*
       * One FocusSpace account across three clients. `create` needs a real session — possession of the
       * code it returns is possession of the account — and `redeem` needs nothing but the code, because
       * the code *is* the proof. See auth/handoff.ts for why this is a code and not the session itself.
       */
      if (req.method === 'POST' && path === HANDOFF_CREATE_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const body = (await readJsonBody(req, AUTH_MAX_BODY_BYTES)) as { origin?: unknown };
        const origin = typeof body?.origin === 'string' && body.origin.length <= 32 ? body.origin : 'website';
        sendJson(res, 200, { ok: true, ...createHandoff(db, user.id, origin) });
        return;
      }
      if (req.method === 'POST' && path === HANDOFF_REDEEM_ROUTE) {
        const body = (await readJsonBody(req, AUTH_MAX_BODY_BYTES)) as { code?: unknown };
        sendJson(res, 200, { ok: true, ...redeemHandoff(db, authConfig, String(body?.code ?? ''), userAgent) });
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
        // The plan rides along so the pricing page can stop offering something the
        // learner already owns — one request instead of two on every page load.
        const entitlement = getUsageDb().getEntitlement(user.id);
        sendJson(res, 200, { ok: true, user, plan: resolvePlan(entitlement), planExpiresAt: entitlement?.expires_at ?? null, autoRenew: entitlement?.auto_renew === 1 });
        return;
      }
      // Layer 2C — unlike /v1/ai/complete's fail-open policy, this route has nothing meaningful to answer
      // for an unverified caller, so it requires a genuinely valid token and 401s otherwise.
      if (req.method === 'GET' && path === ME_USAGE_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        sendJson(res, 200, { ok: true, ...usageStatus(getUsageDb(), user.id), voice: voiceStatus(getUsageDb(), user.id) });
        return;
      }

      // Name and city only — identity fields each have their own verified flow.
      if (req.method === 'POST' && path === ME_PROFILE_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const body = (await readJsonBody(req, AUTH_MAX_BODY_BYTES)) as { name?: unknown; city?: unknown };
        sendJson(res, 200, { ok: true, user: updateProfile(db, user.id, body) });
        return;
      }

      if (req.method === 'GET' && path === ME_PAYMENTS_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        sendJson(res, 200, { ok: true, payments: getUsageDb().listPayments(user.id) });
        return;
      }

      // Authenticated receipt for one of *this* user's own payments — see billing/receipt.ts for why this
      // is a self-hosted document rather than a Razorpay-hosted invoice link, and for the ownership check
      // that makes a payment id belonging to someone else 404 exactly like one that doesn't exist at all.
      if (req.method === 'GET' && paymentReceiptId !== null) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const receipt = buildReceipt(getUsageDb(), user, paymentReceiptId);
        sendJson(res, 200, { ok: true, ...receipt });
        return;
      }

      // ── Billing (Razorpay) ──
      // The amount is never taken from the request: the client names a plan and a
      // period, and the server prices it from src/billing/plans.ts.
      if (req.method === 'POST' && path === BILLING_CHECKOUT_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const body = (await readJsonBody(req, AUTH_MAX_BODY_BYTES)) as { planId?: string; period?: string; currency?: string };
        const session = await startCheckout(requireRazorpay(), getUsageDb(), user.id, { planId: String(body.planId ?? ''), period: String(body.period ?? ''), currency: String(body.currency ?? '') });
        sendJson(res, 200, { ok: true, ...session });
        return;
      }

      // Auto-renewing purchase. Same price book, same grant path as a one-off order.
      if (req.method === 'POST' && path === BILLING_SUBSCRIBE_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const body = (await readJsonBody(req, AUTH_MAX_BODY_BYTES)) as { planId?: string; period?: string; currency?: string };
        const session = await startSubscription(
          requireRazorpay(),
          getUsageDb(),
          user.id,
          { planId: String(body.planId ?? ''), period: String(body.period ?? ''), currency: String(body.currency ?? '') },
          user.email,
        );
        sendJson(res, 200, { ok: true, ...session });
        return;
      }

      if (req.method === 'POST' && path === BILLING_SUBSCRIBE_CONFIRM_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const body = (await readJsonBody(req, AUTH_MAX_BODY_BYTES)) as Record<string, string>;
        const grant = await confirmSubscription(requireRazorpay(), getUsageDb(), user.id, {
          subscriptionId: String(body.subscriptionId ?? ''),
          paymentId: String(body.paymentId ?? ''),
          signature: String(body.signature ?? ''),
          planId: String(body.planId ?? ''),
          period: String(body.period ?? ''),
          currency: String(body.currency ?? ''),
        });
        sendJson(res, 200, { ok: true, ...grant });
        return;
      }

      // Stops the renewal, never the plan: the period already paid for is kept.
      if (req.method === 'POST' && path === BILLING_CANCEL_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        sendJson(res, 200, { ok: true, ...(await cancelPlan(requireRazorpay(), getUsageDb(), user.id)) });
        return;
      }

      if (req.method === 'POST' && path === BILLING_CONFIRM_ROUTE) {
        const { user } = authenticate(db, authConfig, req.headers.authorization);
        const body = (await readJsonBody(req, AUTH_MAX_BODY_BYTES)) as Record<string, string>;
        const grant = confirmPayment(requireRazorpay(), getUsageDb(), user.id, {
          orderId: String(body.orderId ?? ''),
          paymentId: String(body.paymentId ?? ''),
          signature: String(body.signature ?? ''),
          planId: String(body.planId ?? ''),
          period: String(body.period ?? ''),
          currency: String(body.currency ?? ''),
        });
        sendJson(res, 200, { ok: true, ...grant });
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
    console.error(`Port ${PORT} is already in use. Stop whatever is using it, or set PORT to something else, e.g.: PORT=8789 OPENAI_API_KEY=... npm run ai-api`);
  } else {
    console.error(`FocusSpace API failed to start: ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`FocusSpace API on http://${HOST}:${PORT}${ROUTE} (model ${config.model})`);
});
