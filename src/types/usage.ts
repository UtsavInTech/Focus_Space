/**
 * FocusSpace account usage/entitlement (Layer 2C — server/usage/*), as seen from the extension.
 * Distinct from src/learning/ai/usage.ts's `UsageSink`/`AiUsageRecord`: that is a small, ephemeral,
 * session-local log purely for the learner's own awareness (never persisted, never billed). This type
 * is the server's real, persisted monthly allowance for a signed-in account.
 */
export interface UsageStatusView {
  plan: string;
  period: string;
  used: number;
  /** `null` is unlimited (Infinity does not survive JSON), never "unknown". */
  limit: number | null;
  /** Seconds of speech this month, and the plan's allowance (server/usage/voice.ts). Absent from older servers. */
  voice?: { usedSeconds: number; limitSeconds: number };
  /** Checked quiz questions this month, the plan's allowance, and whether difficulty and score come with it (server/usage/quiz.ts). */
  quiz?: { used: number; limit: number; extras: boolean };
}
