/**
 * Sign-in started on YouTube ends on YouTube.
 *
 * Signing in happens on focusspace.xyz (web/src/connect.ts), in a tab of its own. When YouTube asked for
 * it, the learner was in the middle of something there — the first-run guide, most often — so once the
 * website has handed the session over, the website tab closes and the *same* YouTube tab comes back to
 * the front. No second YouTube tab, and no "you can close this tab now" left for them to do.
 *
 * The tab is remembered in `chrome.storage.session`: it is only meaningful until the browser closes, and
 * the service worker may be stopped between the click on YouTube and the sign-in finishing.
 */

const KEY = 'signInReturnTab';
const YOUTUBE = 'https://www.youtube.com/';
/** Long enough to read "Signed in — taking you back to YouTube". */
export const RETURN_DELAY_MS = 800;

/** Called when a page asks for the website's sign-in; only a YouTube tab is worth returning to. */
export async function rememberReturnTab(sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0 || !sender.url?.startsWith(YOUTUBE)) return;
  await chrome.storage.session.set({ [KEY]: tabId });
}

/**
 * After a successful handoff: says whether the learner is being taken back to YouTube, and if so does it
 * shortly after, closing the website tab that asked. `false` leaves the website page as it always was.
 */
export async function returnAfterSignIn(siteTabId: number | undefined): Promise<boolean> {
  const stored = (await chrome.storage.session.get(KEY))[KEY];
  await chrome.storage.session.remove(KEY);
  if (typeof stored !== 'number') return false;
  const tab = await chrome.tabs.get(stored).catch(() => null);
  if (!tab?.id) return false; // closed since: nothing to go back to

  setTimeout(() => {
    void (async () => {
      try {
        await chrome.tabs.update(stored, { active: true });
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        if (siteTabId !== undefined && siteTabId !== stored) await chrome.tabs.remove(siteTabId);
      } catch {
        // The learner closed one of the tabs in the meantime; the website page still says they are signed in.
      }
    })();
  }, RETURN_DELAY_MS);
  return true;
}
