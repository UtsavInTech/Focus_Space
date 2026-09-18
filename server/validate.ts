import type { NoteLanguage } from '@/types/notes';
import type { ChatMessage } from '@/types/chat';
import { AI_ACTIONS } from '@/learning/ai/actions';
import { isHomepageContext } from '@/learning/ai/homepage-context';
import { ApiError } from './http';
import type { AiApiRequest, ApiAction, ApiContext } from './types';

/**
 * Lightweight, hand-written structural validation — no schema library.
 * Nothing else in this project uses one (see src/storage/schema.ts's own
 * hand-written `normalize()` for the same convention), and the surface here
 * is small enough not to need one. Every check is aligned with the actual
 * TS shapes (LearningContext/HomepageContext/ChatMessage) rather than an
 * independently-maintained schema.
 */

const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_TEXT_CHARS = 4_000;
const MAX_PROMPT_SYSTEM_CHARS = 8_000;
const MAX_PROMPT_USER_CHARS = 24_000;
/** Generous cap on the whole context payload — big enough for a full-video note's transcript window, small enough to reject something pathological. */
const MAX_CONTEXT_JSON_CHARS = 60_000;
/** Layer 2C — an opaque client-chosen retry identifier, not a secret; generous but bounded. */
const MAX_IDEMPOTENCY_KEY_CHARS = 128;

const VALID_ACTIONS = new Set<string>([...AI_ACTIONS.map((a) => a.id), 'chat', 'notes', 'mindmap']);
/** Actions that only ever ran against a real video before Layer 2A — homepage context must not silently start answering them (see docs/V5_CONTRACT.md and the Layer 1.5 transcript/moment bug this must not reintroduce). */
const VIDEO_ONLY_ACTIONS = new Set<string>(AI_ACTIONS.map((a) => a.id));

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidLanguage(v: unknown): v is NoteLanguage {
  return v === 'en' || v === 'hi' || v === 'hinglish';
}

/** Minimal structural check — not exhaustive against every LearningContext field, just enough to catch a malformed/wrong-shaped payload. */
function looksLikeLearningContext(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const mode = v.mode;
  return (
    typeof v.videoId === 'string' &&
    typeof v.videoTitle === 'string' &&
    typeof v.channel === 'string' &&
    typeof v.currentTime === 'number' &&
    isValidLanguage(v.language) &&
    isPlainObject(mode) &&
    typeof mode.id === 'string' &&
    typeof mode.name === 'string'
  );
}

function looksLikeContext(v: unknown): v is ApiContext {
  return isHomepageContext(v) || looksLikeLearningContext(v);
}

function validateHistory(v: unknown): ChatMessage[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new ApiError(400, 'invalid_request', '"history" must be an array.');
  if (v.length > MAX_HISTORY_TURNS) throw new ApiError(400, 'invalid_request', `"history" cannot exceed ${MAX_HISTORY_TURNS} turns.`);
  for (const turn of v) {
    if (!isPlainObject(turn) || (turn.role !== 'learner' && turn.role !== 'assistant') || typeof turn.text !== 'string') {
      throw new ApiError(400, 'invalid_request', 'Each "history" entry must be a {role, text, ...} chat message.');
    }
    if (turn.text.length > MAX_HISTORY_TEXT_CHARS) throw new ApiError(400, 'invalid_request', 'A "history" entry is too long.');
  }
  return v as ChatMessage[];
}

function validatePrompt(v: unknown): AiApiRequest['prompt'] {
  if (v === undefined) return undefined;
  if (!isPlainObject(v) || typeof v.system !== 'string' || typeof v.user !== 'string') {
    throw new ApiError(400, 'invalid_request', 'When present, "prompt" must be { system: string, user: string }.');
  }
  if (v.system.length > MAX_PROMPT_SYSTEM_CHARS || v.user.length > MAX_PROMPT_USER_CHARS) {
    throw new ApiError(400, 'invalid_request', 'The provided prompt is too large.');
  }
  return { system: v.system, user: v.user };
}

/** Throws ApiError(400, 'invalid_request', …) on the first problem found. Never throws anything else — callers can treat this as the single validation gate. */
export function validateAiApiRequest(raw: unknown): AiApiRequest {
  if (!isPlainObject(raw)) throw new ApiError(400, 'invalid_request', 'Expected a JSON object body.');

  const action = raw.action;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new ApiError(400, 'invalid_request', `"action" must be one of: ${[...VALID_ACTIONS].join(', ')}.`);
  }

  const context = raw.context;
  if (!looksLikeContext(context)) throw new ApiError(400, 'invalid_request', '"context" is missing or does not match LearningContext/HomepageContext.');
  if (JSON.stringify(context).length > MAX_CONTEXT_JSON_CHARS) throw new ApiError(400, 'invalid_request', '"context" is too large.');

  // The point actions (what/explain/example/ask/quiz) and notes/mindmap are video-only — reusing a
  // HomepageContext for them would silently reintroduce a "no transcript" style failure elsewhere.
  if (VIDEO_ONLY_ACTIONS.has(action) && isHomepageContext(context)) {
    throw new ApiError(400, 'invalid_request', `"${action}" requires a LearningContext (a specific video), not a HomepageContext.`);
  }

  // `null` means "no question" exactly as an absent field does. Extensions already installed
  // send null for notes/mindmap, and a validator that rejects it breaks them on a server deploy
  // they did not ask for — the API is the half of this pair that must stay tolerant.
  if (raw.question !== undefined && raw.question !== null && typeof raw.question !== 'string') {
    throw new ApiError(400, 'invalid_request', '"question" must be a string.');
  }
  const question: string | undefined = typeof raw.question === 'string' ? raw.question : undefined;
  if (question !== undefined && question.length > MAX_QUESTION_CHARS) throw new ApiError(400, 'invalid_request', '"question" is too long.');

  const prompt = validatePrompt(raw.prompt);
  const history = validateHistory(raw.history);

  if (raw.idempotencyKey !== undefined && (typeof raw.idempotencyKey !== 'string' || !raw.idempotencyKey.trim() || raw.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_CHARS)) {
    throw new ApiError(400, 'invalid_request', `"idempotencyKey" must be a non-empty string of at most ${MAX_IDEMPOTENCY_KEY_CHARS} characters.`);
  }
  const idempotencyKey: string | undefined = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : undefined;

  // ask/chat need a real question unless the caller already built the prompt itself.
  if ((action === 'ask' || action === 'chat') && !prompt && !question?.trim()) {
    throw new ApiError(400, 'invalid_request', `"${action}" requires a non-empty "question" (or a pre-built "prompt").`);
  }
  // notes/mindmap don't rebuild prompts server-side yet (Layer 2A) — see orchestrator.ts.
  if ((action === 'notes' || action === 'mindmap') && !prompt) {
    throw new ApiError(400, 'invalid_request', `"${action}" requires a pre-built "prompt" in this version of the API.`);
  }

  return {
    version: 1,
    action: action as ApiAction,
    context,
    question,
    history,
    prompt,
    idempotencyKey,
  };
}
