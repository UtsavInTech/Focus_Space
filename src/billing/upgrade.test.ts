import { describe, expect, it } from 'vitest';
import { upgradeOffer } from './upgrade';

describe('who is offered an upgrade', () => {
  it('Max and Unlimited never are — there is nothing above them to sell', () => {
    for (const plan of ['max', 'unlimited']) {
      expect(upgradeOffer(plan, { used: 999, limit: null })).toBeNull();
      expect(upgradeOffer(plan, { used: 15, limit: 15 })).toBeNull();
    }
  });

  it('each plan, at its limit, is offered the next rung', () => {
    expect(upgradeOffer('basic', { used: 15, limit: 15 })).toBe('Need more Spaces? Go Plus');
    expect(upgradeOffer('plus', { used: 24, limit: 25 })).toBe('Need more Spaces? Go Pro');
    // Max is coming soon: nothing to sell a Pro learner yet, so nothing is offered.
    expect(upgradeOffer('pro', { used: 49, limit: 50 })).toBeNull();
  });

  it('Free, at its limit, is offered Basic', () => {
    expect(upgradeOffer('free', { used: 5, limit: 5 })).toBe('Want more Spaces? Basic is ₹99 for life');
  });

  it('nobody with room to spare is nagged', () => {
    expect(upgradeOffer('free', { used: 2, limit: 5 })).toBeNull();
    expect(upgradeOffer('pro', { used: 3, limit: 15 })).toBeNull();
    expect(upgradeOffer('free', null)).toBeNull();
  });
});
