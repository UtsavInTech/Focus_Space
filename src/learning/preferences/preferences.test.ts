import { describe, expect, it } from 'vitest';
import type { TopicPlaylists, WatchEntry } from '@/types/domain';
import { DEFAULT_MODES } from '@/modes/templates';
import { ruleClassifier } from '@/learning/classifier';
import { profileChannel } from '@/learning/relevance/channels';
import { channelKeyOf, signalsFromSavedVideos, signalsFromWatchHistory } from './signals';
import { buildPreferenceProfile, explainChannelAffinity, HALF_LIFE_DAYS, MIN_SAMPLES } from './scorer';
import { nextTopicSuggestion } from './continuity';

const mode = () => structuredClone(DEFAULT_MODES.find((m) => m.id === 'ai-ml')!);
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-15T00:00:00Z');

const watchEntry = (over: Partial<WatchEntry>): WatchEntry => ({
  videoId: 'v',
  title: 't',
  channelTitle: 'Channel',
  channelId: 'UC1',
  modeId: 'ai-ml',
  topicId: null,
  watchedAt: NOW,
  progress: 0.9,
  durationSec: 600,
  playlistId: null,
  playlistIndex: null,
  ...over,
});

describe('signal derivation (no new tracking — from watchHistory and topicPlaylists only)', () => {
  it('turns watch history into completed/watch-progress signals, skipping videos barely opened', () => {
    const entries = [
      watchEntry({ videoId: 'a', progress: 0.9 }),
      watchEntry({ videoId: 'b', progress: 0.4 }),
      watchEntry({ videoId: 'c', progress: 0.02 }), // below the "started" floor
    ];
    const signals = signalsFromWatchHistory(entries);
    expect(signals).toHaveLength(2);
    expect(signals.find((s) => s.videoId === 'a')?.kind).toBe('completed');
    expect(signals.find((s) => s.videoId === 'b')?.kind).toBe('watch-progress');
    expect(signals.some((s) => s.videoId === 'c')).toBe(false);
  });

  it('falls back to a normalised channel title when channelId is null, instead of dropping the signal', () => {
    const entries = [watchEntry({ videoId: 'a', channelId: null, channelTitle: 'Some Creator' })];
    const signals = signalsFromWatchHistory(entries);
    expect(signals).toHaveLength(1);
    expect(signals[0].channelId).toBe(channelKeyOf(null, 'Some Creator'));
    expect(signals[0].channelId).toBe('title:some creator');
  });

  it('drops a watch entry with neither a channel id nor a title', () => {
    const entries = [watchEntry({ videoId: 'a', channelId: null, channelTitle: '' })];
    expect(signalsFromWatchHistory(entries)).toHaveLength(0);
  });

  it('turns saved videos into explicit-save signals, matched by channel title', () => {
    const playlists: TopicPlaylists = { 'ai-ml': { transformers: [{ videoId: 'v1', title: 'x', channelTitle: 'Saved Creator', addedAt: NOW }] } };
    const signals = signalsFromSavedVideos(playlists);
    expect(signals).toEqual([{ kind: 'explicit-save', channelId: 'title:saved creator', videoId: 'v1', modeId: 'ai-ml', topicId: 'transformers', at: NOW }]);
  });
});

describe('preference scoring (docs/V5_CONTRACT.md §D)', () => {
  it('cold start: a channel below the minimum sample size scores 0, even with a perfect completion rate', () => {
    const signals = signalsFromWatchHistory([watchEntry({ videoId: 'a', progress: 0.95 }), watchEntry({ videoId: 'b', progress: 0.95 })]);
    expect(signals).toHaveLength(2);
    expect(signals.length).toBeLessThan(MIN_SAMPLES);
    const profile = buildPreferenceProfile('ai-ml', signals, { now: NOW });
    expect(profile.channels.UC1.score).toBe(0);
    expect(profile.channels.UC1.sampleSize).toBe(2);
  });

  it('crossing the sample-size floor turns real engagement into a positive score', () => {
    const signals = signalsFromWatchHistory([
      watchEntry({ videoId: 'a', progress: 0.95 }),
      watchEntry({ videoId: 'b', progress: 0.95 }),
      watchEntry({ videoId: 'c', progress: 0.95 }),
    ]);
    const profile = buildPreferenceProfile('ai-ml', signals, { now: NOW });
    expect(profile.channels.UC1.sampleSize).toBe(3);
    expect(profile.channels.UC1.score).toBeGreaterThan(0);
  });

  it('decays: an old signal contributes materially less than a recent one, all else equal', () => {
    const fresh = signalsFromWatchHistory([
      watchEntry({ videoId: 'a', progress: 0.95, watchedAt: NOW }),
      watchEntry({ videoId: 'b', progress: 0.95, watchedAt: NOW }),
      watchEntry({ videoId: 'c', progress: 0.95, watchedAt: NOW }),
    ]);
    const old = signalsFromWatchHistory([
      watchEntry({ videoId: 'a', progress: 0.95, watchedAt: NOW - 60 * DAY }),
      watchEntry({ videoId: 'b', progress: 0.95, watchedAt: NOW - 60 * DAY }),
      watchEntry({ videoId: 'c', progress: 0.95, watchedAt: NOW - 60 * DAY }),
    ]);
    const freshScore = buildPreferenceProfile('ai-ml', fresh, { now: NOW }).channels.UC1.score;
    const oldScore = buildPreferenceProfile('ai-ml', old, { now: NOW }).channels.UC1.score;
    expect(oldScore).toBeLessThan(freshScore * 0.5); // 60 days ≈ 2.85 half-lives (HALF_LIFE_DAYS=21) → well under half
    expect(oldScore).toBeGreaterThan(0);
    expect(HALF_LIFE_DAYS).toBe(21);
  });

  it('topic affinity aggregates independently of channel affinity', () => {
    const signals = signalsFromWatchHistory([
      watchEntry({ videoId: 'a', channelId: 'UC1', topicId: 'transformers', progress: 0.95 }),
      watchEntry({ videoId: 'b', channelId: 'UC2', topicId: 'transformers', progress: 0.95 }),
      watchEntry({ videoId: 'c', channelId: 'UC3', topicId: 'transformers', progress: 0.95 }),
    ]);
    const profile = buildPreferenceProfile('ai-ml', signals, { now: NOW });
    expect(profile.topics.transformers.sampleSize).toBe(3);
    expect(profile.topics.transformers.score).toBeGreaterThan(0);
  });

  it('is explainable: the breakdown traces back to the same numbers the score is built from', () => {
    const signals = signalsFromWatchHistory([
      watchEntry({ videoId: 'a', progress: 0.95 }),
      watchEntry({ videoId: 'b', progress: 0.95 }),
      watchEntry({ videoId: 'c', progress: 0.4 }),
    ]);
    const explanation = explainChannelAffinity('ai-ml', 'UC1', signals, { now: NOW });
    expect(explanation.sampleSize).toBe(3);
    expect(explanation.score).toBeGreaterThan(0);
    expect(explanation.lines.some((l) => l.label.includes('2 of 3 watched videos completed'))).toBe(true);
    const belowFloor = explainChannelAffinity('ai-ml', 'UC-nope', signals, { now: NOW });
    expect(belowFloor.score).toBe(0);
    expect(belowFloor.lines.some((l) => l.label.includes('below the minimum sample size'))).toBe(true);
  });
});

describe('the V5 contract requirement: unsubscribed creator preference', () => {
  it('a repeatedly-watched unsubscribed creator can outrank a once-watched subscribed one, without regressing the subscribed creator\'s own score', () => {
    const m = mode();
    const title = 'Transformers Explained From Scratch'; // real RELEVANCE.md worked example, base ≈0.80 — not saturated near 1
    const videoMeta = (id: string) => ({ videoId: id, title, description: '' });

    // Subscribed creator: one good video in the library, and the learner has watched it once.
    const subChannelId = 'UC_sub';
    const subVideoCls = ruleClassifier.classify(videoMeta('sub-1'), m); // channel-independent, matches how library.ts builds baseResults
    const subRuleProfile = profileChannel(subChannelId, [subVideoCls], m);
    const subWatch = [watchEntry({ videoId: 'sub-1', channelId: subChannelId, channelTitle: 'Sub Creator', modeId: m.id, progress: 0.9, watchedAt: NOW })];
    const subAffinity = buildPreferenceProfile(m.id, signalsFromWatchHistory(subWatch), { now: NOW }).channels[subChannelId];
    expect(subAffinity.sampleSize).toBeLessThan(MIN_SAMPLES); // "once watched" — below the floor, no behavioral contribution yet
    expect(subAffinity.score).toBe(0);

    const subBlendedProfile = profileChannel(subChannelId, [subVideoCls], m, subAffinity);
    expect(subBlendedProfile.score).toBe(subRuleProfile.score); // non-regression: weak personal signal never lowers or inflates the rule-based score
    const subFinal = ruleClassifier.classify(videoMeta('sub-1'), m, { channelScore: subBlendedProfile.score });

    // Unsubscribed creator: never added to the library (no ChannelProfile at all — exactly rankDiscovery's situation),
    // but the learner has completed 5 different videos from them.
    const unsubChannelId = 'UC_unsub';
    const unsubWatch = Array.from({ length: 5 }, (_, i) => watchEntry({ videoId: `unsub-${i}`, channelId: unsubChannelId, channelTitle: 'Unsub Creator', modeId: m.id, progress: 0.95, watchedAt: NOW }));
    const unsubAffinity = buildPreferenceProfile(m.id, signalsFromWatchHistory(unsubWatch), { now: NOW }).channels[unsubChannelId];
    expect(unsubAffinity.sampleSize).toBeGreaterThanOrEqual(MIN_SAMPLES);
    expect(unsubAffinity.score).toBeGreaterThan(0);

    const unsubFinal = ruleClassifier.classify(videoMeta('unsub-0'), m, { channelScore: unsubAffinity.score });

    expect(unsubFinal.channelBoost).toBeGreaterThan(subFinal.channelBoost);
    expect(unsubFinal.relevance).toBeGreaterThan(subFinal.relevance);
    // Sanity: same underlying content, so the gap is attributable to the channel boost alone.
    expect(unsubFinal.base).toBe(subFinal.base);
  });
});

describe('learning-path continuity (cross-course, once the in-course path runs out)', () => {
  it('suggests the highest-affinity topic other than the current one', () => {
    const m = mode();
    const [t0, t1, t2] = m.topics;
    const signals = signalsFromWatchHistory([
      ...Array.from({ length: 3 }, (_, i) => watchEntry({ videoId: `t1-${i}`, topicId: t1.id, modeId: m.id, progress: 0.9, watchedAt: NOW })),
      ...Array.from({ length: 3 }, (_, i) => watchEntry({ videoId: `t2-${i}`, topicId: t2.id, modeId: m.id, progress: 0.5, watchedAt: NOW })),
    ]);
    const profile = buildPreferenceProfile(m.id, signals, { now: NOW });
    const suggestion = nextTopicSuggestion(m, profile, t0.id);
    expect(suggestion?.topicId).toBe(t1.id); // fully completed videos outscore partially-watched ones
  });

  it('returns null without enough signal, and never suggests the current topic', () => {
    const m = mode();
    expect(nextTopicSuggestion(m, null, null)).toBeNull();
    const emptyProfile = buildPreferenceProfile(m.id, [], { now: NOW });
    expect(nextTopicSuggestion(m, emptyProfile, null)).toBeNull();
  });
});
