import type { AiAction, AiPrompt } from '@/learning/ai/actions';
import { buildPrompt } from '@/learning/ai/actions';
import { buildChatPrompt } from '@/learning/ai/chat';
import { isHomepageContext } from '@/learning/ai/homepage-context';
import type { LearningContext } from '@/learning/context/context';
import { ApiError } from './http';
import { callOpenRouter, type OpenRouterConfig } from './openrouter';
import type { AiApiRequest, AiApiSuccess } from './types';

/**
 * request → validate (validate.ts, already run before this is called) →
 * context → model selection → provider → response → usage.
 *
 * Layer 2A implements only what's needed now:
 *  - context handling: reuse the request's `prompt` if the extension already
 *    built one (today's behaviour, unchanged), otherwise build it here from
 *    `context`/`action`/`question`/`history` — the *exact same* functions
 *    (`buildPrompt`, `buildChatPrompt`) the extension itself calls, not a
 *    reimplementation.
 *  - model selection: the configured `OPENROUTER_MODEL` — a single seam
 *    (`OrchestratorDeps.config.model`) rather than per-request logic yet.
 *  - provider invocation: `callOpenRouter` (openrouter.ts).
 *
 * Extension points left for later layers, deliberately not implemented here:
 *  - authentication: none of this validates *who* is calling.
 *  - entitlement: no plan/quota check.
 *  - usage accounting: `onUsage` is a plain callback with nowhere to persist
 *    to yet — Layer 2B's job.
 */

export interface UsageEvent {
  action: string;
  model: string;
  at: number;
}

export interface OrchestratorDeps {
  config: OpenRouterConfig;
  /** Layer 2B+ extension point (usage/entitlement) — not implemented in 2A. */
  onUsage?: (event: UsageEvent) => void;
  signal?: AbortSignal;
}

function promptFor(request: AiApiRequest): AiPrompt {
  if (request.prompt) return request.prompt;

  if (request.action === 'chat') {
    return buildChatPrompt(request.context, request.history ?? [], request.question ?? '');
  }

  // notes/mindmap always carry a pre-built prompt — validate.ts enforces this before orchestrate() runs.
  if (request.action === 'notes' || request.action === 'mindmap') {
    throw new ApiError(400, 'invalid_request', `"${request.action}" requires a pre-built prompt in this version of the API.`);
  }

  // The remaining actions are the five point actions — video-only. validate.ts already rejected a
  // HomepageContext for these; this is a second, defensive check so the cast below is actually safe.
  if (isHomepageContext(request.context)) throw new ApiError(400, 'invalid_request', `"${request.action}" requires a LearningContext.`);
  return buildPrompt(request.action as AiAction, request.context as LearningContext, request.question);
}

/**
 * How long an answer may be, per action. One cap for everything (700 tokens) was right for "Explain this
 * moment" and far too small for notes or a mind map of a whole lecture, which it cut short however much
 * the video covered. The configured cap stays the floor; notes and mind maps get room to be complete.
 */
export const OUTPUT_TOKENS: Record<string, number> = { notes: 2400, mindmap: 1800, quiz: 1000 };
export const maxTokensFor = (action: string, configured: number): number => Math.max(configured, OUTPUT_TOKENS[action] ?? 0);

export async function orchestrate(request: AiApiRequest, deps: OrchestratorDeps): Promise<AiApiSuccess> {
  const prompt = promptFor(request);
  const { answer, usage } = await callOpenRouter(prompt, { ...deps.config, maxTokens: maxTokensFor(request.action, deps.config.maxTokens) }, deps.signal);
  deps.onUsage?.({ action: request.action, model: deps.config.model, at: Date.now() });
  return { ok: true, answer, provider: 'openrouter', model: deps.config.model, usage };
}
