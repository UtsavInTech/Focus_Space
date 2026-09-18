/**
 * Chat / voice contract (V5, workstream 3).
 *
 * A chat turn reuses `LearningContext` exactly as the existing single-shot AI
 * actions do (src/learning/ai/service.ts) — chat is the multi-turn
 * generalisation of `AiRequest`, not a second context mechanism. Voice is the
 * same chat pipeline with `voice: true` on the turn; there is no separate
 * voice context.
 *
 * Do not change these shapes without updating docs/V5_CONTRACT.md.
 */

export const CHAT_VERSION = 1;

export type ChatRole = 'learner' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  at: number;
  /** The moment this turn was about — set on both roles so history stays timestamp-aware. */
  videoId: string;
  currentTime: number;
  /** True if this turn came through voice input/output. */
  voice?: boolean;
}

export interface ChatSession {
  id: string;
  videoId: string;
  modeId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
