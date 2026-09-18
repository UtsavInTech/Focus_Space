import type { LearningMode, LearningSession } from '@/types/domain';
import { FEED_MIN_SCORE, TIER_LABEL, type Classification, type VideoMetadata } from '@/learning/classifier';
import { getClassifier } from './registry';
import { remainingMs } from '@/learning/session';

/**
 * Sidekick assessments: "does what I'm watching match what I said I'd learn?"
 *
 * This is the contract a future AI Sidekick implements. The current
 * implementation is deterministic and local: it only reports what the rules
 * classifier can actually see, and its wording never claims more certainty
 * than that. Nudges only fire when there is essentially no topic evidence.
 */

export interface SidekickContext {
  mode: LearningMode;
  session: LearningSession | null;
  video: VideoMetadata;
}

export type Verdict = 'on-track' | 'unclear' | 'off-track';

export interface Assessment {
  verdict: Verdict;
  classification: Classification;
  topicName: string | null;
  headline: string;
  detail: string;
}

export interface Sidekick {
  assess(context: SidekickContext): Assessment;
}

/** Below this, with no topic evidence either, a video is treated as off-track. */
const OFF_TRACK_MAX = 0.3;

const minutesLeft = (session: LearningSession | null) => (session ? Math.max(0, Math.ceil(remainingMs(session) / 60_000)) : 0);

export const localSidekick: Sidekick = {
  assess({ mode, session, video }) {
    const classification = getClassifier().classify(video, mode);
    const topicName = mode.topics.find((t) => t.id === classification.topicId)?.name ?? null;
    const sessionTopic = session ? mode.topics.find((t) => t.id === session.topicId)?.name ?? session.goal : null;
    const scope = session ? 'session' : 'mode';

    if (classification.strength === 'blocked') {
      const reason =
        classification.channelRule === 'blocked'
          ? 'This channel is blocked in this mode.'
          : `The title mentions “${classification.blockedTerms[0]}”, which you blocked in ${mode.name} mode.`;
      return { verdict: 'off-track', classification, topicName, headline: `This doesn't appear to match your ${mode.name} ${scope}.`, detail: reason };
    }

    if (classification.relevance >= FEED_MIN_SCORE) {
      const where = topicName ? `${mode.name} → ${topicName}` : mode.name;
      const detail =
        classification.channelRule === 'allowed' && classification.matchedTerms.length === 0
          ? `From a channel you always allow in ${mode.name}.`
          : `${TIER_LABEL[classification.tier]} · ${classification.matchedTerms.slice(0, 4).join(', ')}`;
      return { verdict: 'on-track', classification, topicName, headline: `Looks aligned with ${where}.`, detail };
    }

    if (classification.relevance >= OFF_TRACK_MAX || classification.topical >= OFF_TRACK_MAX) {
      const terms = classification.matchedTerms.slice(0, 3).join(', ');
      return {
        verdict: 'unclear',
        classification,
        topicName,
        headline: `Possibly related to ${mode.name}.`,
        detail: terms ? `Mentions ${terms}, but doesn't look like a clear lesson on it.` : 'Only a loose connection to your topics.',
      };
    }

    const left = minutesLeft(session);
    const detail =
      session && sessionTopic && left > 0
        ? `You planned to study ${sessionTopic} for another ${left} min.`
        : `Nothing in the title or description matches your ${mode.name} topics.`;
    return { verdict: 'off-track', classification, topicName, headline: `This doesn't appear to match your ${mode.name} ${scope}.`, detail };
  },
};
