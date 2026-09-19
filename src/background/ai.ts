import { LANGUAGE_OPTIONS, languageModel } from '@/ai/on-device';
import { createAiService, type AiProvider } from '@/learning/ai/service';
import { createUsageLog } from '@/learning/ai/usage';
import { getItem } from '@/storage/storage';
import { API_URL, HOSTED_AI_LABEL } from '@/config';
import { status as authStatus } from './auth';
import { installId } from './install-id';

/** The one AI route the FocusSpace API exposes (server/index.ts). */
const AI_ROUTE = '/v1/ai/complete';

/**
 * AI providers for the learning companion. Neither holds a secret:
 *
 * - chrome: Chrome's built-in on-device model. Nothing leaves the browser.
 * - endpoint: the learner's own server (reference: scripts/ai-endpoint). It
 *   receives only the compact context of the current moment and keeps any LLM
 *   API key server-side. It must allow cross-origin POSTs (CORS).
 */

export const chromeProvider: AiProvider = {
  id: 'chrome',
  label: 'On-device AI (Chrome)',
  async availability() {
    const lm = languageModel();
    return lm ? lm.availability(LANGUAGE_OPTIONS) : 'unavailable';
  },
  async complete(prompt, _request, signal) {
    const lm = languageModel();
    if (!lm) throw new Error('On-device AI is not available in this browser.');
    const session = await lm.create({ ...LANGUAGE_OPTIONS, initialPrompts: [{ role: 'system', content: prompt.system }], signal });
    try {
      return await session.prompt(prompt.user, { signal });
    } finally {
      session.destroy();
    }
  },
};

/**
 * `accessToken` (Layer 2C) is attached only when the caller has already established this endpoint IS
 * the FocusSpace server itself (see `resolveProviders`'s same-origin check below) — never for an
 * arbitrary personal endpoint, which would otherwise leak a Bearer token to a third-party URL.
 */
export function endpointProvider(url: string, accessToken?: string, installId?: string): AiProvider {
  return {
    id: 'endpoint',
    label: API_URL && sameOrigin(url, API_URL) ? HOSTED_AI_LABEL : `Your AI endpoint (${new URL(url).host})`,
    availability: async () => 'available',
    async complete(prompt, request, signal) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : installId ? { 'X-FocusSpace-Install': installId } : {}) },
          // `question` is omitted, never null: notes/mindmap carry no question, and the API's
          // validator accepts a string or nothing at all. Sending null is what made every
          // "Make Notes" and "Mind map" request fail with `"question" must be a string`.
          body: JSON.stringify({ version: 1, action: request.action, ...(request.question ? { question: request.question } : {}), context: request.context, prompt }),
          signal,
        });
      } catch (err) {
        // A raw "Failed to fetch" (the literal browser TypeError) must never reach a learner — surfaced live
        // during the product UX audit. Same friendly-message convention background/auth.ts's postJson() already uses.
        if (err instanceof DOMException && err.name === 'AbortError') throw err; // an intentional cancellation, not a failure to report
        throw new Error(`Couldn't reach your AI endpoint (${new URL(url).host}). Check your connection, or the endpoint address in Settings → Account.`);
      }
      const json = (await res.json().catch(() => null)) as { answer?: unknown; error?: unknown; code?: unknown } | null;
      if (!res.ok) {
        // Surfaces the server's own message (e.g. a Layer 2C quota error) instead of a bare status code, when available.
        const err = new Error(typeof json?.error === 'string' ? json.error : `Your AI endpoint returned HTTP ${res.status}.`);
        if (typeof json?.code === 'string') (err as Error & { code?: string }).code = json.code;
        throw err;
      }
      if (typeof json?.answer !== 'string') throw new Error('Your AI endpoint returned no answer.');
      return json.answer;
    },
  };
}

const isHttpUrl = (url: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/**
 * Builds the endpoint provider, attaching a FocusSpace access token (Layer 2C) only when the learner's
 * configured AI endpoint and their configured FocusSpace account server are the *same origin* — i.e.
 * only when this endpoint genuinely is the FocusSpace server, never a third-party/personal one. Token
 * freshness reuses `background/auth.ts`'s `status()` (silent refresh, never destructive on a transient
 * failure) rather than any new refresh logic.
 */
async function buildEndpointProvider(endpointUrl: string, apiBaseUrl: string): Promise<AiProvider> {
  if (apiBaseUrl && sameOrigin(endpointUrl, apiBaseUrl)) {
    const { accessToken } = await authStatus();
    // Signed out, FocusSpace's server counts the free allowance per install — never sent to anyone else's endpoint.
    return endpointProvider(endpointUrl, accessToken ?? undefined, accessToken ? undefined : await installId());
  }
  return endpointProvider(endpointUrl);
}

/**
 * The same provider list `aiService` uses internally, exposed so notes
 * generation and chat can pick a provider through the exact same policy
 * (`pickProvider` in ai/service.ts) without duplicating the settings→providers
 * mapping.
 */
/**
 * Which AI endpoint to talk to, and which FocusSpace server that endpoint
 * belongs to (for the token same-origin rule above).
 *
 * The learner's own endpoint wins when they set one — that option still
 * exists for people who want to run their own relay. But when they have not,
 * this falls back to FocusSpace's own deployed API (`API_URL`, baked in at
 * build time from src/config.ts) rather than to nothing. That fallback is the
 * whole no-API-key product promise: a build that ships with `VITE_API_URL`
 * set has working AI the moment it is installed, with no endpoint to
 * configure and no key to bring. A build without it (a plain `npm run build`)
 * behaves exactly as before — learner endpoint, or Chrome's on-device model.
 */
function endpointFor(ai: { endpointUrl: string }, api: { baseUrl: string }): { url: string; apiBase: string } | null {
  const apiBase = api.baseUrl || API_URL;
  if (isHttpUrl(ai.endpointUrl)) return { url: ai.endpointUrl, apiBase };
  if (API_URL) return { url: `${API_URL}${AI_ROUTE}`, apiBase };
  return null;
}

export async function resolveProviders(): Promise<AiProvider[]> {
  const { ai, api } = await getItem('settings');
  const target = endpointFor(ai, api);
  const endpoint = target ? [await buildEndpointProvider(target.url, target.apiBase)] : [];
  switch (ai.provider) {
    case 'off':
      return [];
    case 'chrome':
      return [chromeProvider];
    case 'endpoint':
      return endpoint;
    default:
      return [...endpoint, chromeProvider];
  }
}

/** In-memory, per-session usage log — learner-facing awareness, not billing (no subscriptions this phase). */
export const usageLog = createUsageLog();

export const aiService = createAiService({ providers: resolveProviders, usage: usageLog.sink });
