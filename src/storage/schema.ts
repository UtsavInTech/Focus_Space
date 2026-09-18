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

export const SCHEMA_VERSION = 4;

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
  activeModeId: 'dsa',
  defaultModeId: 'dsa',
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

export function defaultsFor<K extends StorageKey>(key: K): StorageSchema[K] {
  const defaults: StorageSchema = {
    schemaVersion: SCHEMA_VERSION,
    settings: DEFAULT_SETTINGS,
    modes: DEFAULT_MODES,
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
  };
  return structuredClone(defaults[key]);
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
