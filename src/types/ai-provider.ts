/**
 * Provider/usage abstraction contract (V5, workstream 3).
 *
 * Generalises today's `AiProvider` (src/learning/ai/service.ts), whose `id`
 * is hardcoded to 'chrome' | 'endpoint'. WS3 widens that union to
 * `ProviderId` and adds capability flags + usage accounting. No API keys
 * ever live in the extension; a remote provider is always reached through
 * the learner's own endpoint (see AI_ARCHITECTURE.md) — 'openrouter' and
 * 'openai' name the upstream the learner's endpoint forwards to, they are
 * never called directly from the extension.
 *
 * Payments/subscriptions are out of scope for this phase — `AiUsageRecord`
 * exists so the learner can see their own usage, not for billing.
 *
 * Do not change these shapes without updating docs/V5_CONTRACT.md.
 */

export const PROVIDER_VERSION = 1;

export type ProviderId = 'chrome' | 'endpoint' | 'openrouter' | 'openai';

export interface ProviderCapabilities {
  /** Single-shot actions (what/explain/example/quiz/ask/notes/mindmap) — required of every provider. */
  actions: boolean;
  /** Multi-turn chat. */
  chat: boolean;
  /** Streamed tokens rather than one completion. */
  streaming: boolean;
  /** Voice input/output, proxied through the endpoint. */
  voice: boolean;
}

export interface AiUsageRecord {
  provider: ProviderId;
  /** AiAction | 'chat' | 'voice'. */
  action: string;
  at: number;
  cached: boolean;
  /** Rough estimate for the learner's own awareness — never billed by FocusSpace in this phase. */
  approxTokens: number | null;
}
