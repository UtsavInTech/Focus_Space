import { GUEST_SETUP_VOICE_MINUTES_PER_MONTH } from '@/billing/plans';
import { ApiError } from '../http';
import type { UsageDb } from './db';
import { limitsFor, resolvePlan } from './entitlements';
import { currentPeriod } from './period';

/**
 * Voice allowance — seconds of speech a month, yours and FocusSpace's together, per the price book
 * (`voiceMinutes`). Talking is the most expensive thing FocusSpace does, so it is metered on its own
 * rather than folded into AI credits, and no plan gets it without limit.
 *
 * Without an account, voice exists only to help someone set up (`purpose: 'setup'`): a few minutes a
 * month per install — never more than a free account gets, or nobody would sign in. Everything else — Talk in FocusSpace AI, reading an answer aloud,
 * dictation — needs an account.
 *
 * Seconds are estimated on the server from what it actually handles, never taken from the client:
 * speech it makes from the length of the text, speech it hears from the size of the recording.
 */

export type VoicePurpose = 'setup' | 'chat';

export type VoiceCaller = { kind: 'user'; userId: string } | { kind: 'guest'; key: string };

/** Natural speech runs at about 14 characters a second. */
export const secondsToSay = (text: string) => Math.max(1, Math.ceil(text.length / 14));
/** The extension records Opus at 32 kbit/s (content/ui/voice.ts), so bytes tell the length. */
export const secondsHeard = (bytes: number) => Math.max(1, Math.ceil((bytes * 8) / 32_000));

export function parsePurpose(value: unknown): VoicePurpose {
  return value === 'setup' ? 'setup' : 'chat';
}

interface Allowance {
  key: string;
  period: string;
  limitSeconds: number;
}

function allowanceFor(db: UsageDb, caller: VoiceCaller, purpose: VoicePurpose, now: number): Allowance {
  if (caller.kind === 'user') {
    const plan = resolvePlan(db.getEntitlement(caller.userId), now);
    return { key: caller.userId, period: currentPeriod(now), limitSeconds: limitsFor(plan).voiceSecondsPerPeriod };
  }
  if (purpose !== 'setup') throw new ApiError(403, 'forbidden', 'Sign in to talk with FocusSpace. A free account includes voice minutes every month.');
  return { key: `guest:${caller.key}`, period: currentPeriod(now), limitSeconds: GUEST_SETUP_VOICE_MINUTES_PER_MONTH * 60 };
}

/** Throws when this much more speech would go past the allowance. */
export function assertVoiceAllowed(db: UsageDb, caller: VoiceCaller, purpose: VoicePurpose, seconds: number, now = Date.now()): void {
  const a = allowanceFor(db, caller, purpose, now);
  if (db.voiceSeconds(a.key, a.period) + seconds <= a.limitSeconds) return;
  const minutes = Math.round(a.limitSeconds / 60);
  throw new ApiError(
    429,
    'quota_exceeded',
    caller.kind === 'guest'
      ? `That’s the ${minutes} minutes of voice for setting up without an account. Keep typing, or sign in for 30 minutes a month.`
      : `You’ve used your ${minutes} minutes of voice this month. Typing still works, or upgrade for more.`,
  );
}

export function recordVoice(db: UsageDb, caller: VoiceCaller, purpose: VoicePurpose, seconds: number, now = Date.now()): void {
  const a = allowanceFor(db, caller, purpose, now);
  db.addVoiceSeconds(a.key, a.period, seconds, now);
}

export interface VoiceStatus {
  usedSeconds: number;
  limitSeconds: number;
}

export function voiceStatus(db: UsageDb, userId: string, now = Date.now()): VoiceStatus {
  const a = allowanceFor(db, { kind: 'user', userId }, 'chat', now);
  return { usedSeconds: db.voiceSeconds(a.key, a.period), limitSeconds: a.limitSeconds };
}
