import type { LearningMode, Topic } from '@/types/domain';
import type { PreferenceProfile, TopicAffinity } from '@/types/preferences';

/**
 * Cross-course continuity. The in-course "next" (`learning/path/path.ts`)
 * stays authoritative whenever a course exists — this only answers the
 * question that's left once it runs out: "the course is done, what next?"
 *
 * Pure and read-only; not wired into any UI this phase (the rail stays
 * unchanged — see docs/V5_CONTRACT.md §D/§G). A future rail section or
 * dashboard card can call this directly.
 */

export interface TopicSuggestion {
  topicId: string;
  topicName: string;
  score: number;
  reason: string;
}

/**
 * The topic in this space the learner's own behavioral affinity points to
 * next, excluding the one they're currently on. Returns null when there
 * isn't enough signal to say anything — same cold-start floor as channel
 * affinity (`scorer.ts`), so one video never manufactures a suggestion.
 */
export function nextTopicSuggestion(mode: LearningMode, profile: PreferenceProfile | null, currentTopicId: string | null): TopicSuggestion | null {
  if (!profile) return null;
  const candidates: { topic: Topic; affinity: TopicAffinity }[] = mode.topics
    .filter((t) => t.id !== currentTopicId)
    .map((topic) => ({ topic, affinity: profile.topics[topic.id] }))
    .filter((c): c is { topic: Topic; affinity: TopicAffinity } => !!c.affinity && c.affinity.score > 0);
  const best = candidates.sort((a, b) => b.affinity.score - a.affinity.score)[0];
  if (!best) return null;
  return {
    topicId: best.topic.id,
    topicName: best.topic.name,
    score: best.affinity.score,
    reason: `Based on what you've been watching in ${mode.name}`,
  };
}
