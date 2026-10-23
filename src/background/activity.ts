import { getItem } from '@/storage/storage';
import { recentIssues } from '@/content/youtube/health';
import { apiBaseUrl, status as authStatus } from './auth';
import { installId } from './install-id';

/**
 * "This install was used today" — at most once a day, and only when FocusSpace is actually used on
 * YouTube. It is how FocusSpace knows how many people use it and whether they come back
 * (server/usage/activity.ts), and it carries nothing else: the random install id (stored on the server
 * only as a salted hash), whether you are signed in, and the names of any FocusSpace features a YouTube
 * change broke that day ("home", "watch-rail"). Off in Settings → Your data.
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
  const [{ accessToken }, id, health] = await Promise.all([authStatus(), installId(), getItem('health')]);
  // Which FocusSpace features YouTube broke today, by name only (content/youtube/health.ts), so a
  // YouTube change is noticed by the people who can fix it. Empty almost every day.
  const layoutIssues = recentIssues(health);
  try {
    const res = await fetch(`${base}/v1/activity`, {
      method: 'POST',
      headers: { 'X-FocusSpace-Install': id, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ layoutIssues }),
    });
    if (res.ok) await chrome.storage.session.set({ [KEY]: today });
  } catch {
    // Offline: tomorrow's visit counts; nothing depends on this.
  }
}
