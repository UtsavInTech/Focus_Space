import type { ChannelAffinity, PreferenceProfile, PreferenceSignal, TopicAffinity } from '@/types/preferences';
import { PREFERENCE_VERSION } from '@/types/preferences';

/**
 * Behavioral creator/topic affinity from `PreferenceSignal`s — deterministic
 * and local, in the same explainable spirit as the relevance engine
 * (see docs/RELEVANCE.md). Full formula and rationale: docs/V5_CONTRACT.md §D.
 *
 * The documented formula has four weighted components (completion, rewatch,
 * ai-engagement, explicit-save); only completion and explicit-save have a
 * real signal source this phase — 'rewatch' needs per-session watch history
 * and 'ai-engagement' needs WS3's AI-action tracking, neither of which exists
 * yet. Their weight is reserved, not dropped: the two implemented weights
 * (0.45, 0.15) keep the documented 3:1 ratio, normalised to sum to 1 —
 * 0.75 completion, 0.25 explicit-save.
 */

export const MIN_SAMPLES = 3;
export const HALF_LIFE_DAYS = 21;
export const COMPLETION_WEIGHT = 0.75;
export const SAVE_WEIGHT = 0.25;

const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Exponential decay: a signal `halfLifeDays` old counts for half as much. Preference should track what the learner is *currently* into. */
export function decay(lastSignalAt: number, now: number, halfLifeDays = HALF_LIFE_DAYS): number {
  const ageDays = Math.max(0, (now - lastSignalAt) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

interface Agg {
  videos: Set<string>;
  completed: Set<string>;
  saved: Set<string>;
  lastSignalAt: number;
}

function aggregate(signals: readonly PreferenceSignal[], modeId: string, keyOf: (s: PreferenceSignal) => string | null): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const s of signals) {
    if (s.modeId !== modeId) continue;
    const key = keyOf(s);
    if (!key) continue;
    let agg = out.get(key);
    if (!agg) {
      agg = { videos: new Set(), completed: new Set(), saved: new Set(), lastSignalAt: 0 };
      out.set(key, agg);
    }
    agg.lastSignalAt = Math.max(agg.lastSignalAt, s.at);
    if (s.kind === 'explicit-save') agg.saved.add(s.videoId);
    else {
      agg.videos.add(s.videoId);
      if (s.kind === 'completed') agg.completed.add(s.videoId);
    }
  }
  return out;
}

/** Below `minSamples` distinct videos, a single watch can't dominate the score — an unsubscribed channel needs real repeat engagement first. */
function affinityOf(agg: Agg, now: number, halfLifeDays: number, minSamples: number): { score: number; sampleSize: number } {
  const sampleSize = new Set([...agg.videos, ...agg.saved]).size;
  const completionRate = agg.videos.size ? agg.completed.size / agg.videos.size : 0;
  const saveRate = sampleSize ? agg.saved.size / sampleSize : 0;
  const raw = clamp01(COMPLETION_WEIGHT * completionRate + SAVE_WEIGHT * saveRate);
  const score = sampleSize >= minSamples ? round(raw * decay(agg.lastSignalAt, now, halfLifeDays)) : 0;
  return { score, sampleSize };
}

export interface BuildProfileOptions {
  now?: number;
  halfLifeDays?: number;
  minSamples?: number;
}

/** Behavioral affinity for one space, independent of subscription status — see docs/V5_CONTRACT.md §D. */
export function buildPreferenceProfile(modeId: string, signals: readonly PreferenceSignal[], options: BuildProfileOptions = {}): PreferenceProfile {
  const now = options.now ?? Date.now();
  const halfLifeDays = options.halfLifeDays ?? HALF_LIFE_DAYS;
  const minSamples = options.minSamples ?? MIN_SAMPLES;

  const byChannel = aggregate(signals, modeId, (s) => s.channelId);
  const channels: Record<string, ChannelAffinity> = {};
  for (const [channelId, agg] of byChannel) {
    const { score, sampleSize } = affinityOf(agg, now, halfLifeDays, minSamples);
    channels[channelId] = { channelId, modeId, score, sampleSize, lastSignalAt: agg.lastSignalAt };
  }

  const byTopic = aggregate(signals, modeId, (s) => s.topicId);
  const topics: Record<string, TopicAffinity> = {};
  for (const [topicId, agg] of byTopic) {
    const { score, sampleSize } = affinityOf(agg, now, halfLifeDays, minSamples);
    topics[topicId] = { topicId, modeId, score, sampleSize, lastSignalAt: agg.lastSignalAt };
  }

  return { version: PREFERENCE_VERSION, modeId, channels, topics, updatedAt: now };
}

/* ─── Explainability ─────────────────────────────────────────────────────────
 * "Why did this creator's affinity score what it scored?" — the same
 * transparency principle as ruleClassifier.explain() (docs/RELEVANCE.md).
 */

export interface AffinityLine {
  label: string;
  value: number;
}

export interface AffinityExplanation {
  channelId: string;
  modeId: string;
  score: number;
  sampleSize: number;
  lines: AffinityLine[];
}

export function explainChannelAffinity(modeId: string, channelId: string, signals: readonly PreferenceSignal[], options: BuildProfileOptions = {}): AffinityExplanation {
  const now = options.now ?? Date.now();
  const halfLifeDays = options.halfLifeDays ?? HALF_LIFE_DAYS;
  const minSamples = options.minSamples ?? MIN_SAMPLES;
  const agg = aggregate(signals, modeId, (s) => s.channelId).get(channelId) ?? { videos: new Set<string>(), completed: new Set<string>(), saved: new Set<string>(), lastSignalAt: 0 };
  const sampleSize = new Set([...agg.videos, ...agg.saved]).size;
  const completionRate = agg.videos.size ? agg.completed.size / agg.videos.size : 0;
  const saveRate = sampleSize ? agg.saved.size / sampleSize : 0;

  const lines: AffinityLine[] = [
    { label: `${agg.completed.size} of ${agg.videos.size} watched videos completed (${round(completionRate)}) × ${COMPLETION_WEIGHT}`, value: round(COMPLETION_WEIGHT * completionRate) },
    { label: `${agg.saved.size} of ${sampleSize} saved (${round(saveRate)}) × ${SAVE_WEIGHT}`, value: round(SAVE_WEIGHT * saveRate) },
  ];

  if (sampleSize < minSamples) {
    lines.push({ label: `below the minimum sample size (${minSamples}) — score is 0 until then`, value: 0 });
    return { channelId, modeId, score: 0, sampleSize, lines };
  }

  const d = decay(agg.lastSignalAt, now, halfLifeDays);
  const ageDays = Math.round((now - agg.lastSignalAt) / 86_400_000);
  lines.push({ label: `decay: most recent signal ${ageDays}d old, half-life ${halfLifeDays}d → ×${round(d)}`, value: 0 });

  const { score } = affinityOf(agg, now, halfLifeDays, minSamples);
  return { channelId, modeId, score, sampleSize, lines };
}
