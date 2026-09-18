import type { Channel } from '@/types/domain';
import type { ImportResult, SessionSubscriptionsResult } from '@/types/messages';
import { sendTabMessage } from '@/messaging/runtime';
import { updateItem } from '@/storage/storage';
import { pruneLibrary, syncLibrary } from './library-sync';

/**
 * Orchestrates "Import my subscriptions": asks a youtube.com content script
 * (which has the user's signed-in session) to read the subscription list,
 * then stores it and refreshes the library.
 */

const YT_MATCH = 'https://www.youtube.com/*';

async function ping(tabId: number): Promise<boolean> {
  try {
    const res = await sendTabMessage(tabId, 'content/ping', {});
    return !!res?.ok;
  } catch {
    return false;
  }
}

async function waitForContentScript(tabId: number, timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping(tabId)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function acquireYouTubeTab(): Promise<{ tabId: number; created: boolean } | null> {
  const tabs = await chrome.tabs.query({ url: YT_MATCH });
  for (const tab of tabs) {
    if (tab.id !== undefined && (await ping(tab.id))) return { tabId: tab.id, created: false };
  }
  // No usable YouTube tab: open one in the background, read, then close it.
  // (Home, not /feed/channels: signed-out users get redirected away from the latter.)
  const tab = await chrome.tabs.create({ url: 'https://www.youtube.com/', active: false });
  if (tab.id === undefined) return null;
  return (await waitForContentScript(tab.id)) ? { tabId: tab.id, created: true } : null;
}

let importing: Promise<ImportResult> | null = null;

export function importSubscriptions(): Promise<ImportResult> {
  importing ??= runImport().finally(() => {
    importing = null;
  });
  return importing;
}

async function runImport(): Promise<ImportResult> {
  await updateItem('sync', (s) => ({ ...s, status: 'importing', lastError: null }));
  let acquired: { tabId: number; created: boolean } | null = null;
  let result: SessionSubscriptionsResult;
  try {
    acquired = await acquireYouTubeTab();
    if (!acquired) {
      const error = 'Could not open YouTube to read your subscriptions.';
      await updateItem('sync', (s) => ({ ...s, status: 'idle', lastError: error }));
      return { ok: false, code: 'no-tab', error };
    }
    result = await sendTabMessage(acquired.tabId, 'content/read-subscriptions', {});
  } catch (err) {
    result = { ok: false, code: 'network', error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (acquired?.created) chrome.tabs.remove(acquired.tabId).catch(() => undefined);
  }

  if (!result.ok) {
    await updateItem('sync', (s) => ({ ...s, status: 'idle', lastError: result.ok ? null : result.error }));
    return result;
  }

  const now = Date.now();
  let added = 0;
  const importedIds = new Set(result.channels.map((c) => c.id));
  await updateItem('channels', (current) => {
    const next: Record<string, Channel> = { ...current };
    for (const c of result.channels) {
      const existing = next[c.id];
      if (!existing) added++;
      next[c.id] = {
        id: c.id,
        title: c.title,
        handle: c.handle ?? existing?.handle,
        thumbnail: c.thumbnail ?? existing?.thumbnail,
        source: existing?.source === 'manual' ? 'manual' : 'youtube-session',
        addedAt: existing?.addedAt ?? now,
        lastFetchedAt: existing?.lastFetchedAt ?? null,
        lastError: existing?.lastError ?? null,
        ignored: existing?.ignored ?? false,
      };
    }
    // Only when we saw the whole list do we treat missing channels as unsubscribed.
    if (result.complete) {
      for (const [id, ch] of Object.entries(next)) if (ch.source === 'youtube-session' && !importedIds.has(id)) delete next[id];
    }
    return next;
  });
  if (result.complete) await pruneLibrary();

  await updateItem('sync', (s) => ({ ...s, status: 'idle', lastImportAt: now, lastImportCount: result.channels.length, lastError: null }));
  void syncLibrary();
  return { ok: true, imported: result.channels.length, added, complete: result.complete };
}
