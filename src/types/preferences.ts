/**
 * Preference-learning contract (V5, workstream 1).
 *
 * WS1 owns the logic that produces these shapes (src/learning/preferences/).
 * The relevance engine (src/learning/relevance/channels.ts) consumes
 * ChannelAffinity as an additional input to ClassifyContext.channelScore —
 * it does not replace channel profiles, it blends into the same 0–1 score.
 *
 * Do not change these shapes without updating docs/V5_CONTRACT.md.
 */

export const PREFERENCE_VERSION = 1;

export type PreferenceSignalKind =
  | 'watch-progress' // periodic, coalesced: how far into a video the learner got
  | 'completed' // crossed the "watched" threshold (see COMPLETE_AT in learning/next.ts)
  | 'rewatch' // opened a previously-completed video again
  | 'ai-action' // used an AI action (explain/quiz/ask/notes) on this creator's content
  | 'explicit-save' // added to a topic playlist / saved
  | 'explicit-dismiss'; // "not interested" / hidden from a feed

export interface PreferenceSignal {
  kind: PreferenceSignalKind;
  channelId: string;
  videoId: string;
  modeId: string;
  topicId: string | null;
  at: number; // epoch ms
  /** 0–1, only for watch-progress/completed. */
  progress?: number;
}

/** Rolling affinity for one channel within one space, independent of subscription status. */
export interface ChannelAffinity {
  channelId: string;
  modeId: string;
  /** 0–1, time-decayed. Subscription is a separate signal, not baked in here — see docs/V5_CONTRACT.md §Preference scoring. */
  score: number;
  sampleSize: number;
  lastSignalAt: number;
}

export interface TopicAffinity {
  topicId: string;
  modeId: string;
  score: number;
  sampleSize: number;
  lastSignalAt: number;
}

/**
 * Persisted, per space. Summary statistics only — raw signals are derived from
 * `watchHistory` (already persisted) and are not duplicated here.
 */
export interface PreferenceProfile {
  version: number;
  modeId: string;
  channels: Record<string, ChannelAffinity>;
  topics: Record<string, TopicAffinity>;
  updatedAt: number;
}
