/**
 * FocusSpace domain model.
 *
 * Everything here is persisted locally in chrome.storage.local (see src/storage).
 * Keep these types serialisable (no class instances, no functions, no Dates).
 */

import type { NoteLanguage } from './notes';

export type ID = string;

/* ------------------------------------------------------------------ Spaces */

export interface Topic {
  id: ID;
  name: string;
  /** Extra phrases that signal this topic. The topic name itself always counts. */
  keywords: string[];
}

export interface ChannelRef {
  id: string; // YouTube channel id (UC…) when known
  title: string;
  handle?: string; // "@handle" when known
}

export type RelatedVideosPolicy = 'show' | 'relevant' | 'hide';
/** show: untouched · dim: dim unrelated · focus: hide unrelated, dim weak matches */
export type SearchResultsPolicy = 'show' | 'dim' | 'focus';
export type FocusIntensity = 'gentle' | 'balanced' | 'strict' | 'custom';

/** Distraction controls. Every flag here is enforced by src/content/youtube/filters. */
export interface FilterPrefs {
  hideShorts: boolean;
  replaceHomeFeed: boolean;
  relatedVideos: RelatedVideosPolicy;
  hideEndScreens: boolean;
  hideExplore: boolean;
  hideComments: boolean;
  hideNotifications: boolean;
  searchResults: SearchResultsPolicy;
}

export interface FilterConfig {
  intensity: FocusIntensity;
  filters: FilterPrefs;
}

/**
 * What a space is for. It changes how videos are judged: "learning" rewards
 * teaching cues (tutorial, lecture…), "media" rewards music/video cues
 * (official video, album…), "general" sits in between.
 */
export type SpaceKind = 'learning' | 'media' | 'general';

/** A "mode" in code, a "space" in the UI: an intention the user brings to YouTube. */
export interface LearningMode {
  id: ID;
  name: string;
  /** Legacy emoji (pre-V3); the UI uses `icon`. */
  emoji: string;
  /** Lucide icon name from src/modes/icons.ts. */
  icon: string;
  kind: SpaceKind;
  description: string;
  /** Ordered topics in this space. */
  topics: Topic[];
  /** Space-level signals, e.g. "dsa", "leetcode". "~word" marks a supporting signal. */
  keywords: string[];
  /** Added to YouTube searches that don't already name a topic. */
  searchHint: string;
  /** Show relevant videos from all of YouTube, not only the user's channels. */
  discovery: boolean;
  /** Content that should never count as on-track in this space. */
  blockedKeywords: string[];
  /** Channels whose uploads always count as relevant (includes channels added to the space). */
  allowedChannels: ChannelRef[];
  /** Channels whose uploads never count as relevant. */
  blockedChannels: ChannelRef[];
  /** Soft daily budget (session features are dormant in V3). null = no limit. */
  dailyLimitMinutes: number | null;
  /** null = use the global distraction settings. */
  filterOverride: FilterConfig | null;
  createdAt: number;
  updatedAt: number;
}

/* --------------------------------------------------------------- Settings */

/**
 * auto: the learner's endpoint if configured, else Chrome's on-device model when available.
 * No provider ever holds an API key inside the extension.
 */
export type AiProviderSetting = 'auto' | 'chrome' | 'endpoint' | 'off';

export interface AiSettings {
  provider: AiProviderSetting;
  /** The learner's own FocusSpace-compatible server (it keeps any API key). */
  endpointUrl: string;
  /** Default output language for notes and the AI companion — English/Hindi/Hinglish (docs/V5_CONTRACT.md §C/§8). */
  language: NoteLanguage;
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

/**
 * The FocusSpace identity/API server (Layer 2B — server/index.ts's /v1/auth/*
 * and /v1/me routes), kept separate from `AiSettings.endpointUrl`: that's the
 * learner's own AI relay (any URL, no account needed), this is FocusSpace's
 * own backend for signing in. Empty means "no account server configured" —
 * the anonymous, fully local experience, unchanged.
 */
export interface ApiSettings {
  baseUrl: string;
}

export interface Settings {
  focusEnabled: boolean;
  activeModeId: ID | null;
  defaultModeId: ID | null;
  focus: FilterConfig;
  offTrackNudges: boolean;
  trackWatchHistory: boolean;
  autoSyncSubscriptions: boolean;
  theme: ThemePreference;
  density: Density;
  displayName: string;
  onboarded: boolean;
  /** Developer aid: show why each video got its relevance score. */
  debugRelevance: boolean;
  /** Tell FocusSpace, once a day, that this install was used — nothing else (background/activity.ts). */
  shareUsageCounts: boolean;
  /** FocusSpace AI (only runs when the learner asks). */
  ai: AiSettings;
  /** The FocusSpace account/identity server (Layer 2B). Optional — see ApiSettings. */
  api: ApiSettings;
  /* Dormant session features (kept for a future accountability release). */
  defaultSessionMinutes: number;
  askIntentOnModeSwitch: boolean;
  notifyOnSessionEnd: boolean;
}

/* --------------------------------------------------------------- Sessions (dormant in V3) */

export type SessionStatus = 'active' | 'paused' | 'completed';

export interface LearningSession {
  id: ID;
  modeId: ID;
  topicId: ID | null;
  goal: string;
  plannedMinutes: number;
  startedAt: number;
  endedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  status: SessionStatus;
  limitReachedAt: number | null;
}

/** seconds of focused YouTube time, keyed by local date (YYYY-MM-DD) then mode id. */
export type UsageLog = Record<string, Record<ID, number>>;

/* --------------------------------------------------------------- Watching */

/** A video watched on YouTube while Focus Mode was on (local only). */
export interface WatchEntry {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string | null;
  modeId: ID;
  topicId: ID | null;
  watchedAt: number;
  /** 0–1 of the video watched, as measured by FocusSpace. */
  progress: number;
  durationSec: number | null;
  playlistId: string | null;
  playlistIndex: number | null;
}

export interface SavedVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  addedAt: number;
}

/** User-curated playlists: space id → topic id → videos. */
export type TopicPlaylists = Record<ID, Record<ID, SavedVideo[]>>;

/* ------------------------------------------------- Subscription intelligence */

export type ChannelSource = 'youtube-session' | 'manual';

export interface Channel {
  id: string; // UC…
  title: string;
  handle?: string;
  thumbnail?: string;
  source: ChannelSource;
  addedAt: number;
  lastFetchedAt: number | null;
  lastError: string | null;
  /** Excluded from the library (still subscribed on YouTube). */
  ignored: boolean;
}

export interface VideoRecord {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: number;
  thumbnail: string;
  views: number | null;
  durationSec?: number | null;
}

export type SyncStatus = 'idle' | 'importing' | 'syncing';

export interface SyncState {
  status: SyncStatus;
  progress: { done: number; total: number } | null;
  lastImportAt: number | null;
  lastImportCount: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface UiState {
  /** "YYYY-MM-DD:modeId" for which the daily-limit banner was dismissed. */
  dismissedLimitKey: string | null;
}
