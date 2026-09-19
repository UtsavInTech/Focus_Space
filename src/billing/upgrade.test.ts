import { describe, expect, it } from 'vitest';
import { upgradeOffer } from './upgrade';

describe('who is offered an upgrade', () => {
  it('Max and Unlimited never are — there is nothing above them to sell', () => {
    for (const plan of ['max', 'unlimited']) {
      expect(upgradeOffer(plan, { used: 999, limit: null })).toBeNull();
      expect(upgradeOffer(plan, { used: 15, limit: 15 })).toBeNull();
    }
  });

  it('Pro, at its limit, is offered Unlimited', () => {
    expect(upgradeOffer('pro', { used: 14, limit: 15 })).toBe('Need more Spaces? Go Unlimited');
  });

  it('Free, at its limit, is offered an upgrade', () => {
    expect(upgradeOffer('free', { used: 5, limit: 5 })).toBe('Want more Spaces? Upgrade');
  });

  it('nobody with room to spare is nagged', () => {
    expect(upgradeOffer('free', { used: 2, limit: 5 })).toBeNull();
    expect(upgradeOffer('pro', { used: 3, limit: 15 })).toBeNull();
    expect(upgradeOffer('free', null)).toBeNull();
  });
});
