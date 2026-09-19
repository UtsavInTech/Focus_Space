import { listen } from '@/messaging/runtime';
import { getItem, subscribe, updateItem } from '@/storage/storage';
import { toggleFocus } from '@/modes/service';
import { addChannel, syncLibrary } from './library-sync';
import { importSubscriptions } from './subscriptions';
import { refreshSessionState, registerSessionNotificationHandlers, SESSION_END_ALARM } from './session-watch';
import { startRelevanceWarmer, viewFor } from './relevance-warmer';
import { startPreferenceWarmer } from './preference-warmer';
import { backgroundYouTube } from './youtube';
import { aiService, resolveProviders, usageLog } from './ai';
import { generateNoteWithProvider } from '@/learning/ai/notes-integration';
import { deleteNote, listNotes, saveNote } from '@/storage/notes-store';
import * as auth from './auth';
import * as usage from './usage';
import * as spaces from './spaces';
import { SITE_URL, siteUrl } from '@/config';
import { registerExternalMessaging } from './external';
import { migrate } from './migrate';
import { resolveClaim, startOwnership } from './ownership';

const TICK_ALARM = 'fs-tick';
const SYNC_ALARM = 'fs-library-sync';
const YOUTUBE = 'https://www.youtube.com/';

async function ensureAlarms() {
  if (!(await chrome.alarms.get(TICK_ALARM))) await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 5 });
  if (!(await chrome.alarms.get(SYNC_ALARM))) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 360, delayInMinutes: 5 });
}

async function openDashboard(route = '') {
  const base = chrome.runtime.getURL('dashboard.html');
  const url = route ? `${base}#${route.startsWith('/') ? route : `/${route}`}` : base;
  const [existing] = await chrome.tabs.query({ url: `${base}*` });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { url, active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

/**
 * Open the public site, reusing a FocusSpace tab if one is already open — the
 * same courtesy `openDashboard` already extends, so clicking the launcher
 * twice does not leave two tabs behind.
 */
async function openSite(path = '/') {
  const url = siteUrl(path);
  const [existing] = await chrome.tabs.query({ url: `${SITE_URL}/*` });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { url, active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

/** Show a YouTube page, reusing a YouTube tab in the current window instead of opening another. */
async function openYouTube(url = YOUTUBE) {
  const [inWindow] = await chrome.tabs.query({ url: `${YOUTUBE}*`, currentWindow: true });
  const [anywhere] = inWindow ? [inWindow] : await chrome.tabs.query({ url: `${YOUTUBE}*` });
  if (anywhere?.id !== undefined) {
    await chrome.tabs.update(anywhere.id, { active: true, ...(anywhere.url === url ? {} : { url }) });
    if (anywhere.windowId !== undefined) await chrome.windows.update(anywhere.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrate();
  await ensureAlarms();
  await refreshSessionState();
  // First run happens on YouTube itself ("What do you want to focus on?").
  if (details.reason === 'install') await openYouTube();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  await refreshSessionState();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TICK_ALARM || alarm.name === SESSION_END_ALARM) await refreshSessionState();
  if (alarm.name === SYNC_ALARM) {
    const [settings, channels] = await Promise.all([getItem('settings'), getItem('channels')]);
    if (settings.autoSyncSubscriptions && Object.keys(channels).length) await syncLibrary();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-focus') await toggleFocus();
});

registerExternalMessaging();
// Before anything reads user data: the data in use must belong to whoever is signed in. A switch clears
// what the worker holds in memory from the previous owner, so no answer or usage line crosses over.
void migrate().then(() =>
  startOwnership({
    onSwitch: () => {
      aiService.clear();
      usageLog.clear();
    },
  }),
);
subscribe(['session', 'settings'], () => void refreshSessionState());
registerSessionNotificationHandlers();
startRelevanceWarmer();
startPreferenceWarmer();

// A previous worker instance may have been terminated mid-sync.
void updateItem('sync', (s) => (s.status !== 'idle' ? { ...s, status: 'idle', progress: null } : s));

listen({
  'subscriptions/import': () => importSubscriptions(),
  'library/sync': ({ force }) => syncLibrary(!!force),
  'library/view': ({ modeId }) => viewFor(modeId),
  'channel/add': ({ input }) => addChannel(input),
  'youtube/search-channels': async ({ query }) => {
    try {
      return { ok: true, channels: await backgroundYouTube.searchChannels(query) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Channel search failed.' };
    }
  },
  'youtube/open': async ({ url }) => {
    await openYouTube(url);
    return { ok: true };
  },
  'ai/status': () => aiService.status(),
  'ai/run': (request) => aiService.run(request),
  'notes/generate': async ({ inputs }) => generateNoteWithProvider(inputs, await resolveProviders(), usageLog.sink),
  'notes/save': ({ note }) => saveNote(note),
  'notes/list': ({ videoId }) => listNotes(videoId),
  'notes/delete': async ({ videoId, id }) => {
    await deleteNote(videoId, id);
    return { ok: true };
  },
  'chat/send': (request) => aiService.chat(request),
  'dashboard/open': async ({ route }) => {
    await openDashboard(route);
    return { ok: true };
  },
  'site/open': async ({ path }) => {
    await openSite(path);
    return { ok: true };
  },
  'auth/status': () => auth.status(),
  'auth/login': ({ email, password }) => auth.login(email, password),
  'auth/logout': () => auth.logout(),
  'account/claim': ({ keep }) => resolveClaim(keep),
  'auth/signup-start': ({ email }) => auth.startEmailSignup(email),
  'auth/signup-verify': ({ email, code }) => auth.verifyEmailSignup(email, code),
  'auth/signup-complete': ({ ticket, password }) => auth.completeEmailSignup(ticket, password),
  'auth/phone-start': ({ phone }) => auth.startPhoneSignIn(phone),
  'auth/phone-verify': ({ phone, code }) => auth.verifyPhoneSignIn(phone, code),
  'usage/status': () => usage.status(),
  'spaces/allowance': () => spaces.allowance(),
  'spaces/authorize': ({ spaceId, name }) => spaces.authorize(spaceId, name),
  'spaces/release': ({ spaceId }) => spaces.release(spaceId),
});
