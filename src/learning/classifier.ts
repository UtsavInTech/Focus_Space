import type { LearningMode } from '@/types/domain';
import { CLASSIFIER_VERSION } from './relevance/lexicon';
import { FEED_MIN_SCORE, finalizeClassification, modeFingerprint, scoreVideo } from './relevance/scorer';
import type { Classification, ClassifyContext, RelevanceResult, VideoClassifier, VideoMetadata } from './relevance/types';

/**
 * Video → Metadata → Classifier → Topic → Difficulty → Relevance
 *
 * The rules classifier (src/learning/relevance) is deterministic and local.
 * VideoClassifier is the seam where an AI classifier can later augment it —
 * served by a backend, never with secrets in the extension. See docs/AI_ARCHITECTURE.md.
 */

export type { Classification, ClassifyContext, Difficulty, MatchStrength, SignalLine, Tier, VideoClassifier, VideoMetadata } from './relevance/types';
export { FEED_MIN_SCORE, TIER_LABEL, tierOf } from './relevance/scorer';

/** Shown in the main feed: Relevant tier and above. */
export const isRelevant = (c: Classification) => c.strength !== 'blocked' && c.relevance >= FEED_MIN_SCORE;

/* ─── Classification cache ─────────────────────────────────────────────────────
 *
 * Channel-independent results are cached per  mode id + mode fingerprint  and
 * then per video id (+ whether a space search surfaced it). The fingerprint
 * hashes the mode's topics/keywords/kind AND CLASSIFIER_VERSION, so editing a
 * space or shipping a new classifier invalidates exactly what changed. A cheap
 * content signature catches edited titles/descriptions. Snapshots are persisted
 * by the background warmer (src/background/relevance-warmer.ts).
 */

interface CacheEntry {
  /** Content signature. */
  s: string;
  r: RelevanceResult;
}

export interface ModeCacheSnapshot {
  fingerprint: string;
  entries: Record<string, CacheEntry>;
}

const MAX_PER_MODE = 15_000;
const caches = new Map<string, Map<string, CacheEntry>>();
const fingerprints = new WeakMap<LearningMode, string>();
let misses = 0;

export function fingerprintOf(mode: LearningMode): string {
  let fingerprint = fingerprints.get(mode);
  if (!fingerprint) {
    fingerprint = modeFingerprint(mode);
    fingerprints.set(mode, fingerprint);
  }
  return fingerprint;
}

function modeCache(mode: LearningMode): Map<string, CacheEntry> {
  const key = `${mode.id}|${fingerprintOf(mode)}`;
  let cache = caches.get(key);
  if (!cache) {
    for (const k of caches.keys()) if (k.startsWith(`${mode.id}|`)) caches.delete(k);
    cache = new Map();
    caches.set(key, cache);
  }
  return cache;
}

const signature = (video: VideoMetadata, context: ClassifyContext) =>
  `${video.title.length}.${(video.description ?? '').length}.${context.boilerplate?.size ?? 0}.${video.title.slice(0, 40)}`;

function baseResult(video: VideoMetadata, mode: LearningMode, context: ClassifyContext): RelevanceResult {
  const cache = modeCache(mode);
  const key = context.sourceQuery ? `${video.videoId}|q` : video.videoId;
  const s = signature(video, context);
  const hit = cache.get(key);
  if (hit?.s === s) return hit.r;
  misses++;
  const { result } = scoreVideo(video, mode, { boilerplate: context.boilerplate, sourceQuery: context.sourceQuery });
  if (cache.size >= MAX_PER_MODE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { s, r: result });
  return result;
}

/** Snapshot of cached results for the given videos (for persistence). */
export function exportModeCache(mode: LearningMode, videoIds: Iterable<string>): ModeCacheSnapshot {
  const cache = modeCache(mode);
  const entries: Record<string, CacheEntry> = {};
  for (const id of videoIds) {
    const entry = cache.get(id);
    if (entry) entries[id] = entry;
  }
  return { fingerprint: fingerprintOf(mode), entries };
}

/** Load a persisted snapshot; ignored unless it was computed for this exact mode + classifier version. */
export function hydrateModeCache(mode: LearningMode, snapshot: ModeCacheSnapshot | undefined): boolean {
  if (!snapshot || snapshot.fingerprint !== fingerprintOf(mode)) return false;
  const cache = modeCache(mode);
  for (const [id, entry] of Object.entries(snapshot.entries)) if (!cache.has(id)) cache.set(id, entry);
  return true;
}

export const cacheMisses = () => misses;
export const clearClassificationCache = () => caches.clear();

export const ruleClassifier: VideoClassifier = {
  id: 'rules',
  version: CLASSIFIER_VERSION,
  classify(video, mode, context = {}) {
    return finalizeClassification(baseResult(video, mode, context), video, mode, context).classification;
  },
  explain(video, mode, context = {}) {
    const scored = scoreVideo(video, mode, { boilerplate: context.boilerplate, sourceQuery: context.sourceQuery, explain: true });
    const final = finalizeClassification(scored.result, video, mode, context);
    return { classification: final.classification, signals: [...scored.signals, ...final.signals] };
  },
};
