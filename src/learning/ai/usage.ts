import type { AiUsageRecord } from '@/types/ai-provider';

/**
 * Learner-facing AI usage accounting (docs/V5_CONTRACT.md §F) — a small,
 * local, append-only log for the learner's own awareness. Explicitly not a
 * metering/billing system: no subscriptions or payments this phase.
 */

export interface UsageSink {
  record(entry: AiUsageRecord): void;
}

export function createUsageLog(max = 200) {
  const log: AiUsageRecord[] = [];
  const sink: UsageSink = {
    record(entry) {
      log.push(entry);
      if (log.length > max) log.shift();
    },
  };
  return { sink, entries: (): AiUsageRecord[] => [...log] };
}

/** Rough token estimate (~4 chars/token) — for the learner's own sense of usage, never billed. */
export const approxTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));
