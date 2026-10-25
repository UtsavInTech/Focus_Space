import { describe, expect, it } from 'vitest';
import { TitleCache } from './titles';

describe('Studio lesson titles', () => {
  it('fetches each id once a day, skips failures and keeps nothing it could not fetch', async () => {
    let now = 0;
    const calls: string[] = [];
    const cache = new TitleCache(async (id) => {
      calls.push(id);
      if (id === 'broken00000') throw new Error('offline');
      return id === 'missing0000' ? null : `Title ${id}`;
    }, () => now);

    expect(await cache.titles(['aaaaaaaaaaa', 'aaaaaaaaaaa', 'broken00000', 'missing0000'])).toEqual({ aaaaaaaaaaa: 'Title aaaaaaaaaaa' });
    expect(calls).toEqual(['aaaaaaaaaaa', 'broken00000', 'missing0000']);

    await cache.titles(['aaaaaaaaaaa']);
    expect(calls).toHaveLength(3); // still fresh

    now += 25 * 60 * 60 * 1000;
    await cache.titles(['aaaaaaaaaaa']);
    expect(calls).toHaveLength(4); // refreshed after a day
  });
});
