/**
 * The feature tabs under the hero. Every claim here is something the extension
 * actually does today (see README.md and docs/) — this file is not the place
 * to describe the roadmap.
 */

export interface Feature {
  id: string;
  label: string;
  headline: string;
  body: string;
  points: string[];
}

export const FEATURES: Feature[] = [
  {
    id: 'modes',
    label: 'Modes',
    headline: 'Say what you came for. YouTube rearranges itself.',
    body: 'A mode is an intention — “DSA”, “System design”, “Punjabi music”. Type it in plain words and FocusSpace works out the topics, the vocabulary and the searches that express it. No keyword lists to maintain.',
    points: [
      'Built-in modes for DSA, Web Development, AI/ML, Data Science, SQL, Java and Relaxation',
      'Add channels you like without subscribing to them',
      'Switch modes from YouTube’s home, its sidebar, or the extension popup',
    ],
  },
  {
    id: 'feed',
    label: 'Your feed',
    headline: 'Your subscriptions first, the rest of YouTube woven in.',
    body: '“Recommended for you” becomes your own channels ranked by how well they match what you are learning, with a discovery from the wider YouTube after every four — each one relevance-checked before it is shown.',
    points: [
      'An explainable scoring model, not a black box: every video can tell you why it is there',
      'Shorts and the usual attention traps are gone',
      'Continue watching knows where you stopped and what you skipped',
    ],
  },
  {
    id: 'course',
    label: 'Your course',
    headline: 'It follows the course you are actually on.',
    body: 'When a video belongs to a real playlist — the one you are watching through, or the course the creator links in the description — that playlist becomes your learning path.',
    points: [
      '✓ watched · ▶ you are here · → next unwatched · skipped lectures',
      'Without a playlist, numbered titles give a series that is labelled as a guess',
      'Relevance never reorders your course',
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge map',
    headline: 'Every lecture, broken into what it actually teaches.',
    body: 'FocusSpace reads the creator’s chapters, the timestamps in the description, the outlines viewers write in the comments and the transcript, and builds a map of the video — then tells you which part you are in as you watch.',
    points: [
      '“Insert in a Linked List · Up next: Display at 26:50”',
      'A clickable outline that seeks the player',
      'Every item says where it came from, and how confident it is',
    ],
  },
  {
    id: 'notes',
    label: 'Notes & mind maps',
    headline: 'Notes from what you watched, not from the whole internet.',
    body: 'Generate notes for the current section, everything you have watched so far, or the full video — grounded in the chapters and transcript of exactly that span, and traceable back to the part of the map they came from.',
    points: [
      'Mind maps as real diagrams you can export',
      'English, हिंदी or Hinglish — technical terms are never translated',
      'Saved against the video, so they are there when you come back',
    ],
  },
  {
    id: 'ai',
    label: 'Ask AI',
    headline: 'An AI that only sees the moment you are in.',
    body: 'Explain this · Example · Quiz me · Ask about this moment. It runs only when you click it, and it receives the current concept and a short transcript window — never your history, your subscriptions or the whole video.',
    points: [
      'Nothing happens during playback: no requests, no cost, no lag',
      'Quizzes test the subject, not whether you memorised the lecture numbering',
      'No API key to bring. It works the moment you install it.',
    ],
  },
];
