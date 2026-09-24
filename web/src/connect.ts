/**
 * Handing a signed-in website session to the extension.
 *
 * The three FocusSpace clients cannot share a session: the API is cross-origin to all of them, so there
 * is no cookie to share, and an extension cannot read a website's localStorage. Signing in on
 * focusspace.xyz therefore does nothing for the extension by itself — something has to carry the
 * identity across deliberately, and this is it.
 *
 * The carrier is a one-time handoff code (server/auth/handoff.ts), sent over the same
 * `externally_connectable` channel the site already uses to read Spaces. Chrome verifies the sending
 * origin against the extension's manifest, so only focusspace.xyz can do this; the code is single-use,
 * dies in a minute, and is never written to storage on either side. The extension redeems it for a
 * session of its own.
 *
 * What is deliberately *not* done: this site never hands over its refresh token, and the extension never
 * reads anything out of a URL. A leaked handoff code is worth one minute and one redemption.
 */

const CONNECT_ORIGIN = 'extension';

interface ChromeRuntime {
  sendMessage: (id: string, message: unknown, cb: (response: unknown) => void) => void;
  lastError?: { message?: string };
}

const runtime = (): ChromeRuntime | null => (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime ?? null;

/** Written onto <html> by the extension's own content script on this origin (src/content/site-bridge.ts). */
export const installedExtensionId = (): string | null => document.documentElement.dataset.focusspaceExtension ?? null;

export type ConnectOutcome = 'connected' | 'no-extension' | 'failed';

/**
 * Sends one handoff code to the extension and reports what happened. Never throws: every failure here is
 * something the page has to explain, not something it should crash on.
 */
export function sendHandoffToExtension(code: string): Promise<ConnectOutcome> {
  return new Promise((resolve) => {
    const id = installedExtensionId();
    const rt = runtime();
    if (!id || !rt?.sendMessage) return resolve('no-extension');
    try {
      rt.sendMessage(id, { type: 'auth/handoff', code, origin: CONNECT_ORIGIN }, (response: unknown) => {
        if (rt.lastError) return resolve('failed');
        resolve((response as { ok?: boolean } | undefined)?.ok ? 'connected' : 'failed');
      });
    } catch {
      resolve('failed');
    }
  });
}

/**
 * Reads a `#handoff=` or `#error=` fragment left by the server's Google callback, and clears it from the
 * address bar immediately.
 *
 * The fragment is the right place for this: browsers never send it to a server, so it stays out of
 * access logs and `Referer` headers. It is removed with `replaceState` so it cannot be re-read, shared
 * or restored by the back button — belt and braces over the code being single-use anyway.
 */
export function takeAuthFragment(): { handoff?: string; error?: string } {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const handoff = params.get('handoff') ?? undefined;
  const error = params.get('error') ?? undefined;
  if (!handoff && !error) return {};
  history.replaceState(null, '', location.pathname + location.search);
  return { handoff, error };
}

/** The server's fragment codes, in words. Cancelling is an ordinary choice, not an error to apologise for. */
export const AUTH_FRAGMENT_MESSAGE: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_unavailable: 'Google sign-in is not available on this build yet. Use your email address instead.',
  google_state: 'That Google sign-in took too long. Try again.',
  google_failed: 'Google could not complete the sign-in. Try again, or use your email address.',
};
