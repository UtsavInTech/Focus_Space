/**
 * The setup assistant — the first-run guide's conversation (content/ui/SetupChat.tsx) — and the server
 * that understands it (server/setup/service.ts). Shared so both ends agree on one shape.
 */

/** One Space the learner asked for, as the assistant understood it. */
export interface SetupSpacePlan {
  /** Short and clean: "System Design", "Learn Spanish" — never the sentence it came from. */
  name: string;
  /** A built-in template when the request is one of them, so its curated topics are used. */
  templateId: string | null;
  icon: string;
  kind: 'learning' | 'media' | 'general';
  description: string;
  /** The subtopics the Space is organised into. */
  topics: { name: string; keywords: string[] }[];
  keywords: string[];
  searchHint: string;
}

export type SetupRequest =
  /** "I want system design, Spanish and French" → the Spaces to create. */
  | { task: 'spaces'; text: string; existing: string[]; catalog: { id: string; name: string }[] }
  /** "Striver and Love Babbar" (about the DSA Space) → the channel names to look up. */
  | { task: 'channels'; text: string; space: string };

export interface SetupSpacesAnswer {
  /** What the assistant says back, in one or two spoken-style sentences. */
  reply: string;
  spaces: SetupSpacePlan[];
  /** Creators named in the same breath — "DSA with Striver", "add Gaurav Sen to system design". */
  channels: { space: string; names: string[] }[];
}

export interface SetupChannelsAnswer {
  reply: string;
  /** Names to search YouTube for; empty when they said no or skip. */
  channels: string[];
}

export type SetupAnswer = SetupSpacesAnswer | SetupChannelsAnswer;

/** Longest thing a learner can say or type in one turn. */
export const SETUP_MAX_TEXT = 1_000;
/** Longest recording the assistant will listen to, and the most it will say in one breath. */
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_SPEECH_CHARS = 600;
