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

describe('phones and tablets get the link instead of a store page they cannot use', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
  const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  it('recognises phones and tablets, including an iPad that reports itself as a Mac', async () => {
    const { isPhoneOrTablet } = await load();
    expect(isPhoneOrTablet(IPHONE)).toBe(true);
    expect(isPhoneOrTablet(ANDROID)).toBe(true);
    expect(isPhoneOrTablet(IPAD_AS_MAC, 5)).toBe(true);
  });

  it('leaves desktop Chrome — touch screen or not — with the install button', async () => {
    const { isPhoneOrTablet } = await load();
    expect(isPhoneOrTablet(DESKTOP_CHROME, 0)).toBe(false);
    expect(isPhoneOrTablet(WINDOWS_CHROME, 10)).toBe(false);
  });
});
