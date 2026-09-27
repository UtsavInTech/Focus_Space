import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IdentityDb } from '../auth/db';
import { PLANS, planById } from '@/billing/plans';
import { UsageDb } from './db';
import { assertQuizAllowed, quizStatus, recordQuiz } from './quiz';

const NOW = Date.UTC(2026, 8, 27, 10);

describe('quiz allowance', () => {
  it('counts shown questions per month and stops at the plan’s allowance', () => {
    const db = new UsageDb(':memory:');
    const limit = planById('free').limits.quizQuestions;
    recordQuiz(db, 'u1', limit - 1, NOW);
    assertQuizAllowed(db, 'u1', NOW);
    recordQuiz(db, 'u1', 1, NOW);
    expect(() => assertQuizAllowed(db, 'u1', NOW)).toThrow(/used your 5 quiz questions this month/);
    // Another account, and next month, start fresh.
    assertQuizAllowed(db, 'u2', NOW);
    assertQuizAllowed(db, 'u1', Date.UTC(2026, 9, 1));
    expect(quizStatus(db, 'u1', NOW)).toEqual({ used: limit, limit, extras: false });
  });

  it('never gives any plan unlimited quizzes, and gives difficulty and score to paid plans only', () => {
    for (const plan of PLANS) expect(Number.isFinite(plan.limits.quizQuestions)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'focusspace-quiz-test-'));
    const identity = new IdentityDb(join(dir, 'test.db'));
    const db = new UsageDb(join(dir, 'test.db'));
    identity.insertUser({ id: 'u3', email: 'u3@example.com', phone: null, password_hash: 'x', email_verified: 1, status: 'active', name: null, city: null, google_sub: null, created_at: NOW, updated_at: NOW });
    db.setPlan('u3', 'pro', NOW, NOW + 30 * 86400_000);
    expect(quizStatus(db, 'u1', NOW).extras).toBe(false);
    expect(quizStatus(db, 'u3', NOW)).toEqual({ used: 0, limit: planById('pro').limits.quizQuestions, extras: true });
    // A paid plan that has run out is free again.
    expect(quizStatus(db, 'u3', NOW + 31 * 86400_000).extras).toBe(false);
    identity.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('quiz rounds started at the same moment', () => {
  it('each holds its questions before any model is called, so they cannot all pass on one count', async () => {
    const { reserveQuiz, settleQuiz } = await import('./quiz');
    const db = new UsageDb(':memory:');
    const limit = planById('free').limits.quizQuestions; // 5
    const first = reserveQuiz(db, 'u1', 5, NOW);
    expect(() => reserveQuiz(db, 'u1', 5, NOW)).toThrow(/quiz questions this month/);
    // The round showed 3 of its 5 (two were dropped by the check): the other two come back.
    settleQuiz(db, 'u1', first, 3, NOW);
    expect(quizStatus(db, 'u1', NOW).used).toBe(3);
    // A round that fails gives everything back, and the count never goes below zero.
    const failed = reserveQuiz(db, 'u2', 5, NOW);
    settleQuiz(db, 'u2', failed, 0, NOW);
    expect(quizStatus(db, 'u2', NOW).used).toBe(0);
    expect(limit).toBe(5);
  });
});
