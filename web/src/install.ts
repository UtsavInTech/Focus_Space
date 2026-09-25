/**
 * Where "Add to Chrome" goes. The Chrome Web Store assigns the listing's URL when it is created, so it
 * is set at build time — `VITE_CHROME_WEB_STORE_URL=https://chromewebstore.google.com/detail/…` — and
 * every install button reads it from here. Until it exists the buttons scroll to the install section
 * (and the build warns): a launch must not ship with "Add to Chrome" going nowhere.
 */
export const CHROME_WEB_STORE_URL = String(import.meta.env?.VITE_CHROME_WEB_STORE_URL ?? '').trim();

export const hasStoreListing = (): boolean => /^https:\/\/chromewebstore\.google\.com\//.test(CHROME_WEB_STORE_URL);

export const installHref = (): string => (hasStoreListing() ? CHROME_WEB_STORE_URL : '/#install');

/**
 * Phones and tablets cannot install a Chrome extension — the store listing opens there and offers nothing
 * to press. So on those devices "Add to Chrome" becomes a way to get the link to a computer instead.
 *
 * Decided from the user agent, not from touch: a touch-screen laptop runs desktop Chrome and can install.
 * iPadOS reports itself as a Mac, so a "Macintosh" with a touch screen is counted as the tablet it is.
 */
export function isPhoneOrTablet(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export const onPhoneOrTablet = (): boolean =>
  typeof navigator !== 'undefined' && isPhoneOrTablet(navigator.userAgent, navigator.maxTouchPoints ?? 0);

export const SITE_LINK = 'https://focusspace.xyz';

/**
 * Hands the site's link to the phone's own share sheet (to email, WhatsApp or a note to oneself), or copies
 * it where there is no share sheet. Resolves to what happened, so the button can say so.
 */
export async function sendLinkToComputer(): Promise<'shared' | 'copied' | 'failed'> {
  const share = { title: 'FocusSpace', text: 'FocusSpace — open this on your computer to add it to Chrome.', url: SITE_LINK };
  try {
    if (navigator.share) {
      await navigator.share(share);
      return 'shared';
    }
  } catch (err) {
    // Dismissing the share sheet is a choice, not an error to fall back from.
    if (err instanceof DOMException && err.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(SITE_LINK);
    return 'copied';
  } catch {
    return 'failed';
  }
}
