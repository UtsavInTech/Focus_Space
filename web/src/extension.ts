import { useCallback, useEffect, useState } from 'react';

/**
 * Talking to the FocusSpace extension from the website.
 *
 * Your spaces, channels and settings live in the extension's own storage and
 * have never been uploaded anywhere. So the site asks the extension for them
 * directly: `site.js` (a content script on this origin) writes the extension's
 * id onto `<html>`, and `chrome.runtime.sendMessage(id, …)` — available to
 * pages listed in the manifest's `externally_connectable` — does the rest.
 *
 * The honest limit of this design: it only works in a browser where the
 * extension is installed. Everywhere else the page says so rather than
 * pretending to have no spaces.
 */

export interface ExtensionMode {
  id: string;
  name: string;
  icon: string;
  kind: string;
  topics: { id: string; name: string }[];
}

export interface ExtensionChannel {
  id: string;
  title: string;
  source: string;
}

export interface ExtensionState {
  version: number;
  focusEnabled: boolean;
  activeModeId: string | null;
  modes: ExtensionMode[];
  channels: ExtensionChannel[];
  settings: { theme: string; density: string; language: string; autoSyncSubscriptions: boolean };
}

type Request =
  | { type: 'ping' }
  | { type: 'state' }
  | { type: 'settings/update'; patch: Record<string, unknown> }
  | { type: 'focus/set'; enabled: boolean }
  | { type: 'space/select'; modeId: string }
  | { type: 'space/create'; name: string }
  | { type: 'space/delete'; modeId: string }
  | { type: 'home/open' };

interface ChromeRuntime {
  sendMessage: (id: string, message: unknown, cb: (response: unknown) => void) => void;
  lastError?: { message?: string };
}

const runtime = (): ChromeRuntime | null => (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime ?? null;

const extensionId = (): string | null => document.documentElement.dataset.focusspaceExtension ?? null;

/** Resolves with the extension's reply, or rejects with a message worth showing. */
function send<T>(request: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = extensionId();
    const rt = runtime();
    if (!id || !rt?.sendMessage) {
      reject(new Error('FocusSpace is not installed in this browser.'));
      return;
    }
    rt.sendMessage(id, request, (response: unknown) => {
      // Chrome reports a dead/updating extension here rather than throwing.
      if (rt.lastError) {
        reject(new Error('FocusSpace did not respond. Try reloading the extension.'));
        return;
      }
      const result = response as { ok?: boolean; data?: T; error?: string } | undefined;
      if (!result?.ok) {
        reject(new Error(result?.error ?? 'FocusSpace could not complete that.'));
        return;
      }
      resolve(result.data as T);
    });
  });
}

export type ExtensionStatus = 'checking' | 'connected' | 'missing';

export interface ExtensionLink {
  status: ExtensionStatus;
  state: ExtensionState | null;
  error: string | null;
  refresh: () => Promise<void>;
  setFocus: (enabled: boolean) => Promise<void>;
  selectSpace: (modeId: string) => Promise<void>;
  createSpace: (name: string) => Promise<void>;
  deleteSpace: (modeId: string) => Promise<void>;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
  /** Opens FocusSpace's own Home in the extension. */
  openHome: () => Promise<void>;
}

export function useExtension(): ExtensionLink {
  const [status, setStatus] = useState<ExtensionStatus>('checking');
  const [state, setState] = useState<ExtensionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await send<ExtensionState>({ type: 'state' }));
      setStatus('connected');
      setError(null);
    } catch {
      setStatus('missing');
    }
  }, []);

  useEffect(() => {
    // The content script may not have run yet when React mounts, so listen as
    // well as look — otherwise a fast page load races the extension and the
    // page wrongly decides it is not installed.
    if (extensionId()) void load();
    const onReady = () => void load();
    window.addEventListener('focusspace:extension', onReady);
    // A short backstop for the case where neither fired (e.g. bfcache restore).
    const timer = window.setTimeout(() => setStatus((s) => (s === 'checking' ? 'missing' : s)), 1200);
    return () => {
      window.removeEventListener('focusspace:extension', onReady);
      window.clearTimeout(timer);
    };
  }, [load]);

  /** Every mutation returns the new state, so the page never re-reads or guesses. */
  const mutate = useCallback(async (request: Request) => {
    setError(null);
    try {
      setState(await send<ExtensionState>(request));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }, []);

  return {
    status,
    state,
    error,
    refresh: load,
    setFocus: (enabled) => mutate({ type: 'focus/set', enabled }),
    selectSpace: (modeId) => mutate({ type: 'space/select', modeId }),
    createSpace: (name) => mutate({ type: 'space/create', name }),
    deleteSpace: (modeId) => mutate({ type: 'space/delete', modeId }),
    updateSettings: (patch) => mutate({ type: 'settings/update', patch }),
    openHome: () => send<unknown>({ type: 'home/open' }).then(() => undefined),
  };
}
