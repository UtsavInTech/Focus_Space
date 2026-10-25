import { describe, expect, it } from 'vitest';
import { nextTab } from './tab-navigation';

describe('product gallery keyboard navigation', () => {
  it('wraps in both directions for the hero and exam galleries', () => {
    for (const count of [4, 7]) {
      expect(nextTab('ArrowLeft', 0, count)).toBe(count - 1);
      expect(nextTab('ArrowRight', count - 1, count)).toBe(0);
      expect(nextTab('ArrowRight', 1, count)).toBe(2);
      expect(nextTab('ArrowLeft', 2, count)).toBe(1);
    }
  });
  it('supports Home and End without intercepting activation or Tab', () => {
    expect(nextTab('Home', 3, 7)).toBe(0);
    expect(nextTab('End', 0, 7)).toBe(6);
    for (const key of ['Tab', 'Enter', ' ', 'ArrowDown']) expect(nextTab(key, 1, 7)).toBeNull();
    expect(nextTab('End', 0, 0)).toBeNull();
  });
});
