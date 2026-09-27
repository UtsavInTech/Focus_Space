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
  /** What this Space is not — kept off its page even when a word matches ("news", "vlog", "tutorial"). */
  avoid: string[];
}

/** What the assistant knows when it reads a turn: the person's Spaces and what it last asked. */
export interface SetupTurnState {
  /** Every Space they have, with the creators already in it; `isNew` = made in this conversation. */
  spaces: { name: string; channels: string[]; isNew: boolean }[];
  /** The question it is waiting on, if any. */
  asking: { kind: 'subjects' } | { kind: 'channels'; space: string } | null;
}

/** One thing to do about what was said. The extension carries these out; the server only decides. */
export type SetupAction =
  | { type: 'create_space'; space: SetupSpacePlan }
  | { type: 'add_channels'; space: string; names: string[] }
  | { type: 'remove_channels'; space: string; names: string[] }
  | { type: 'remove_space'; space: string }
  /** "No / skip" to the favourite-creator question for this Space. */
  | { type: 'no_channels'; space: string };

export interface SetupTurnAnswer {
  reply: string;
  actions: SetupAction[];
}

export interface ChannelCandidate {
  title: string;
  handle: string | null;
  subscribers: string;
  description: string;
}

/** For each name asked for, the index of the search result they meant, or null when none of them is it. */
export interface SetupPickAnswer {
  picks: (number | null)[];
}

/** Something FocusSpace AI can do on YouTube for the person (content/ui/ai-commands.ts carries it out). */
export type CommandAction =
  | { type: 'switch_space'; space: string }
  | { type: 'create_space'; space: SetupSpacePlan }
  /** Find this on YouTube and play the best match. */
  | { type: 'play'; query: string }
  /** Show YouTube's results for this. */
  | { type: 'search'; query: string };

export interface SetupCommandAnswer {
  reply: string;
  actions: CommandAction[];
}

export type SetupRequest =
  /** "I want system design, Spanish and French" → the Spaces to create. */
  | { task: 'spaces'; text: string; existing: string[]; catalog: { id: string; name: string }[] }
  /** "Striver and Love Babbar" (about the DSA Space) → the channel names to look up. */
  | { task: 'channels'; text: string; space: string }
  /** One turn of the conversation, read against everything so far — including corrections. */
  | { task: 'turn'; text: string; state: SetupTurnState; catalog: { id: string; name: string }[] }
  /** "Telusko" + YouTube's search results → which result is the channel they mean. */
  | { task: 'pick'; text: string; space: string; items: { name: string; candidates: ChannelCandidate[] }[] }
  /** "Change the mode to system design and play Harkirat building an app" → things to do on YouTube. */
  | { task: 'command'; text: string; spaces: string[]; active: string | null; catalog: { id: string; name: string }[] };

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

export type SetupAnswer = SetupSpacesAnswer | SetupChannelsAnswer | SetupTurnAnswer | SetupPickAnswer | SetupCommandAnswer;

/** Voice while setting up is open to everyone; anywhere else it needs an account (server/usage/voice.ts). */
export type VoicePurpose = 'setup' | 'chat';

/** Longest thing a learner can say or type in one turn. */
export const SETUP_MAX_TEXT = 1_000;
/** Longest recording the assistant will listen to, and the most it will say in one breath. */
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_SPEECH_CHARS = 600;
