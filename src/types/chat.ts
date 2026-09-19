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
  /** '' for a conversation held on YouTube's home or search rather than on a video. */
  videoId: string;
  modeId: string;
  /** What the conversation was about, for the Library: the video's title, or where it happened. */
  title?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
