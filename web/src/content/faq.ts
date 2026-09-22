/**
 * Frequently asked questions, in the order a first-time visitor asks them:
 * what is this → do I have to pay or sign in → how does it work → what about
 * my data → how do I stop paying.
 */

import { FREE_MONTHLY_AI_CREDITS, FREE_SPACE_LIMIT, GUEST_DAILY_AI_CREDITS, GUEST_SPACE_LIMIT } from './plans';

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ: FaqItem[] = [
  {
    q: 'What is FocusSpace?',
    a: 'A Chrome extension that reorganises YouTube around what you are trying to learn. You tell it a mode — “DSA”, “System design”, “Punjabi music” — and your home page becomes your subscriptions ranked against that intention, with the best of the wider YouTube mixed in and the attention traps removed. On a video it follows the course you are on, breaks the lecture into what it teaches, and turns what you watched into notes and mind maps.',
  },
  {
    q: 'Is FocusSpace free?',
    a: 'Yes, and the part that makes YouTube usable is free forever: modes, the ranked feed, the learning path, the knowledge map and Shorts removal all run on your own machine and cost us nothing to give away. What a paid plan buys is AI — notes, mind maps, explanations and quizzes — because every one of those is a real request we pay for, plus more Spaces.',
  },
  {
    q: 'Do I need an account?',
    a: `No. FocusSpace works fully signed out, with ${GUEST_SPACE_LIMIT} Spaces and ${GUEST_DAILY_AI_CREDITS} AI credits a day. A free account raises that to ${FREE_SPACE_LIMIT} Spaces and ${FREE_MONTHLY_AI_CREDITS} AI credits a month. Your Spaces, notes and history stay in the browser you use — an account carries your plan and allowance, not your data.`,
  },
  {
    q: 'Do I need my own OpenAI API key?',
    a: 'No. That is exactly what we did not want to build. The AI runs on our servers, on our key, metered against your plan. If you would rather nothing left your browser at all, Chrome’s built-in on-device model is still supported as an option — but it is never something you have to set up.',
  },
  {
    q: 'What is a credit?',
    a: 'One AI request, weighted by how much work it is. Asking about a moment or a chat turn costs 1 credit; “Explain this” and “Quiz me” cost 2; a set of notes or a mind map costs 3. Nothing on the page costs a credit until you click something — watching a video never does.',
  },
  {
    q: 'Does it work on videos without captions?',
    a: 'Partly. The learning path, your feed, the course position and chapter-based outlines all work without captions. Notes, explanations and quizzes need a transcript, so on a video with no captions at all FocusSpace says so plainly instead of inventing an answer.',
  },
  {
    q: 'Can it make notes in Hindi?',
    a: 'Yes — English, हिंदी or Hinglish, chosen per note. Technical terms are deliberately left alone: a note in Hindi still says “linked list”, not a transliteration of it, because that is what you will be examined on.',
  },
  {
    q: 'Does FocusSpace see my watch history?',
    a: 'Your history and subscriptions stay in your browser. They are used locally to rank your feed, and they are never sent to our servers. When you click an AI action, what leaves your browser is the current moment: the video title, the concept you are on, your course position and a short transcript window. Not your history, not your subscriptions, not the full transcript.',
  },
  {
    q: 'Will it break or slow down YouTube?',
    a: 'The player itself is never touched. FocusSpace filters with CSS and navigates using YouTube’s own router, so links stay in the same tab and back and forward keep working. It does read the same web API the YouTube page reads for you, which is not a public contract — a large YouTube change can need an update at our end.',
  },
  {
    q: 'How do I cancel?',
    a: 'From your account page, in one click, at any time. You keep the paid plan until the end of the period you already paid for, and then drop to Free — your modes, notes and mind maps all stay where they are.',
  },
];
