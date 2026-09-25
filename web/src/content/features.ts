/**
 * The features under the hero, in the order a learner meets them: before pressing play, while watching,
 * and when revising. Every claim here is something the extension actually does today (see README.md and
 * docs/) — this file is not the place to describe the roadmap.
 */

export const STAGES = {
  before: 'Before you press play',
  during: 'While you watch',
  after: 'When you revise',
} as const;

/**
 * A real screenshot of the extension, cropped to the part that proves its feature — the book's pages are
 * small, and a whole browser window at that size is unreadable. Served from web/public/journey/ at two
 * widths (`<name>-960.webp`, `<name>-560.webp`), cut to 3:2, the page's own shape.
 */
export interface Shot {
  name: string;
  alt: string;
  caption: string;
}

export interface Feature {
  id: string;
  stage: keyof typeof STAGES;
  label: string;
  headline: string;
  body: string;
  points: string[];
  /** Pages this step turns to in the book, in order. Empty keeps the previous step's page open. */
  shots: Shot[];
}

export const FEATURES: Feature[] = [
  {
    id: 'modes',
    stage: 'before',
    label: 'Modes',
    headline: 'Say what you came for. YouTube rearranges itself.',
    body: 'A mode is an intention — “DSA”, “System design”, “Punjabi music”. Type it in plain words and FocusSpace works out the topics, the vocabulary and the searches that express it. No keyword lists to maintain.',
    points: [
      'Built-in modes for DSA, Web Development, AI/ML, Data Science, SQL, Java and Relaxation',
      'Add channels you like without subscribing to them',
      'Switch modes from YouTube’s home, its sidebar, or the extension popup',
    ],
    shots: [
      { name: '01-choose-a-space', alt: 'FocusSpace on YouTube asking “What do you want to focus on?”, with Spaces grouped into Tech, Languages, Creative, Life and Unwind', caption: 'Choosing a Space on YouTube' },
      { name: '02-your-spaces', alt: 'The Spaces page in the FocusSpace dashboard: the AI/ML and System Design (active) Spaces, and built-in Spaces to add', caption: 'Your Spaces, in the dashboard' },
    ],
  },
  {
    id: 'feed',
    stage: 'before',
    label: 'Your feed',
    headline: 'Your subscriptions first, the rest of YouTube woven in.',
    body: '“Recommended for you” becomes your own channels ranked by how well they match what you are learning, with a discovery from the wider YouTube after every four — each one relevance-checked before it is shown.',
    points: [
      'An explainable scoring model, not a black box: every video can tell you why it is there',
      'Shorts and the usual attention traps are gone',
      'Continue watching knows where you stopped and what you skipped',
    ],
    shots: [
      { name: '03-your-feed', alt: 'YouTube’s home in a DSA Space: topic chips, then linked-list lectures from the learner’s own subscriptions', caption: 'YouTube’s home, in a DSA Space' },
      { name: '04-continue-watching', alt: 'The FocusSpace dashboard home: Your Spaces, Continue watching with progress bars, and recent notes', caption: 'Continue watching, where you stopped' },
    ],
  },
  {
    id: 'course',
    stage: 'during',
    label: 'Your course',
    headline: 'It follows the course you are actually on.',
    body: 'When a video belongs to a real playlist — the one you are watching through, or the course the creator links in the description — that playlist becomes your learning path.',
    points: [
      '✓ watched · ▶ you are here · → next unwatched · skipped lectures',
      'Without a playlist, numbered titles give a series that is labelled as a guess',
      'Relevance never reorders your course',
    ],
    shots: [
      { name: '05-watch-page', alt: 'The FocusSpace rail beside a lecture: the System Design Space, the Learn with AI actions and Make Notes', caption: 'The FocusSpace rail beside a lecture' },
    ],
  },
  {
    id: 'knowledge',
    stage: 'during',
    label: 'Knowledge map',
    headline: 'Every lecture, broken into what it actually teaches.',
    body: 'FocusSpace reads the creator’s chapters, the timestamps in the description, the outlines viewers write in the comments and the transcript, and builds a map of the video — then tells you which part you are in as you watch.',
    points: [
      '“Insert in a Linked List · Up next: Display at 26:50”',
      'A clickable outline that seeks the player',
      'Every item says where it came from, and how confident it is',
    ],
    shots: [],
  },
  {
    id: 'ai',
    stage: 'during',
    label: 'Ask AI',
    headline: 'An AI that only sees the moment you are in.',
    body: 'Explain this · Example · Quiz me · Ask about this moment. It runs only when you click it, and it receives the current concept and a short transcript window — never your history, your subscriptions or the whole video.',
    points: [
      'Nothing happens during playback: no requests, no cost, no lag',
      'Quizzes test the subject, not whether you memorised the lecture numbering',
      'No API key to bring. It works the moment you install it.',
    ],
    shots: [
      { name: '06-ask-ai', alt: 'FocusSpace AI answering on YouTube’s home in a System Design Space, recommending specific lectures', caption: 'FocusSpace AI, on YouTube’s home' },
    ],
  },
  {
    id: 'notes',
    stage: 'after',
    label: 'Notes & mind maps',
    headline: 'Notes from what you watched, not from the whole internet.',
    body: 'Generate notes for the current section, everything you have watched so far, or the full video — grounded in the chapters and transcript of exactly that span, and traceable back to the part of the map they came from.',
    points: [
      'Mind maps as real diagrams you can export',
      'English, हिंदी or Hinglish — technical terms are never translated',
      'Saved against the video, so they are there when you come back',
    ],
    shots: [
      { name: '07-mind-map', alt: 'A mind map of a DSA patterns lecture: the video at the centre, with Array, String, Set, Hashmap and Two Pointers branching off', caption: 'A mind map of the lecture' },
      { name: '08-mind-map-open', alt: 'The same mind map fully expanded, each branch listing what the lecture says about it', caption: 'Every branch, opened up' },
    ],
  },
];
