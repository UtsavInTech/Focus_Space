import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_DELAY_MS, createPlaybackIdle } from './playback-idle';

describe('the floating controls during playback', () => {
  let states: boolean[];
  const idle = () => states.at(-1) ?? false;

  beforeEach(() => {
    vi.useFakeTimers();
    states = [];
  });
  afterEach(() => vi.useRealTimers());

  it('stay up while nothing is playing, however long nobody touches anything', () => {
    createPlaybackIdle((s) => states.push(s));
    vi.advanceTimersByTime(IDLE_DELAY_MS * 10);
    expect(idle()).toBe(false);
  });

  it('fade out after the delay once the video plays, like YouTube’s own controls', () => {
    const c = createPlaybackIdle((s) => states.push(s));
    c.setPlaying(true);
    vi.advanceTimersByTime(IDLE_DELAY_MS - 1);
    expect(idle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(idle()).toBe(true);
  });

  it('come straight back on activity, and every movement restarts the countdown', () => {
    const c = createPlaybackIdle((s) => states.push(s));
    c.setPlaying(true);
    vi.advanceTimersByTime(IDLE_DELAY_MS);
    c.activity();
    expect(idle()).toBe(false);
    vi.advanceTimersByTime(IDLE_DELAY_MS - 500);
    c.activity();
    vi.advanceTimersByTime(IDLE_DELAY_MS - 500);
    expect(idle()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(idle()).toBe(true);
  });

  it('come back and stay when the video is paused', () => {
    const c = createPlaybackIdle((s) => states.push(s));
    c.setPlaying(true);
    vi.advanceTimersByTime(IDLE_DELAY_MS);
    c.setPlaying(false);
    expect(idle()).toBe(false);
    vi.advanceTimersByTime(IDLE_DELAY_MS * 10);
    expect(idle()).toBe(false);
  });

  it('are never pulled out from under someone hovering, focusing or dragging them', () => {
    const c = createPlaybackIdle((s) => states.push(s));
    c.setPlaying(true);
    c.setHold(true);
    vi.advanceTimersByTime(IDLE_DELAY_MS * 10);
    expect(idle()).toBe(false);
    // Let go, and the normal countdown starts from zero.
    c.setHold(false);
    vi.advanceTimersByTime(IDLE_DELAY_MS);
    expect(idle()).toBe(true);
  });

  it('report each change once, not on every mouse movement', () => {
    const c = createPlaybackIdle((s) => states.push(s));
    c.setPlaying(true);
    for (let i = 0; i < 50; i++) c.activity();
    vi.advanceTimersByTime(IDLE_DELAY_MS);
    expect(states).toEqual([true]);
  });

  it('stop counting when disposed', () => {
    const c = createPlaybackIdle((s) => states.push(s));
    c.setPlaying(true);
    c.dispose();
    vi.advanceTimersByTime(IDLE_DELAY_MS * 2);
    expect(states).toEqual([]);
  });
});
