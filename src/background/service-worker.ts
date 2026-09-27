import { listen } from '@/messaging/runtime';
import { getItem, setItem, subscribe, updateItem } from '@/storage/storage';
import { toggleFocus } from '@/modes/service';
import { addChannel, syncLibrary } from './library-sync';
import { importSubscriptions } from './subscriptions';
import { refreshSessionState, registerSessionNotificationHandlers, SESSION_END_ALARM } from './session-watch';
import { startRelevanceWarmer, viewFor } from './relevance-warmer';
import { startPreferenceWarmer } from './preference-warmer';
import { backgroundYouTube } from './youtube';
import { aiService, resolveProviders, usageLog } from './ai';
import { videoOutline } from './outline';
import { generateNoteWithProvider } from '@/learning/ai/notes-integration';
import { countNotes, deleteNote, listNotes, saveNote } from '@/storage/notes-store';
import { currentPlanId, planById } from '@/billing/plans';
import * as auth from './auth';
import * as usage from './usage';
import * as spaces from './spaces';
import * as account from './account';
import { SITE_URL, siteUrl } from '@/config';
import { registerExternalMessaging } from './external';
import { rememberReturnTab } from './sign-in-return';
import * as setupAssistant from './setup-assistant';
import { markActive } from './activity';
import { migrate } from './migrate';
import { resolveClaim, startOwnership } from './ownership';
import { canSave, SAVE_NEEDS_ACCOUNT } from '@/ui/account/save-gate';

const TICK_ALARM = 'fs-tick';
const SYNC_ALARM = 'fs-library-sync';
const YOUTUBE = 'https://www.youtube.com/';

async function ensureAlarms() {
  if (!(await chrome.alarms.get(TICK_ALARM))) await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 5 });
  if (!(await chrome.alarms.get(SYNC_ALARM))) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 360, delayInMinutes: 5 });
}

/**
 * Shows a FocusSpace page, reusing the one already open instead of stacking up tabs.
 *
 * The open tab is found with `runtime.getContexts`, not `tabs.query({url})`: reading tab URLs needs the
 * "tabs" permission, which asks every learner for their browsing history at install. An extension can
 * always see its own pages, so this needs no permission at all.
 */
async function openDashboard(route = '') {
  const base = chrome.runtime.getURL('dashboard.html');
  const url = route ? `${base}#${route.startsWith('/') ? route : `/${route}`}` : base;
  const open = await findOwnTab(base);
  if (open !== null) {
    const tab = await chrome.tabs.update(open, { url, active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

/** The tab id of one of this extension's own pages, if any is open. */
async function findOwnTab(base: string): Promise<number | null> {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
    const found = contexts.find((c) => c.documentUrl?.startsWith(base) && c.tabId !== undefined && c.tabId >= 0);
    if (found?.tabId !== undefined) return found.tabId;
  } catch {
    // getContexts needs Chrome 116; older browsers fall through to the query below.
  }
  const [existing] = await chrome.tabs.query({ url: `${base}*` });
  return existing?.id ?? null;
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
  // First run happens on YouTube itself ("What do you want to focus on?"), with the welcome guide beside it.
  if (details.reason === 'install') {
    await setItem('welcome', { active: true, signInSkipped: false, chat: null, talked: false, oneByOne: false, spacesSkipped: false });
    await openYouTube();
  }
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
    try {
      await openYouTube(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not open YouTube.' };
    }
  },
  'ai/status': () => aiService.status(),
  'ai/run': (request) => aiService.run(request),
  'notes/generate': async ({ inputs }) => generateNoteWithProvider(inputs, await resolveProviders(), usageLog.sink),
  // Saving is for signed-in learners (src/ui/account/save-gate.ts); the panels already say so, this keeps it true.
  'notes/save': async ({ note }) => {
    if (!canSave(await getItem('auth'))) throw new Error(SAVE_NEEDS_ACCOUNT);
    // The plan's Library size (Free 5, Basic 15). If the plan can't be read right now, saving still works.
    const status = await usage.status().catch(() => null);
    const plan = status ? planById(currentPlanId(status.plan)) : null;
    const limit = plan?.limits.savedNotes ?? null;
    if (plan && limit !== null && (await countNotes()) >= limit) {
      throw new Error(`Your ${plan.name} plan keeps ${limit} notes and mind maps. Delete one you no longer need, or ${plan.id === 'free' ? 'get Basic for 15, ₹99 for life' : 'go Plus for unlimited'}.`);
    }
    return saveNote(note);
  },
  'notes/list': ({ videoId }) => listNotes(videoId),
  'notes/delete': async ({ videoId, id }) => {
    await deleteNote(videoId, id);
    return { ok: true };
  },
  'chat/send': (request) => aiService.chat(request),
  'outline/get': (request) => videoOutline(request),
  'dashboard/open': async ({ route }) => {
    try {
      await openDashboard(route);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not open the dashboard.' };
    }
  },
  'site/open': async ({ path }, sender) => {
    try {
      // Sign-in asked for from YouTube comes back to that YouTube tab when it is done (./sign-in-return.ts).
      if (path?.startsWith('/connect')) await rememberReturnTab(sender);
      await openSite(path);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not open FocusSpace.' };
    }
  },
  'activity/ping': () => markActive(),
  'setup/understand': (request) => setupAssistant.understand(request),
  'voice/transcribe': ({ audio, mime, hint, purpose }) => setupAssistant.transcribeSpeech(audio, mime, hint, purpose),
  'voice/speak': ({ text, purpose }) => setupAssistant.speakText(text, purpose),
  'auth/status': () => auth.status(),
  'auth/login': ({ email, password }) => auth.login(email, password),
  'auth/logout': () => auth.logout(),
  'account/claim': ({ keep }) => resolveClaim(keep),
  'account/profile': () => account.profile(),
  'account/profile-update': (patch) => account.updateProfile(patch),
  'account/payments': () => account.payments(),
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
