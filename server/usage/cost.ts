/**
 * Per-action usage cost, in abstract units — mirrors the relative complexity
 * already encoded in src/learning/ai/actions.ts's WINDOW_FOR table (transcript
 * window length, maxChars) rather than inventing numbers. See
 * docs/LAYER_2C_USAGE_ENTITLEMENTS.md for the reasoning and its limits (note
 * scope isn't visible to the server yet, so notes/mindmap can't be split by
 * section vs. full video today).
 */
export const ACTION_COST: Record<string, number> = {
  what: 1,
  ask: 1,
  example: 1,
  chat: 1,
  explain: 2,
  quiz: 2,
  notes: 3,
  mindmap: 3,
};

const DEFAULT_COST = 1;

export function costOf(action: string): number {
  return ACTION_COST[action] ?? DEFAULT_COST;
}
