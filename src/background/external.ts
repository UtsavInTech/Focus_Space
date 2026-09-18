import type { LearningMode, Settings } from '@/types/domain';
import { getItem, updateItem } from '@/storage/storage';
import { addMode, deleteMode, selectMode, setFocusEnabled } from '@/modes/service';
import { inferModeIntent, modeFromSuggestion } from '@/modes/intent';

/**
 * The bridge between focusspace.app and the extension.
 *
 * Spaces, subscriptions and settings live in `chrome.storage.local` and have
 * never left the browser. Rather than reverse that by uploading them, the
 * website asks the extension for them directly over
 * `chrome.runtime.onMessageExternal`: the data stays local, the page renders
 * it live, and there is nothing new on the server to leak or to keep in sync.
 *
 * The cost of that choice, stated plainly: the account page can only show
 * spaces on a machine where the extension is installed. On a phone it shows
 * the account and the plan, and says why the rest is missing.
 *
 * Trust: `externally_connectable` in the manifest is the real boundary — only
 * the origins listed there can send anything at all. This module additionally
 * refuses to hand back anything not explicitly listed below, so widening the
 * manifest can never silently widen what a page can read.
 */

export type ExternalRequest =
  | { type: 'ping' }
  | { type: 'state' }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'focus/set'; enabled: boolean }
  | { type: 'space/select'; modeId: string }
  | { type: 'space/create'; name: string }
  | { type: 'space/delete'; modeId: string };

export interface ExternalChannel {
  id: string;
  title: string;
  source: string;
}

export interface ExternalState {
  version: number;
  focusEnabled: boolean;
  activeModeId: string | null;
  modes: { id: string; name: string; icon: string; kind: string; topics: { id: string; name: string }[] }[];
  channels: ExternalChannel[];
  settings: {
    theme: string;
    density: string;
    language: string;
    autoSyncSubscriptions: boolean;
  };
}

export type ExternalResponse = { ok: true; data?: unknown } | { ok: false; error: string };

/** Bumped when the shape below changes, so an older site build can tell. */
const STATE_VERSION = 1;

/**
 * Deliberately a hand-built projection, not the raw stored objects. The
 * website needs names and ids to render a list; it has no business receiving
 * watch history, per-video progress, cached relevance scores or channel
 * profiles, all of which sit in the same storage.
 */
async function readState(): Promise<ExternalState> {
  const [settings, modes, channels] = await Promise.all([getItem('settings'), getItem('modes'), getItem('channels')]);
  return {
    version: STATE_VERSION,
    focusEnabled: settings.focusEnabled,
    activeModeId: settings.activeModeId ?? null,
    modes: (modes as LearningMode[]).map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      kind: m.kind,
      topics: m.topics.map((t) => ({ id: t.id, name: t.name })),
    })),
    channels: Object.values(channels).map((c) => ({ id: c.id, title: c.title, source: c.source })),
    settings: {
      theme: settings.theme,
      density: settings.density,
      language: settings.ai.language,
      autoSyncSubscriptions: settings.autoSyncSubscriptions,
    },
  };
}

/** Only these settings are writable from the web. Everything else stays where it is edited. */
async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await updateItem('settings', (s) => ({
    ...s,
    ...(patch.theme ? { theme: patch.theme } : {}),
    ...(patch.density ? { density: patch.density } : {}),
    ...(typeof patch.autoSyncSubscriptions === 'boolean' ? { autoSyncSubscriptions: patch.autoSyncSubscriptions } : {}),
    ...(patch.ai?.language ? { ai: { ...s.ai, language: patch.ai.language } } : {}),
  }));
}

async function handle(request: ExternalRequest): Promise<ExternalResponse> {
  switch (request.type) {
    case 'ping':
      // How the site knows the extension exists at all, before it renders anything.
      return { ok: true, data: { version: STATE_VERSION } };
    case 'state':
      return { ok: true, data: await readState() };
    case 'settings/update':
      await updateSettings(request.patch);
      return { ok: true, data: await readState() };
    case 'focus/set':
      await setFocusEnabled(request.enabled);
      return { ok: true, data: await readState() };
    case 'space/select':
      await selectMode(request.modeId);
      return { ok: true, data: await readState() };
    case 'space/create': {
      const name = request.name.trim();
      if (!name) return { ok: false, error: 'A space needs a name.' };
      // The same intent inference the "New space" dialog uses, so a space made
      // from the website is identical to one made on YouTube — topics, keywords
      // and search context included, not a bare name.
      const suggestion = inferModeIntent(name);
      if (!suggestion) return { ok: false, error: `FocusSpace could not work out what "${name}" means. Try a subject, like "System design".` };
      const existing = await getItem('modes');
      // `addMode` asks the server for a space slot first, so the plan limit is
      // enforced here exactly as it is on YouTube rather than re-implemented.
      await addMode(modeFromSuggestion(suggestion, (existing as LearningMode[]).map((m) => m.id)));
      return { ok: true, data: await readState() };
    }
    case 'space/delete':
      await deleteMode(request.modeId);
      return { ok: true, data: await readState() };
    default:
      return { ok: false, error: 'Unknown request.' };
  }
}

export function registerExternalMessaging(): void {
  chrome.runtime.onMessageExternal.addListener((message: ExternalRequest, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    Promise.resolve()
      .then(() => handle(message))
      .then(sendResponse, (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' }));
    return true; // async response
  });
}
