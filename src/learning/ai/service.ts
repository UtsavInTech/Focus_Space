import type { ChatMessage } from '@/types/chat';
import type { ProviderCapabilities, ProviderId } from '@/types/ai-provider';
import type { LearningContext } from '../context/context';
import { CONTEXT_VERSION } from '../context/context';
import { hashString } from '../knowledge/text';
import { buildPrompt, reviewAnswer, type AiAction, type AiPrompt } from './actions';
import { buildChatPrompt } from './chat';
import type { HomepageContext } from './homepage-context';
import { approxTokens, type UsageSink } from './usage';

/**
 * Runs AI actions — only when the learner asks. Playback never reaches this
 * module: the current concept is computed locally (knowledge/locate.ts).
 *
 * Providers hold no secrets. On-device Chrome AI needs none; a remote
 * endpoint is the learner's own server, which keeps any API key.
 *
 * V5: `AiProvider.id` widens to `ProviderId` so the endpoint provider can
 * describe what it forwards to (openrouter/openai — see
 * src/types/ai-provider.ts); the extension still never calls those
 * directly. `capabilities` lets a provider opt into chat/streaming/voice
 * while `actions` (the five point actions) stays required of every
 * provider, same as today.
 */

export type AiAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

const DEFAULT_CAPABILITIES: ProviderCapabilities = { actions: true, chat: true, streaming: false, voice: true };

export interface AiProvider {
  id: ProviderId;
  label: string;
  /** Defaults to { actions: true, chat: true, streaming: false, voice: true } when omitted — today's two providers support both without change. */
  capabilities?: ProviderCapabilities;
  availability(): Promise<AiAvailability>;
  complete(prompt: AiPrompt, request: AiRequest, signal?: AbortSignal): Promise<string>;
}

export interface AiRequest {
  /** The five point actions, plus WS2's notes/mindmap and chat — all share this one request shape and provider call. */
  action: AiAction | 'notes' | 'mindmap' | 'chat';
  /** A video moment for actions/most chat, or a HomepageContext when chat happens off a video page (see chat.ts). */
  context: LearningContext | HomepageContext;
  question?: string;
}

/** What `run()`/`ai/run` accepts — the five point actions only; chat and notes use their own entry points (see `chat()` below and notes-integration.ts). Narrower than, and assignable to, `AiRequest`. */
export interface ActionRequest {
  action: AiAction;
  context: LearningContext;
  question?: string;
}

export interface ChatRequest {
  context: LearningContext | HomepageContext;
  history: ChatMessage[];
  question: string;
  voice?: boolean;
}

/** 'quota_exceeded' (Layer 2C) — only ever reached via the FocusSpace-attached endpoint; every other provider path never produces it. */
export type ChatResult = { ok: true; answer: string; provider: ProviderId } | { ok: false; code: 'unavailable' | 'failed' | 'quota_exceeded'; error: string };

export interface AiStatus {
  provider: ProviderId | null;
  label: string | null;
  availability: AiAvailability;
}

export type AiResult = { ok: true; answer: string; provider: ProviderId; cached: boolean } | { ok: false; code: 'unavailable' | 'failed' | 'quota_exceeded'; error: string };

/** The server (Layer 2C) attaches an error `code` alongside its message; a thrown Error carries it as this extra property — see background/ai.ts's endpointProvider. */
function errorCode(err: unknown): 'failed' | 'quota_exceeded' {
  return err instanceof Error && (err as Error & { code?: string }).code === 'quota_exceeded' ? 'quota_exceeded' : 'failed';
}

/** Provider selection: first one reporting 'available', else the best fallback (downloadable/downloading over unavailable). Shared by run(), chat() and notes generation — one selection policy, not three. */
export async function pickProvider(providers: AiProvider[]): Promise<{ provider: AiProvider; availability: AiAvailability } | null> {
  let fallback: { provider: AiProvider; availability: AiAvailability } | null = null;
  for (const provider of providers) {
    const availability = await provider.availability().catch((): AiAvailability => 'unavailable');
    if (availability === 'available') return { provider, availability };
    if (!fallback && availability !== 'unavailable') fallback = { provider, availability };
  }
  return fallback;
}

export const capabilitiesOf = (provider: AiProvider): ProviderCapabilities => provider.capabilities ?? DEFAULT_CAPABILITIES;

/**
 * Same question about the same moment → same answer. Explanations are keyed to
 * the concept and a ~20 s window; "what" and quizzes to the concept only.
 */
export function aiCacheKey(request: AiRequest): string {
  // aiCacheKey backs only the point-action cache (run()) — chat/homepage turns never go through it.
  const ctx = request.context as LearningContext;
  const where = ctx.conceptId ?? `t${Math.floor(ctx.currentTime / 60)}`;
  const moment = request.action === 'what' || request.action === 'quiz' ? where : `${where}@${Math.floor(ctx.currentTime / 20)}`;
  const question = request.action === 'ask' ? hashString((request.question ?? '').trim().toLowerCase().replace(/\s+/g, ' ')) : '';
  return [CONTEXT_VERSION, request.action, ctx.videoId, ctx.mode.id, moment, question].join('|');
}

export function createAiService(options: { providers: () => Promise<AiProvider[]> | AiProvider[]; ttlMs?: number; maxEntries?: number; now?: () => number; usage?: UsageSink }) {
  const ttl = options.ttlMs ?? 6 * 3_600_000;
  const max = options.maxEntries ?? 200;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; answer: string; provider: ProviderId }>();
  const inflight = new Map<string, Promise<AiResult>>();

  const pick = async () => pickProvider(await options.providers());

  /** Usage is recorded on every real answer — fresh or cached — never when no provider was reached at all (see docs/V5_CONTRACT.md §I). */
  const recordUsage = (provider: ProviderId, action: string, cached: boolean, answer: string) =>
    options.usage?.record({ provider, action, at: now(), cached, approxTokens: approxTokens(answer) });

  return {
    async status(): Promise<AiStatus> {
      const found = await pick();
      return found ? { provider: found.provider.id, label: found.provider.label, availability: found.availability } : { provider: null, label: null, availability: 'unavailable' };
    },

    run(request: ActionRequest, signal?: AbortSignal): Promise<AiResult> {
      if (request.action === 'ask' && !request.question?.trim()) return Promise.resolve({ ok: false, code: 'failed', error: 'Type a question first.' });
      const key = aiCacheKey(request);
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) {
        recordUsage(hit.provider, request.action, true, hit.answer);
        return Promise.resolve({ ok: true, answer: hit.answer, provider: hit.provider, cached: true });
      }
      const pending = inflight.get(key);
      if (pending) return pending;

      const task = (async (): Promise<AiResult> => {
        const found = await pick();
        if (!found || found.availability !== 'available') {
          return { ok: false, code: 'unavailable', error: found?.availability === 'downloadable' || found?.availability === 'downloading' ? 'The on-device model is not downloaded yet.' : 'No AI provider is set up.' };
        }
        try {
          const prompt = buildPrompt(request.action, request.context, request.question);
          let answer = (await found.provider.complete(prompt, request, signal)).trim();
          if (!answer) return { ok: false, code: 'failed', error: 'The AI returned an empty answer.' };
          // One revision when the draft breaks the action's rules (e.g. quiz questions about the course instead of the subject).
          const revision = reviewAnswer(request.action, answer, request.context);
          if (revision) {
            const revised = (await found.provider.complete({ system: prompt.system, user: `${prompt.user}\n\nDraft:\n"""\n${answer}\n"""\n\n${revision}` }, request, signal)).trim();
            if (revised) answer = revised;
          }
          cache.set(key, { at: now(), answer, provider: found.provider.id });
          while (cache.size > max) cache.delete(cache.keys().next().value as string);
          recordUsage(found.provider.id, request.action, false, answer);
          return { ok: true, answer, provider: found.provider.id, cached: false };
        } catch (err) {
          return { ok: false, code: errorCode(err), error: err instanceof Error ? err.message : 'The AI request failed.' };
        }
      })().finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    },

    /**
     * Multi-turn chat — reuses provider selection and usage recording
     * verbatim, but never the moment cache: two questions in the same
     * conversation are different requests even at the same timestamp.
     */
    async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
      if (!request.question.trim()) return { ok: false, code: 'failed', error: 'Type a question first.' };
      const found = await pick();
      if (!found || found.availability !== 'available') {
        return { ok: false, code: 'unavailable', error: found?.availability === 'downloadable' || found?.availability === 'downloading' ? 'The on-device model is not downloaded yet.' : 'No AI provider is set up.' };
      }
      try {
        const prompt = buildChatPrompt(request.context, request.history, request.question);
        const answer = (await found.provider.complete(prompt, { action: 'chat', context: request.context, question: request.question }, signal)).trim();
        if (!answer) return { ok: false, code: 'failed', error: 'The AI returned an empty answer.' };
        recordUsage(found.provider.id, request.voice ? 'voice' : 'chat', false, answer);
        return { ok: true, answer, provider: found.provider.id };
      } catch (err) {
        return { ok: false, code: errorCode(err), error: err instanceof Error ? err.message : 'The AI request failed.' };
      }
    },
  };
}

export type AiService = ReturnType<typeof createAiService>;
