import { afterEach, describe, expect, it } from 'vitest';
import { fakeChrome } from '@/test/fake-chrome';
import { ownedKeys } from '@/storage/ownership';
import { installId } from './install-id';

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('install id', () => {
  it('is made once and kept', async () => {
    fakeChrome({});
    const first = await installId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await installId()).toBe(first);
  });

  it('belongs to the device, not to a person — it does not change hands on sign-in or sign-out', () => {
    expect(ownedKeys()).not.toContain('installId');
  });
});
