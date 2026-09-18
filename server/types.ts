import type { ChatMessage } from '@/types/chat';
import type { LearningContext } from '@/learning/context/context';
import type { AiAction, AiPrompt } from '@/learning/ai/actions';
import type { HomepageContext } from '@/learning/ai/homepage-context';
import type { ApiErrorResponse } from './http';
import type { PublicUser } from './auth/service';
import type { TokenUsage } from './openrouter';

/**
 * The FocusSpace API contract (Layer 2A). Deliberately reuses the extension's
 * own types instead of redefining them — `LearningContext`/`HomepageContext`
 * are imported, not duplicated, so the two stay structurally identical by
 * construction, not by convention.
 */

export const API_VERSION = 1 as const;

export type ApiContext = LearningContext | HomepageContext;

/** What "kind" of request this is — mirrors the extension's own action vocabulary (learning/ai/actions.ts, chat.ts), not a new one. */
export type ApiAction = AiAction | 'chat' | 'notes' | 'mindmap';

export interface AiApiRequest {
  version: 1;
  action: ApiAction;
  context: ApiContext;
  question?: string;
  /** Chat only — recent turns, same shape ChatPanel already sends today. */
  history?: ChatMessage[];
  /**
   * A prompt already built client-side (what the extension sends today via
   * buildPrompt/buildChatPrompt/WS2's notes generator). When present the
   * orchestrator uses it as-is — this is what keeps today's extension able
   * to talk to this API with zero code changes (see docs). When absent (a
   * genuinely structured request), the orchestrator builds the prompt
   * itself from `context`/`action`/`question`/`history`, reusing the exact
   * same prompt-building functions.
   */
  prompt?: AiPrompt;
  /** Optional (Layer 2C) — lets a retried/duplicated logical request be recognized without double-consuming usage. Omitted by today's extension; see docs/LAYER_2C_USAGE_ENTITLEMENTS.md. */
  idempotencyKey?: string;
}

export interface AiApiSuccess {
  ok: true;
  answer: string;
  provider: 'openrouter';
  model: string;
  /** Token counts from OpenRouter's own response, when present (Layer 2C usage accounting) — never a second call, never estimated. */
  usage: TokenUsage | null;
}

export type AiApiResponse = AiApiSuccess | ApiErrorResponse;

/**
 * Auth contract (Layer 2B) — a deliberately separate response family from the
 * AI one above, kept in the same file only because it's the one place this
 * server already declares its wire types. Routes live under /v1/auth/* and
 * /v1/me, never under /v1/ai/*; see server/index.ts.
 */

export interface AuthSuccess {
  ok: true;
  user: PublicUser;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}
export type AuthApiResponse = AuthSuccess | ApiErrorResponse;

export interface RefreshSuccess {
  ok: true;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}
export type RefreshApiResponse = RefreshSuccess | ApiErrorResponse;

export interface MeSuccess {
  ok: true;
  user: PublicUser;
}
export type MeApiResponse = MeSuccess | ApiErrorResponse;

export interface LogoutSuccess {
  ok: true;
}
export type LogoutApiResponse = LogoutSuccess | ApiErrorResponse;

/**
 * Usage contract (Layer 2C) — GET /v1/me/usage. Deliberately minimal: just
 * enough for a future UI to show "X of Y this month", never a billing surface.
 */
export interface UsageStatusSuccess {
  ok: true;
  plan: string;
  period: string;
  used: number;
  limit: number;
}
export type UsageStatusApiResponse = UsageStatusSuccess | ApiErrorResponse;
