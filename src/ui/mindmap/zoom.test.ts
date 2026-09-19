import { describe, expect, it } from 'vitest';
import { clampZoom, fitZoom, MAX_ZOOM, MIN_ZOOM } from './zoom';

describe('mind map zoom', () => {
  it('a map wider than its frame is fitted down to the frame', () => {
    expect(fitZoom(2000, 1000)).toBe(0.5);
  });
  it('a small map is never blown up past its natural size', () => {
    expect(fitZoom(400, 1000)).toBe(1);
  });
  it('an enormous map stops at a readable minimum and scrolls', () => {
    expect(fitZoom(100_000, 800)).toBe(MIN_ZOOM);
  });
  it('before the frame is measured, draws at natural size', () => {
    expect(fitZoom(1200, 0)).toBe(1);
  });
  it('zoom stays within bounds', () => {
    expect(clampZoom(5)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });
});
