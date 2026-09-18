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
  limit: number;
}
