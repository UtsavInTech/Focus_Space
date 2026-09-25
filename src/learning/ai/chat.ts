import type { ChatMessage } from '@/types/chat';
import type { LearningContext } from '../context/context';
import { contextBlock, LANGUAGE_RULE, SYSTEM as ACTION_SYSTEM, type AiPrompt } from './actions';
import { isHomepageContext, type HomepageContext } from './homepage-context';
import { outlineBlock } from '../outline/outline';

/**
 * Multi-turn chat — the same context pipeline as the five point actions
 * (`contextBlock`, the same honesty/grounding `SYSTEM` rules) when there is
 * a real video (`LearningContext`), or the compact `HomepageContext` when
 * there isn't — never a second "AI brain", and never the video pipeline
 * mistakenly applied to a page that isn't a video (see homepage-context.ts).
 * The only thing chat adds on top of either is the recent-turns history
 * folded into the prompt; there is no separate provider call shape
 * (`AiProvider.complete` is unchanged — see service.ts's `chat()`, which
 * reuses the exact same provider-pick and usage-recording code as `run()`).
 *
 * Voice is this same pipeline with `voice: true` on the turn — see voice.ts.
 */

const CHAT_SYSTEM = [
  ACTION_SYSTEM,
  "This is an ongoing conversation next to the video. Use earlier turns for continuity, but always answer about the current moment described below — the learner may have moved on since their last message.",
  'Answer the technical or academic question the learner actually asked. Only answer questions about the video/course structure, playlist position or navigation when the learner explicitly asks about those — otherwise stay on the subject matter.',
  'When a whole-video outline is given, use it for questions about the video as a whole — what it covers, where or when a topic is taught, what comes later, a summary — and give the time range (mm:ss–mm:ss) of each part you point to. It lists topics only; for what is said at the current moment, the transcript excerpt is the evidence.',
].join(' ');

const HOMEPAGE_SYSTEM = [
  'You are FocusSpace, an AI companion built into YouTube. You help people learn from YouTube: you can recommend what to watch from what is on their page, explain concepts in their subject, and suggest what to learn next.',
  'The learner is on a YouTube page, not watching a specific video. You are given a compact, structured summary of what FocusSpace can see there: their space, category chips, the videos on the page, and — when known — their subscriptions.',
  'When recommending a video, recommend only ones in that list, using only the title, channel and metadata given. Never claim to know what a video shows or says beyond that metadata, and never invent a video that is not listed.',
  // Without this, an empty list turned every message — including "hi" — into "there are no videos
  // available", which is a non-answer to a question nobody asked.
  'Everything else you may answer normally, from your own knowledge: greetings, questions about their subject, questions about what FocusSpace does, study plans, and how to approach a topic. The video list limits what you may *recommend*, not what you may talk about.',
  'If the list of videos is empty, do not announce that. Answer the question that was actually asked, and only mention the empty page if the learner specifically asked you to pick something from it — then say the page has nothing you can see yet and offer to help another way.',
  'If the learner only greets you, greet them back in one line and say concretely what you can do for them in this space — do not list your limitations.',
  'If they ask about something the context genuinely does not cover, say so plainly instead of guessing.',
  'Be concise and concrete.',
].join(' ');

/**
 * With no response language chosen (the 'en' default), a chat answers in the language the learner asked
 * in — a question in Hindi gets Hindi back, one in English gets English — whatever the transcript is in.
 * An explicit Hindi/Hinglish setting (LANGUAGE_RULE) still wins.
 */
const REPLY_IN_ASKED_LANGUAGE = "Reply in the language the learner's question is written in (English, Hindi, Hinglish or any other). Keep technical terms in their usual English form.";
const EVEN_IF_TRANSCRIPT_DIFFERS = ' This holds even when the transcript is in a different language.';

/** The API's own ceiling (server/validate.ts MAX_QUESTION_CHARS); the composer allows the same. */
const MAX_QUESTION_CHARS = 2000;

function languageLine(language: LearningContext['language'], hasTranscript: boolean): string {
  return `\n\n${LANGUAGE_RULE[language] || REPLY_IN_ASKED_LANGUAGE + (hasTranscript ? EVEN_IF_TRANSCRIPT_DIFFERS : '')}`;
}

/** Enough for continuity without letting a long conversation balloon the prompt. */
const MAX_HISTORY_TURNS = 6;

function historyBlock(history: ChatMessage[]): string {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  if (!recent.length) return '';
  const lines = recent.map((m) => `${m.role === 'learner' ? 'Learner' : 'FocusSpace'}: ${m.text}`);
  return ['[Earlier in this conversation]', ...lines].join('\n');
}

function homepageBlock(context: HomepageContext): string {
  const lines = [
    `Space: ${context.spaceName}`,
    context.activeCategory ? `Selected category: ${context.activeCategory}` : '',
    context.categoryChips.length ? `Categories here: ${context.categoryChips.join(', ')}` : '',
  ].filter(Boolean);
  const videos = context.visibleVideos.length
    ? context.visibleVideos
        .map((v) => `${v.position}. "${v.title}" — ${v.channelTitle}${v.durationSec ? `, ${Math.round(v.durationSec / 60)} min` : ''}${v.views !== null ? `, ${v.views} views` : ''}${v.publishedText ? `, ${v.publishedText}` : ''} (${v.reason})`)
        .join('\n')
    : 'FocusSpace cannot see any videos on this page yet — the feed may still be loading, or Focus Mode may be off. This is not something to report unless the learner asks for a recommendation from this page.';
  const subs = context.visibleSubscriptions.length ? `Subscriptions FocusSpace knows about: ${context.visibleSubscriptions.map((s) => s.channelTitle).join(', ')}` : 'Subscription data is not available here.';
  return [...lines, '', 'Videos currently relevant here:', videos, '', subs].join('\n');
}

function buildHomepageChatPrompt(context: HomepageContext, history: ChatMessage[], question: string): AiPrompt {
  const language = languageLine(context.language, false);
  const parts = [homepageBlock(context), historyBlock(history), `Learner's question: "${question.trim().slice(0, MAX_QUESTION_CHARS)}"`].filter(Boolean);
  return { system: HOMEPAGE_SYSTEM, user: `${parts.join('\n\n')}\n\nTask: Answer the learner's question above. Any video you recommend must come from the list; everything else, answer normally.${language}` };
}

export function buildChatPrompt(context: LearningContext | HomepageContext, history: ChatMessage[], question: string): AiPrompt {
  if (isHomepageContext(context)) return buildHomepageChatPrompt(context, history, question);
  const language = languageLine(context.language, !!context.transcriptWindow);
  const outline = context.videoOutline?.length ? outlineBlock(context.videoOutline, context.currentTime) : '';
  const parts = [contextBlock(context), outline, historyBlock(history), `Learner's question: "${question.trim().slice(0, MAX_QUESTION_CHARS)}"`].filter(Boolean);
  return { system: CHAT_SYSTEM, user: `${parts.join('\n\n')}\n\nTask: Answer the learner's question above.${language}` };
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChatMessage(role: ChatMessage['role'], text: string, videoId: string, currentTime: number, voice = false): ChatMessage {
  return { id: randomId(), role, text, at: Date.now(), videoId, currentTime: Math.round(currentTime), voice };
}
