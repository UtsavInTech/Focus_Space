import { describe, expect, it } from 'vitest';
import { UsageDb } from './db';
import { activitySubject, isAdmin, metrics, recordActive } from './activity';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 3, 12); // Monday 3 Aug 2026

describe('active-use counts', () => {
  it('stores a hash of the install, never the install id itself', () => {
    const s = activitySubject('0f8c2a1e-3b4d-4e5f-8a9b-1c2d3e4f5a6b', 'secret');
    expect(s).not.toContain('0f8c2a1e');
    expect(activitySubject('0f8c2a1e-3b4d-4e5f-8a9b-1c2d3e4f5a6b', 'secret')).toBe(s);
    expect(activitySubject('0f8c2a1e-3b4d-4e5f-8a9b-1c2d3e4f5a6b', 'other')).not.toBe(s);
  });

  it('counts daily, weekly and monthly actives once per install', () => {
    const db = new UsageDb(':memory:');
    recordActive(db, 'a', false, T0);
    recordActive(db, 'a', false, T0); // same day twice
    recordActive(db, 'b', true, T0 - 3 * DAY);
    recordActive(db, 'c', false, T0 - 20 * DAY);
    const m = metrics(db, T0);
    expect(m.active).toEqual({ day: 1, week: 2, month: 3, weekSignedIn: 1 });
    expect(m.stickiness).toBe(0.67);
  });

  it('measures retention of a week’s new installs — and says so only once it can know', () => {
    const db = new UsageDb(':memory:');
    for (const s of ['a', 'b', 'c', 'd']) recordActive(db, s, false, T0); // cohort of 4, week of 3 Aug
    recordActive(db, 'a', false, T0 + 7 * DAY); // back the next week
    recordActive(db, 'b', false, T0 + 9 * DAY);
    recordActive(db, 'a', false, T0 + 30 * DAY); // back a month later
    const later = metrics(db, T0 + 40 * DAY);
    const row = later.retention.find((r) => r.week === '2026-08-03')!;
    expect(row.size).toBe(4);
    expect(row.day7).toBe(0.5);
    expect(row.day30).toBe(0.25);
    const early = metrics(db, T0 + 2 * DAY).retention.find((r) => r.week === '2026-08-03')!;
    expect(early.day30).toBeNull();
  });

  it('opens the numbers only to the right admin token', () => {
    const token = 'x'.repeat(32);
    expect(isAdmin(`Bearer ${token}`, token)).toBe(true);
    expect(isAdmin(`Bearer ${'y'.repeat(32)}`, token)).toBe(false);
    expect(isAdmin(`Bearer ${token}`, undefined)).toBe(false);
    expect(isAdmin(`Bearer short`, 'short')).toBe(false);
  });
});
