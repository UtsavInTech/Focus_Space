import { describe, expect, it } from 'vitest';
import { UsageDb } from './db';
import { assertVoiceAllowed, recordVoice, secondsHeard, secondsToSay, voiceStatus } from './voice';
import { planById } from '@/billing/plans';

const NOW = Date.UTC(2026, 8, 27, 10);

describe('voice allowance', () => {
  it('estimates seconds from what the server handles, not from the client', () => {
    expect(secondsToSay('x'.repeat(140))).toBe(10);
    expect(secondsHeard(40_000)).toBe(10); // 40 kB of 32 kbit/s Opus
    expect(secondsToSay('')).toBe(1);
  });

  it('lets a guest talk only while setting up, a few minutes a day', () => {
    const db = new UsageDb(':memory:');
    const guest = { kind: 'guest' as const, key: 'install-a' };
    expect(() => assertVoiceAllowed(db, guest, 'chat', 5, NOW)).toThrow(/Sign in to talk/);
    assertVoiceAllowed(db, guest, 'setup', 5, NOW);
    recordVoice(db, guest, 'setup', 5 * 60 - 5, NOW);
    assertVoiceAllowed(db, guest, 'setup', 5, NOW);
    recordVoice(db, guest, 'setup', 5, NOW);
    expect(() => assertVoiceAllowed(db, guest, 'setup', 1, NOW)).toThrow(/today’s 5 minutes/);
    // Tomorrow is a new day.
    assertVoiceAllowed(db, guest, 'setup', 60, NOW + 24 * 3600_000);
  });

  it('gives a free account its monthly minutes, and stops at them', () => {
    const db = new UsageDb(':memory:');
    const user = { kind: 'user' as const, userId: 'u1' };
    const limit = planById('free').limits.voiceMinutes * 60;
    recordVoice(db, user, 'chat', limit - 10, NOW);
    assertVoiceAllowed(db, user, 'chat', 10, NOW);
    expect(() => assertVoiceAllowed(db, user, 'chat', 11, NOW)).toThrow(/minutes of voice this month/);
    expect(voiceStatus(db, 'u1', NOW)).toEqual({ usedSeconds: limit - 10, limitSeconds: limit });
  });

  it('never gives any plan unlimited voice', () => {
    for (const id of ['free', 'pro', 'unlimited', 'max'] as const) expect(Number.isFinite(planById(id).limits.voiceMinutes)).toBe(true);
  });
});
