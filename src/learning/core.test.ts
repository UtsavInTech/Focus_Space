import { describe, expect, it } from 'vitest';
import { keywordPattern, parseList, uniqueId } from './text';
import { elapsedMs, formatClock, remainingMs } from './session';
import { addUsage, dateKey, minutesToday } from './usage';
import type { LearningSession } from '@/types/domain';

describe('keywordPattern', () => {
  const m = (k: string, text: string) => keywordPattern(k)!.test(text.toLowerCase());
  it('respects word boundaries', () => {
    expect(m('dp', 'DP on trees')).toBe(true);
    expect(m('dp', 'high dpi screens')).toBe(false);
    expect(m('java', 'javascript basics')).toBe(false);
    expect(m('ai', 'said the teacher')).toBe(false);
  });
  it('handles symbols, plurals and hyphens', () => {
    expect(m('next.js', 'next.js 15 tutorial')).toBe(true);
    expect(m('ci/cd', 'ci/cd pipelines')).toBe(true);
    expect(m('c++', 'c++ stl')).toBe(true);
    expect(m('array', 'arrays and strings')).toBe(true);
    expect(m('n queens', 'the n-queens problem')).toBe(true);
  });
});

describe('text helpers', () => {
  it('parses lists and makes unique ids', () => {
    expect(parseList('a, b\nA, c,,')).toEqual(['a', 'b', 'c']);
    expect(uniqueId('Dynamic Programming', ['dynamic-programming'])).toBe('dynamic-programming-2');
  });
});

describe('sessions', () => {
  const base: LearningSession = { id: 's', modeId: 'dsa', topicId: null, goal: 'DP', plannedMinutes: 60, startedAt: 0, endedAt: null, pausedAt: null, pausedMs: 0, status: 'active', limitReachedAt: null };
  it('measures elapsed time excluding pauses', () => {
    expect(elapsedMs(base, 10 * 60_000)).toBe(10 * 60_000);
    expect(elapsedMs({ ...base, pausedMs: 60_000 }, 10 * 60_000)).toBe(9 * 60_000);
    expect(elapsedMs({ ...base, status: 'paused', pausedAt: 5 * 60_000 }, 50 * 60_000)).toBe(5 * 60_000);
    expect(remainingMs(base, 42 * 60_000)).toBe(18 * 60_000);
  });
  it('formats clocks', () => {
    expect(formatClock(42 * 60_000 + 18_000)).toBe('42:18');
    expect(formatClock(3_600_000 + 5_000)).toBe('1:00:05');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('usage', () => {
  it('accumulates per day and mode and prunes old days', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    let usage = addUsage({}, 'dsa', 15, now);
    usage = addUsage(usage, 'dsa', 45, now);
    expect(minutesToday(usage, 'dsa', now)).toBe(1);
    expect(dateKey(now)).toBe('2026-09-13');
    const old = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`2025-01-${String(i).padStart(3, '0')}`, { dsa: 1 }]));
    expect(Object.keys(addUsage(old, 'dsa', 1, now, 90))).toHaveLength(90);
  });
});
