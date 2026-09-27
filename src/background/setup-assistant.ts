import type { SetupAnswer, SetupRequest, VoicePurpose } from '@/types/setup';
import { apiBaseUrl, status as authStatus } from './auth';
import { installId } from './install-id';

/**
 * The first-run setup assistant's three server calls (server/setup, server/openai.ts voice). They go
 * through the background like every other FocusSpace API call, so YouTube's page never sees a token.
 * Signed in or not: setup is how someone starts, so the server bounds it by rate rather than by plan.
 */

type Failure = { ok: false; error: string };

async function post<T>(path: string, body: unknown): Promise<(T & { ok: true }) | Failure> {
  const base = await apiBaseUrl();
  if (!base) return { ok: false, error: 'FocusSpace’s server isn’t configured in this build.' };
  const { accessToken } = await authStatus();
  const identity: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : { 'X-FocusSpace-Install': await installId() };
  try {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...identity }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as ((T & { ok: true }) | Failure) | null;
    if (!json) return { ok: false, error: `FocusSpace’s server answered strangely (HTTP ${res.status}).` };
    return json;
  } catch {
    return { ok: false, error: 'Couldn’t reach FocusSpace. Check your connection and try again.' };
  }
}

export const understand = (request: SetupRequest) => post<{ answer: SetupAnswer }>('/v1/setup/understand', request);
export const transcribeSpeech = (audio: string, mime: string, hint: string | undefined, purpose: VoicePurpose) => post<{ text: string }>('/v1/voice/transcribe', { audio, mime, hint, purpose });
export const speakText = (text: string, purpose: VoicePurpose) => post<{ audio: string; mime: string }>('/v1/voice/speak', { text, purpose });
