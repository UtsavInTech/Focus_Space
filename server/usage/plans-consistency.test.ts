import { describe, expect, it } from 'vitest';
import { FREE_MONTHLY_AI_CREDITS, FREE_SPACE_LIMIT, GUEST_DAILY_AI_CREDITS, GUEST_SPACE_LIMIT, PLANS, planById } from '@/billing/plans';
import { FAQ } from '../../web/src/content/faq';
import { answer } from '../../web/src/assistant';
import { limitsFor } from './entitlements';
import { ANON_DAILY_AI_UNITS } from './service';
import { spaceLimitMessage } from './spaces';

/**
 * The price book is the one source of truth for what a plan includes. These tests hold every other
 * place to it: the enforcement code, and the copy a visitor reads before paying.
 */

// Features the product does not have. Advertising any of them on a paid plan is selling something that isn't there.
const UNBUILT = [/sync/i, /across devices/i, /between devices/i, /premium/i, /advanced model/i, /sub-?topic/i, /playlist/i, /transcript window/i, /early access/i];

describe('the price book advertises only what exists', () => {
  it.each(PLANS.map((p) => [p.name, p] as const))('%s lists no unbuilt feature', (_, plan) => {
    for (const line of [plan.tagline, ...plan.features, ...(plan.missing ?? [])]) {
      for (const pattern of UNBUILT) expect(line, `"${line}"`).not.toMatch(pattern);
    }
  });

  it('carries only the limits the product enforces', () => {
    for (const plan of PLANS) expect(Object.keys(plan.limits).sort()).toEqual(['aiCredits', 'modes', 'voiceMinutes']);
  });

  it('Free is 3 Spaces without an account and 5 with one', () => {
    expect(GUEST_SPACE_LIMIT).toBe(3);
    expect(FREE_SPACE_LIMIT).toBe(5);
    expect(planById('free').limits.modes).toBe(FREE_SPACE_LIMIT);
    expect(planById('free').features.join(' ')).toContain(`${GUEST_SPACE_LIMIT} Spaces without an account, ${FREE_SPACE_LIMIT} with a free account`);
  });
});

describe('the server enforces exactly what the price book says', () => {
  it.each(PLANS.map((p) => [p.id] as const))('%s', (id) => {
    const plan = planById(id);
    expect(limitsFor(id).maxSpaces).toBe(plan.limits.modes ?? Infinity);
    expect(limitsFor(id).aiUnitsPerPeriod).toBe(plan.limits.aiCredits ?? Infinity);
  });

  it('the signed-out daily allowance is the price book’s number', () => {
    expect(ANON_DAILY_AI_UNITS).toBe(GUEST_DAILY_AI_CREDITS);
  });

  it('the Space-limit message names the plan the learner is actually on', () => {
    expect(spaceLimitMessage('free', FREE_SPACE_LIMIT)).toBe(`Your Free plan includes ${FREE_SPACE_LIMIT} Spaces. Delete one you no longer use to make room, or upgrade for more.`);
    expect(spaceLimitMessage('pro', 15)).toContain('Pro plan includes 15 Spaces');
    expect(spaceLimitMessage('pro', 15)).not.toMatch(/paid plan/);
  });
});

describe('the website quotes the same numbers', () => {
  const faq = FAQ.map((item) => item.a).join('\n');

  it('the FAQ states the guest and free-account allowances from the price book', () => {
    expect(faq).toContain(`${GUEST_SPACE_LIMIT} Spaces and ${GUEST_DAILY_AI_CREDITS} AI credits a day`);
    expect(faq).toContain(`${FREE_SPACE_LIMIT} Spaces and ${FREE_MONTHLY_AI_CREDITS} AI credits a month`);
  });

  it('the FAQ promises no sync — data stays in the browser', () => {
    for (const pattern of [/between devices/i, /across devices/i, /carries your modes and notes/i]) expect(faq).not.toMatch(pattern);
  });

  it('the site assistant quotes the price book for Spaces and pricing', () => {
    const modes = answer('What is a mode?').text;
    expect(modes).toContain(`${GUEST_SPACE_LIMIT} without an account, ${FREE_SPACE_LIMIT} with a free account, ${planById('pro').limits.modes} on Pro`);
    expect(answer('How much does it cost?').text).toContain(`${GUEST_SPACE_LIMIT} Spaces without an account, ${FREE_SPACE_LIMIT} with a free account`);
  });
});
