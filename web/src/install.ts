/**
 * Where "Add to Chrome" goes. The Chrome Web Store assigns the listing's URL when it is created, so it
 * is set at build time — `VITE_CHROME_WEB_STORE_URL=https://chromewebstore.google.com/detail/…` — and
 * every install button reads it from here. Until it exists the buttons scroll to the install section
 * (and the build warns): a launch must not ship with "Add to Chrome" going nowhere.
 */
export const CHROME_WEB_STORE_URL = String(import.meta.env?.VITE_CHROME_WEB_STORE_URL ?? '').trim();

export const hasStoreListing = (): boolean => /^https:\/\/chromewebstore\.google\.com\//.test(CHROME_WEB_STORE_URL);

export const installHref = (): string => (hasStoreListing() ? CHROME_WEB_STORE_URL : '/#install');
