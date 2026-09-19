import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const load = () => import('./install');

describe('"Add to Chrome" goes to the store listing once it exists', () => {
  it('without a listing URL it falls back to the install section — and says so', async () => {
    vi.stubEnv('VITE_CHROME_WEB_STORE_URL', '');
    const { hasStoreListing, installHref } = await load();
    expect(hasStoreListing()).toBe(false);
    expect(installHref()).toBe('/#install');
  });

  it('with the listing URL every install button opens it', async () => {
    vi.stubEnv('VITE_CHROME_WEB_STORE_URL', 'https://chromewebstore.google.com/detail/focusspace/abcdefghijklmnopabcdefghijklmnop');
    const { hasStoreListing, installHref } = await load();
    expect(hasStoreListing()).toBe(true);
    expect(installHref()).toMatch(/^https:\/\/chromewebstore\.google\.com\/detail\//);
  });

  it('anything that is not the Chrome Web Store is ignored', async () => {
    vi.stubEnv('VITE_CHROME_WEB_STORE_URL', 'https://example.com/install');
    expect((await load()).installHref()).toBe('/#install');
  });
});
