import { ruleClassifier, type VideoClassifier } from '@/learning/classifier';

/**
 * Single place that decides which classifier powers FocusSpace.
 *
 * Today: the deterministic rules classifier (no network, no data leaves the
 * browser). Later: an AI classifier that *augments* it — calling the
 * FocusSpace backend, caching results, and falling back to the rules when
 * offline (see docs/AI_ARCHITECTURE.md). Secrets live on the server, never here.
 */
let active: VideoClassifier = ruleClassifier;

export const getClassifier = (): VideoClassifier => active;

export function setClassifier(classifier: VideoClassifier): void {
  active = classifier;
}
