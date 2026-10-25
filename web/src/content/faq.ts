/**
 * Frequently asked questions, in the order a first-time visitor asks them:
 * what is this → do I have to pay or sign in → how does it work → what about
 * my data → how do I stop paying.
 */

import { FREE_DAILY_AI_CREDITS, FREE_SPACE_LIMIT, GUEST_DAILY_AI_CREDITS, GUEST_SPACE_LIMIT } from './plans';
import { EXAMS } from '@/modes/exams';
import { INSTITUTE_LINK, INSTITUTES } from './institutes';

// exams.ts imports only plain B.Tech data and text helpers (runtime); its domain/icon imports are types.
const GOALS = EXAMS.map(exam => exam.label).join(', ');

export interface FaqItem {
  q: string;
  a: string;
  link?: { label: string; to: string };
}

export const FAQ: FaqItem[] = [
  {
    q: 'What is FocusSpace?',
    a: 'A Chrome extension that reorganises YouTube around what you are trying to learn. You tell it a mode, “DSA”, “System design”, “Punjabi music”, and your home page becomes your subscriptions ranked against that intention, with the best of the wider YouTube mixed in and the attention traps removed. On a video it follows the course you are on, breaks the lecture into what it teaches, and turns what you watched into notes and mind maps.',
  },
  {
    q: 'Is FocusSpace free?',
    a: `You can start free. A free account keeps ${FREE_SPACE_LIMIT} Spaces. Ranking, learning paths, the knowledge map and Shorts removal run locally. Hosted AI follows your plan’s allowance; paid plans offer more Spaces and larger allowances. On supported computers, on-device AI uses no hosted credits.`,
  },
  {
    q: 'Do I need an account?',
    a: `No. You can start signed out, with ${GUEST_SPACE_LIMIT} Spaces and ${GUEST_DAILY_AI_CREDITS} AI credits a day. A free account supports ${FREE_SPACE_LIMIT} Spaces and ${FREE_DAILY_AI_CREDITS} AI credits a day, and lets you save to the Library. Your Spaces, notes and history stay in the browser you use; an account carries your plan and allowance, not your data.`,
  },
  {
    q: 'Do I need my own OpenAI API key?',
    a: 'No. That is exactly what we did not want to build. The AI runs on our servers, on our key, metered against your plan. If you would rather nothing left your browser at all, Chrome’s built-in on-device model is still supported as an option, but it is never something you have to set up.',
  },
  {
    q: 'What happens when I move to a bigger plan?',
    a: 'Eligible upgrades credit the unused part of your current plan against the new one. If you own Basic, the eligible Plus upgrade includes a credit and Basic stays yours when the subscription ends. The checkout quote shows your actual charge before you pay.',
  },
  {
    q: 'What is a credit?',
    a: 'An allowance for hosted AI, weighted by how much work the request needs. The pricing page lists the current credit cost for each action. Quiz me is counted separately, in questions; hosted questions are checked by another model. Watching a video never costs a credit.',
    link: { label: 'See credit costs', to: '/pricing' },
  },
  {
    q: 'Does it work on videos without captions?',
    a: 'Partly. The learning path, your feed, the course position and chapter-based outlines all work without captions. Notes, explanations and quizzes need a transcript, so on a video with no captions at all FocusSpace says so plainly instead of inventing an answer.',
  },
  {
    q: 'Can it make notes in Hindi?',
    a: 'Yes: English, हिंदी or Hinglish, chosen per note. Technical terms are deliberately left alone: a note in Hindi still says “linked list”, not a transliteration of it, because that is what you will be examined on.',
  },
  {
    q: 'Does FocusSpace see my watch history?',
    a: 'Your history and subscriptions stay in your browser. They are used locally to rank your feed, and they are never sent to our servers. When you click an AI action, what leaves your browser is the current moment: the video title, the concept you are on, your course position and a short transcript window, and, for a chat message, a few short passages from the same video that match your question. Not your history, not your subscriptions, and a request never carries the full transcript.',
  },
  {
    q: 'Will it break or slow down YouTube?',
    a: 'The player itself is never touched. FocusSpace filters with CSS and navigates using YouTube’s own router, so links stay in the same tab and back and forward keep working. It does read the same web API the YouTube page reads for you, which is not a public contract, a large YouTube change can need an update at our end.',
  },
  {
    q: 'How do I cancel?',
    a: 'From your account page, in one click, at any time. You keep the paid plan until the end of the period you already paid for, and then drop to Free. Your modes, notes and mind maps all stay where they are.',
  },
  {
    q: 'Which exams does FocusSpace support?',
    a: `Goal-based setup includes ${GOALS}. Some goals ask about your exact exam, optional subject, state, branch or year before creating subjects and topics. These are learning maps, not official syllabi. Check the current notification for your exam. Exam bodies do not endorse FocusSpace or any channels shown. You can also create a personal Space for another subject, language or music.`,
  },
  {
    q: 'Can my coaching institute use FocusSpace?',
    a: INSTITUTES.faq,
    link: { label: 'Talk to us about the pilot', to: INSTITUTE_LINK.to },
  },
];
