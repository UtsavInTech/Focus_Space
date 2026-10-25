/**
 * The features under the hero, in the order a learner meets them: before pressing play, while watching,
 * and when revising. Every claim here is something the extension actually does today (see README.md and
 * docs/) — this file is not the place to describe the roadmap.
 */

import { EXAM_STORY, QUIZ_COPY } from './home';

export const JOURNEY_INTRO = {
  title: 'Choose your goal. Follow a path. Learn from every lecture.',
  text: 'Start with your exam, degree or next skill. FocusSpace gives your subjects a place on YouTube, helps with the lecture you are watching, and lets you check what stayed with you.',
};

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
    label: 'Your goal',
    headline: EXAM_STORY.title,
    body: EXAM_STORY.intro,
    points: [
      EXAM_STORY.steps[0].text,
      EXAM_STORY.steps[1].text,
      EXAM_STORY.note,
    ],
    shots: [
      { name: '09-exam-picker', alt: 'FocusSpace on YouTube asking “What are you preparing for?”, with government jobs such as UPSC, SSC and banking, and entrance exams such as JEE, NEET and GATE', caption: 'Picking your goal on YouTube' },
      { name: '10-exam-home', alt: 'A NEET Space on YouTube: Biology, Physics and Chemistry chips and a featured Kinematics lesson', caption: 'A NEET Space, built from that choice' },
    ],
  },
  {
    id: 'guide',
    stage: 'before',
    label: 'Set up by talking',
    headline: 'Tell it what you study. It sets everything up.',
    body: 'The first time you open YouTube, the FocusSpace guide asks one question. Answer in a sentence, like “DSA with Love Babbar and Apna College, and Spanish”, and it creates each Space, adds those creators, and brings in the channels you already follow.',
    points: [
      'Type it, or tap Talk and just say it: FocusSpace listens and answers out loud',
      'Stuck later? Ask FocusSpace AI to switch Space or open a video for you',
      'Rather do it yourself? Skip, and set things up one by one',
    ],
    shots: [],
  },
  {
    id: 'feed',
    stage: 'before',
    label: 'Your home on YouTube',
    headline: 'A next lesson up front. A shelf for what follows.',
    body: 'Your Space opens with a featured video, then shelves of lessons. Your subscriptions are ranked around your subject, with relevant discoveries from wider YouTube alongside them.',
    points: [
      'A pinned Space bar keeps subjects and topics close as you scroll',
      'FocusSpace History and Library shelves help you pick up where you left off',
      'Go full screen from the Space bar; Esc brings your tabs and bars back',
    ],
    shots: [
      { name: '12-streaming-home', alt: 'Shelves of lessons in a NEET Space on YouTube: a Zoology shelf, then fresh picks checked against the syllabus', caption: 'Shelves of lessons for your subjects' },
      { name: '03-your-feed', alt: 'YouTube’s home in a DSA Space: topic chips, then linked-list lectures from the learner’s own subscriptions', caption: 'YouTube’s home, in a DSA Space' },
      { name: '04-continue-watching', alt: 'The FocusSpace dashboard home: Your Spaces, Continue watching with progress bars, and recent notes', caption: 'Continue watching, where you stopped' },
    ],
  },
  {
    id: 'learning-path',
    stage: 'before',
    label: 'Learning paths',
    headline: 'Know where to begin. See what comes next.',
    body: EXAM_STORY.steps[2].text,
    points: [
      'UPSC: Prelims GS → Prelims CSAT → Mains → Interview. System Design: Foundations → HLD → LLD → Interview',
      'Open a stage to choose a topic and its subtopics',
      'Progress comes from lessons watched; “You are here” marks the next stage to cover',
    ],
    shots: [
      { name: '11-learning-path', alt: 'A UPSC learning path on YouTube in four stages, Prelims GS, Prelims CSAT, Mains and Interview, with You are here on Prelims GS', caption: 'A path in stages, with “You are here”' },
    ],
  },
  {
    id: 'course',
    stage: 'during',
    label: 'Your course',
    headline: 'It follows the course you are actually on.',
    body: 'When a video belongs to a real playlist, the one you are watching through, or the course the creator links in the description, that playlist becomes your learning path.',
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
    body: 'FocusSpace reads the creator’s chapters, the timestamps in the description, the outlines viewers write in the comments and the transcript, and builds a map of the video, then tells you which part you are in as you watch.',
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
    headline: 'An AI that knows the lecture you are in.',
    body: 'Explain this, Give an example, or ask FocusSpace AI anything about the video, by typing or out loud. It runs only when you ask, and it sees the concept you are on and the part of the transcript that teaches it, never your history or your subscriptions.',
    points: [
      'Nothing happens during playback: no requests, no cost, no lag',
      'Talk to it hands-free, and hear the answer read back',
      'On supported computers, on-device AI can take over when hosted AI credits run out',
    ],
    shots: [
      { name: '06-ask-ai', alt: 'FocusSpace AI answering on YouTube’s home in a System Design Space, recommending specific lectures', caption: 'FocusSpace AI, on YouTube’s home' },
    ],
  },
  {
    id: 'quiz',
    stage: 'after',
    label: 'Quizzes you can trust',
    headline: 'Choose your round. Check what you learned.',
    body: QUIZ_COPY,
    points: [
      'On FocusSpace AI, questions are checked by another model before they are shown',
      'Questions stay with the part of the video you chose',
      'Difficulty and score are available on eligible paid plans',
    ],
    shots: [],
  },
  {
    id: 'notes',
    stage: 'after',
    label: 'Notes & mind maps',
    headline: 'Notes from what you watched, not from the whole internet.',
    body: 'Generate notes for the current section, everything you have watched so far, or the full video, grounded in the chapters and transcript of exactly that span, and traceable back to the part of the map they came from.',
    points: [
      'Mind maps as real diagrams you can export',
      'English, हिंदी or Hinglish. Technical terms are never translated',
      'Saved against the video, so they are there when you come back',
    ],
    shots: [
      { name: '07-mind-map', alt: 'A mind map of a DSA patterns lecture: the video at the centre, with Array, String, Set, Hashmap and Two Pointers branching off', caption: 'A mind map of the lecture' },
      { name: '08-mind-map-open', alt: 'The same mind map fully expanded, each branch listing what the lecture says about it', caption: 'Every branch, opened up' },
    ],
  },
];
