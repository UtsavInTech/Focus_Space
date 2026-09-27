import { getItem } from '@/storage/storage';
import { apiBaseUrl, status as authStatus } from './auth';
import { installId } from './install-id';

/**
 * "This install was used today" — at most once a day, and only when FocusSpace is actually used on
 * YouTube. It is how FocusSpace knows how many people use it and whether they come back
 * (server/usage/activity.ts), and it carries nothing else: the random install id (stored on the server
 * only as a salted hash) and whether you are signed in. Off in Settings → Your data.
 */

const KEY = 'activityDay';

export async function markActive(): Promise<void> {
  const { shareUsageCounts } = await getItem('settings');
  if (!shareUsageCounts) return;
  const today = new Date().toISOString().slice(0, 10);
  // Once a day per browser session is plenty; the server counts an install once a day whatever happens.
  if ((await chrome.storage.session.get(KEY))[KEY] === today) return;
  const base = await apiBaseUrl();
  if (!base) return;
  const [{ accessToken }, id] = await Promise.all([authStatus(), installId()]);
  try {
    const res = await fetch(`${base}/v1/activity`, {
      method: 'POST',
      headers: { 'X-FocusSpace-Install': id, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });
    if (res.ok) await chrome.storage.session.set({ [KEY]: today });
  } catch {
    // Offline: tomorrow's visit counts; nothing depends on this.
  }
}
