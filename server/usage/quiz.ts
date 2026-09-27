import { QUIZ_EXTRAS_PLANS } from '@/billing/plans';
import { ApiError } from '../http';
import type { UsageDb } from './db';
import { limitsFor, resolvePlan } from './entitlements';
import { currentPeriod } from './period';

/**
 * Quiz allowance — checked questions a month, per the price book (`quizQuestions`). Every question is
 * written by one model and checked by another before it is shown (server/quiz/check.ts), so quizzes are
 * counted on their own rather than in AI credits. Only questions actually shown are counted: one the
 * checker drops costs the learner nothing.
 *
 * Quiz me needs an account; a request without one never reaches the model.
 */

export const QUIZ_SIGN_IN_MESSAGE = 'Sign in to use Quiz me. A free account includes quiz questions every month.';

export function assertQuizAllowed(db: UsageDb, userId: string, now = Date.now()): void {
  const limit = limitsFor(resolvePlan(db.getEntitlement(userId), now)).quizQuestionsPerPeriod;
  if (db.quizQuestions(userId, currentPeriod(now)) < limit) return;
  throw new ApiError(429, 'quota_exceeded', `You’ve used your ${limit} quiz questions this month. They reset at the start of next month, or upgrade for more.`);
}

export function recordQuiz(db: UsageDb, userId: string, questions: number, now = Date.now()): void {
  if (questions > 0) db.addQuizQuestions(userId, currentPeriod(now), questions, now);
}

export interface QuizStatus {
  used: number;
  limit: number;
  /** Choosing a difficulty and keeping score. */
  extras: boolean;
}

export function quizStatus(db: UsageDb, userId: string, now = Date.now()): QuizStatus {
  const plan = resolvePlan(db.getEntitlement(userId), now);
  return { used: db.quizQuestions(userId, currentPeriod(now)), limit: limitsFor(plan).quizQuestionsPerPeriod, extras: QUIZ_EXTRAS_PLANS.includes(plan) };
}
