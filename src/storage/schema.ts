import { CHAT_VERSION, type ChatSession } from '@/types/chat';
import type {
  Channel,
  FilterConfig,
  FilterPrefs,
  LearningMode,
  LearningSession,
  Settings,
  SyncState,
  TopicPlaylists,
  UiState,
  UsageLog,
  VideoRecord,
  WatchEntry,
} from '@/types/domain';
import { DEFAULT_MODES } from '@/modes/templates';
import { iconForEmoji, isSpaceIcon } from '@/modes/icons';
import type { ModeCacheSnapshot } from '@/learning/classifier';
import type { FeedViewStore } from '@/learning/feed-view';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { CLASSIFIER_VERSION } from '@/learning/relevance/lexicon';
import { KNOWLEDGE_VERSION, type KnowledgeMap } from '@/learning/knowledge/types';
import { PREFERENCE_VERSION, type PreferenceProfile } from '@/types/preferences';
import { NOTES_VERSION, type SavedNote } from '@/types/notes';
import type { AuthState } from '@/types/auth';

export const SCHEMA_VERSION = 5;

/** Knowledge maps per video, rebuilt when their input signature or KNOWLEDGE_VERSION changes. */
export interface KnowledgeCacheStore {
  version: number;
  entries: Record<string, { signature: string; savedAt: number; map: KnowledgeMap }>;
}

/** Behavioral creator/topic affinity per space, rebuilt when PREFERENCE_VERSION changes. See docs/V5_CONTRACT.md §D. */
export interface PreferenceStore {
  version: number;
  modes: Record<string, PreferenceProfile>;
}

/** Saved notes/mind-maps, keyed by video id, most recent first. See docs/V5_CONTRACT.md §E. */
export interface NotesStore {
  version: number;
  byVideo: Record<string, SavedNote[]>;
}

export interface DiscoveryCacheEntry {
  fetchedAt: number;
  videos: YtVideo[];
  continuation: string | null;
}

/** Every key FocusSpace keeps in chrome.storage.local, with its type. */
export interface StorageSchema {
  schemaVersion: number;
  settings: Settings;
  modes: LearningMode[];
  session: LearningSession | null;
  sessionHistory: LearningSession[];
  usage: UsageLog;
  watchHistory: WatchEntry[];
  topicPlaylists: TopicPlaylists;
  channels: Record<string, Channel>;
  videos: Record<string, VideoRecord>;
  sync: SyncState;
  ui: UiState;
  /** Persisted channel-independent classifications, per mode (written by the background warmer). */
  relevanceCache: RelevanceCacheStore;
  /** Small, ready-to-render feeds per space (written by the background warmer, read by YouTube pages). */
  feedViews: FeedViewStore;
  /** YouTube discovery results by query, with a TTL. */
  discoveryCache: Record<string, DiscoveryCacheEntry>;
  /** Video Knowledge Maps (watch page). */
  knowledgeMaps: KnowledgeCacheStore;
  /** Behavioral creator/topic affinity per space, derived from watchHistory + topicPlaylists (written by the background preference warmer). */
  preferenceProfiles: PreferenceStore;
  /** Saved notes/mind-maps (watch page "Make Notes"). */
  notes: NotesStore;
  /** FocusSpace account/session state (Layer 2B) — see src/types/auth.ts. Anonymous by default. */
  auth: AuthState;
  /** AI conversations ("Ask AI" on a video, and the FocusSpace AI bubble), newest first — for the Library. */
  chatSessions: ChatStore;
  /**
   * A random id for this install, sent only with signed-out AI requests to FocusSpace's own server, so the
   * free daily allowance is per install rather than per network (server/usage/service.ts). Device data:
   * it belongs to no account and never changes owner.
   */
  installId: string;
  /** Whose data the other keys hold right now — see storage/ownership.ts. */
  ownership: Ownership;
  /** A signed-in learner who has not yet said whether this browser's guest data should become theirs. */
  pendingClaim: PendingClaim | null;
  /** The first-run guide on YouTube (content/ui/WelcomeGuide.tsx). Device data: it must survive the sign-in it asks for. */
  welcome: WelcomeState;
}

/**
 * `active` is switched on once, when the extension is installed, and off when the guide is finished or
 * closed — so an update never shows it to someone who has been using FocusSpace for months. Which step
 * the guide is on is not stored: it is read off the account and the Spaces, so it can never disagree
 * with them.
 */
export interface WelcomeState {
  active: boolean;
  /** "Maybe later" on the sign-in step. */
  signInSkipped: boolean;
  /** The setup conversation (content/ui/SetupChat.tsx), kept so a refresh or a new tab picks it up where it was. */
  chat: WelcomeChat | null;
}

export interface WelcomeChat {
  phase: 'subjects' | 'channels' | 'done';
  /** Spaces the conversation created, and the creators added to each. */
  made: { id: string; name: string; channels: string[] }[];
  /** Ids of Spaces still to be asked about favourite creators; the first is the open question. */
  pending: string[];
  lines: WelcomeLine[];
  /** They moved on to the last step. */
  finished: boolean;
}

export interface WelcomeLine {
  id: number;
  from: 'bot' | 'you';
  text: string;
  /** "Added Telusko to DSA" can be taken back with one tap. */
  undo?: { modeId: string; channels: { id: string; title: string; handle?: string }[] };
}

/** Only the recent part of a conversation is kept; it is a guide, not a transcript. */
export const WELCOME_CHAT_MAX_LINES = 40;

function normalizeWelcomeChat(raw: unknown): WelcomeChat | null {
  const c = raw as Partial<WelcomeChat> | null | undefined;
  if (!c || typeof c !== 'object' || !['subjects', 'channels', 'done'].includes(c.phase as string)) return null;
  const made = Array.isArray(c.made)
    ? c.made.filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string').map((m) => ({ id: m.id, name: m.name, channels: Array.isArray(m.channels) ? m.channels.filter((x) => typeof x === 'string') : [] }))
    : [];
  const lines = Array.isArray(c.lines)
    ? c.lines
        .filter((l) => l && typeof l.id === 'number' && (l.from === 'bot' || l.from === 'you') && typeof l.text === 'string')
        .map((l) => {
          const u = l.undo;
          const undo = u && typeof u.modeId === 'string' && Array.isArray(u.channels) ? { modeId: u.modeId, channels: u.channels.filter((ch) => ch && typeof ch.id === 'string' && typeof ch.title === 'string') } : undefined;
          return { id: l.id, from: l.from, text: l.text, ...(undo?.channels.length ? { undo } : {}) };
        })
        .slice(-WELCOME_CHAT_MAX_LINES)
    : [];
  const ids = new Set(made.map((m) => m.id));
  // Older saves kept a position in `made` instead of a queue.
  const legacy = (c as { channelIndex?: unknown }).channelIndex;
  const pending = Array.isArray(c.pending) ? c.pending.filter((id) => typeof id === 'string' && ids.has(id)) : typeof legacy === 'number' ? made.slice(legacy).map((m) => m.id) : [];
  // A conversation waiting on a creator question for no Space moves on to the report.
  const phase = c.phase === 'channels' && !pending.length ? 'done' : c.phase!;
  return { phase, made, pending, lines, finished: c.finished === true };
}

/**
 * `owner` is `'guest'` or an account's user id. `epoch` changes whenever the data in the other keys is
 * replaced by someone else's, so a page still showing the previous owner can tell its view is stale.
 */
export interface ChatStore {
  version: number;
  sessions: ChatSession[];
}

export interface Ownership {
  owner: string;
  epoch: number;
}

export interface PendingClaim {
  userId: string;
  email: string | null;
}

export interface RelevanceCacheStore {
  version: number;
  modes: Record<string, ModeCacheSnapshot>;
}

export type StorageKey = keyof StorageSchema;

export const FILTER_PRESETS: Record<Exclude<FilterConfig['intensity'], 'custom'>, FilterPrefs> = {
  gentle: {
    hideShorts: true,
    replaceHomeFeed: true,
    relatedVideos: 'relevant',
    hideEndScreens: false,
    hideExplore: false,
    hideComments: false,
    hideNotifications: false,
    searchResults: 'dim',
  },
  balanced: {
    hideShorts: true,
    replaceHomeFeed: true,
    relatedVideos: 'relevant',
    hideEndScreens: true,
    hideExplore: true,
    hideComments: false,
    hideNotifications: false,
    searchResults: 'focus',
  },
  strict: {
    hideShorts: true,
    replaceHomeFeed: true,
    relatedVideos: 'hide',
    hideEndScreens: true,
    hideExplore: true,
    hideComments: true,
    hideNotifications: true,
    searchResults: 'focus',
  },
};

export const DEFAULT_SETTINGS: Settings = {
  focusEnabled: true,
  activeModeId: null,
  defaultModeId: null,
  focus: { intensity: 'balanced', filters: { ...FILTER_PRESETS.balanced } },
  offTrackNudges: true,
  trackWatchHistory: true,
  autoSyncSubscriptions: true,
  theme: 'system',
  density: 'comfortable',
  displayName: '',
  onboarded: false,
  debugRelevance: false,
  ai: { provider: 'auto', endpointUrl: '', language: 'en' },
  api: { baseUrl: '' },
  defaultSessionMinutes: 60,
  askIntentOnModeSwitch: false,
  notifyOnSessionEnd: true,
};

export const DEFAULT_SYNC: SyncState = {
  status: 'idle',
  progress: null,
  lastImportAt: null,
  lastImportCount: null,
  lastSyncAt: null,
  lastError: null,
};

function allDefaults(): StorageSchema {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: DEFAULT_SETTINGS,
    // No Spaces until the learner picks one: the templates are suggestions (modes/templates.ts), and a
    // Space the learner never chose must not count against an allowance they never used.
    modes: [],
    session: null,
    sessionHistory: [],
    usage: {},
    watchHistory: [],
    topicPlaylists: {},
    channels: {},
    videos: {},
    sync: DEFAULT_SYNC,
    ui: { dismissedLimitKey: null },
    relevanceCache: { version: CLASSIFIER_VERSION, modes: {} },
    feedViews: { version: CLASSIFIER_VERSION, channelIds: [], modes: {} },
    discoveryCache: {},
    knowledgeMaps: { version: KNOWLEDGE_VERSION, entries: {} },
    preferenceProfiles: { version: PREFERENCE_VERSION, modes: {} },
    notes: { version: NOTES_VERSION, byVideo: {} },
    auth: { user: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null },
    chatSessions: { version: CHAT_VERSION, sessions: [] },
    installId: '',
    ownership: { owner: 'guest', epoch: 0 },
    pendingClaim: null,
    welcome: { active: false, signInSkipped: false, chat: null },
  };
}

/**
 * Every storage key, read off the defaults so a new key cannot be forgotten by code that iterates them.
 * A function, not a constant: the defaults use version numbers from modules that import this one, and
 * building them while those are still loading kills the content script at startup.
 */
export const storageKeys = (): StorageKey[] => Object.keys(allDefaults()) as StorageKey[];

export function defaultsFor<K extends StorageKey>(key: K): StorageSchema[K] {
  return structuredClone(allDefaults()[key]);
}

const SEARCH_POLICIES = ['show', 'dim', 'focus'];

/**
 * Normalise a stored value against the current schema so older or partial data
 * never crashes the UI (e.g. a filter flag added in a later version).
 */
export function normalize<K extends StorageKey>(key: K, raw: unknown): StorageSchema[K] {
  if (raw === undefined || raw === null) return defaultsFor(key);
  switch (key) {
    case 'settings': {
      const s = raw as Partial<Settings>;
      const merged: Settings = { ...DEFAULT_SETTINGS, ...s };
      merged.focus = normalizeFilterConfig(s.focus) ?? structuredClone(DEFAULT_SETTINGS.focus);
      merged.ai = { ...DEFAULT_SETTINGS.ai, ...(s.ai ?? {}) };
      if (!['auto', 'chrome', 'endpoint', 'off'].includes(merged.ai.provider)) merged.ai.provider = 'auto';
      if (!['en', 'hi', 'hinglish'].includes(merged.ai.language)) merged.ai.language = 'en';
      merged.api = { ...DEFAULT_SETTINGS.api, ...(s.api ?? {}) };
      return merged as StorageSchema[K];
    }
    case 'modes': {
      if (!Array.isArray(raw)) return defaultsFor(key);
      return raw.map((m: Partial<LearningMode>) => {
        // Built-in modes the user never edited follow the latest template.
        const template = m.updatedAt === 0 ? DEFAULT_MODES.find((t) => t.id === m.id) : undefined;
        if (template) return structuredClone(template);
        return {
          description: '',
          topics: [],
          keywords: [],
          blockedKeywords: [],
          allowedChannels: [],
          blockedChannels: [],
          dailyLimitMinutes: null,
          createdAt: 0,
          updatedAt: 0,
          emoji: '',
          searchHint: '',
          kind: 'learning',
          discovery: true,
          ...m,
          icon: isSpaceIcon(m.icon) ? m.icon : iconForEmoji(m.emoji),
          filterOverride: normalizeFilterConfig(m.filterOverride),
        } as LearningMode;
      }) as StorageSchema[K];
    }
    case 'watchHistory': {
      if (!Array.isArray(raw)) return defaultsFor(key);
      return raw.map((e: Partial<WatchEntry>) => ({
        channelTitle: '',
        channelId: null,
        topicId: null,
        progress: 0,
        durationSec: null,
        playlistId: null,
        playlistIndex: null,
        ...e,
      })) as StorageSchema[K];
    }
    case 'relevanceCache': {
      const store = raw as Partial<RelevanceCacheStore>;
      return (store.version === CLASSIFIER_VERSION && store.modes ? store : defaultsFor(key)) as StorageSchema[K];
    }
    case 'feedViews': {
      const store = raw as Partial<FeedViewStore>;
      return (store.version === CLASSIFIER_VERSION && store.modes ? store : defaultsFor(key)) as StorageSchema[K];
    }
    case 'knowledgeMaps': {
      const store = raw as Partial<KnowledgeCacheStore>;
      return (store.version === KNOWLEDGE_VERSION && store.entries ? store : defaultsFor(key)) as StorageSchema[K];
    }
    case 'preferenceProfiles': {
      const store = raw as Partial<PreferenceStore>;
      return (store.version === PREFERENCE_VERSION && store.modes ? store : defaultsFor(key)) as StorageSchema[K];
    }
    case 'notes': {
      const store = raw as Partial<NotesStore>;
      return (store.version === NOTES_VERSION && store.byVideo ? store : defaultsFor(key)) as StorageSchema[K];
    }
    case 'sync':
      return { ...DEFAULT_SYNC, ...(raw as Partial<SyncState>) } as StorageSchema[K];
    case 'auth': {
      const a = raw as Partial<AuthState>;
      // A user with no token pair (or vice versa) isn't a coherent logged-in state — treat it as anonymous
      // rather than trust a partially-written value (e.g. a crash mid-write).
      const coherent = !!a.user && typeof a.accessToken === 'string' && typeof a.refreshToken === 'string';
      return (coherent ? { user: a.user, accessToken: a.accessToken, accessTokenExpiresAt: a.accessTokenExpiresAt ?? null, refreshToken: a.refreshToken } : defaultsFor(key)) as StorageSchema[K];
    }
    case 'chatSessions': {
      const store = raw as Partial<ChatStore>;
      return (store.version === CHAT_VERSION && Array.isArray(store.sessions) ? store : defaultsFor(key)) as StorageSchema[K];
    }
    case 'ownership': {
      const o = raw as Partial<Ownership>;
      return (typeof o.owner === 'string' && o.owner && typeof o.epoch === 'number' ? { owner: o.owner, epoch: o.epoch } : defaultsFor(key)) as StorageSchema[K];
    }
    case 'pendingClaim': {
      const c = raw as Partial<PendingClaim>;
      return (typeof c.userId === 'string' && c.userId ? { userId: c.userId, email: typeof c.email === 'string' ? c.email : null } : null) as StorageSchema[K];
    }
    case 'welcome': {
      const w = raw as Partial<WelcomeState>;
      return { active: w.active === true, signInSkipped: w.signInSkipped === true, chat: normalizeWelcomeChat(w.chat) } as StorageSchema[K];
    }
    default:
      return raw as StorageSchema[K];
  }
}

function normalizeFilterConfig(raw: FilterConfig | null | undefined): FilterConfig | null {
  if (!raw) return null;
  const filters = { ...FILTER_PRESETS.balanced, ...(raw.filters ?? {}) };
  if (!SEARCH_POLICIES.includes(filters.searchResults)) filters.searchResults = 'focus';
  return { intensity: raw.intensity ?? 'balanced', filters };
}
