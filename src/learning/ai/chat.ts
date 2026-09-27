import type { ChatMessage } from '@/types/chat';
import type { LearningContext } from '../context/context';
import { contextBlock, LANGUAGE_RULE, SYSTEM as ACTION_SYSTEM, type AiPrompt } from './actions';
import { isHomepageContext, type HomepageContext } from './homepage-context';
import { outlineBlock } from '../outline/outline';
import { formatTimestamp } from '../knowledge/timestamps';

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
  "This is an ongoing conversation next to the video. Use earlier turns for continuity. A question is about the current moment described below unless the learner asks about another part of the video, they may have moved on since their last message.",
  'Answer the technical or academic question the learner actually asked. Only answer questions about the video/course structure, playlist position or navigation when the learner explicitly asks about those, otherwise stay on the subject matter.',
  'Evidence, by kind of question: for the current moment, the transcript excerpt under "Being taught now" is the primary evidence. For something said at another point in the video, use the excerpts under "From elsewhere in this video" when they are given, they are the instructor\'s own words. For what the video covers as a whole, a summary, what comes later, use the whole-video outline when it is given, and give the time range of each part you point to. It is machine-made and lists topics only: where it and an excerpt disagree about when something is taught, trust the excerpt.',
  'When the learner asks where or when something is taught and it comes up in more than one place, name each place with its time.',
  'Only say the video says something when these excerpts or the outline support it. If they do not cover what the learner asks about the video, say so plainly instead of guessing. A general question about the subject you may still answer from your own knowledge.',
  'Write every timestamp in square brackets: [mm:ss], or [mm:ss–mm:ss] for a span, with hours when the video has them ([1:02:05]). Use only times given in this context, an excerpt, an outline section, the current timestamp, and never invent or estimate one. When you use an excerpt, give its time, as part of the sentence ("he explains this at [1:18:08]"). Never mention excerpts, passages, the outline or this context to the learner, speak about the video.',
].join(' ');

const HOMEPAGE_SYSTEM = [
  'You are FocusSpace, an AI companion built into YouTube. You help people learn from YouTube: you can recommend what to watch from what is on their page, explain concepts in their subject, and suggest what to learn next.',
  'The learner is on a YouTube page, not watching a specific video. You are given a compact, structured summary of what FocusSpace can see there: their space, category chips, the videos on the page, and, when known, their subscriptions.',
  'When recommending a video, recommend only ones in that list, using only the title, channel and metadata given. Never claim to know what a video shows or says beyond that metadata, and never invent a video that is not listed.',
  // Without this, an empty list turned every message — including "hi" — into "there are no videos
  // available", which is a non-answer to a question nobody asked.
  'Everything else you may answer normally, from your own knowledge: greetings, questions about their subject, questions about what FocusSpace does, study plans, and how to approach a topic. The video list limits what you may *recommend*, not what you may talk about.',
  'If the list of videos is empty, do not announce that. Answer the question that was actually asked, and only mention the empty page if the learner specifically asked you to pick something from it, then say the page has nothing you can see yet and offer to help another way.',
  'If the learner only greets you, greet them back in one line and say concretely what you can do for them in this space, do not list your limitations.',
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

/** The API's ceiling on the whole user message (server/validate.ts MAX_PROMPT_USER_CHARS). */
const MAX_USER_CHARS = 24_000;

/** Passages found elsewhere in the video for this question (knowledge/passages.ts), each with its time. */
function relatedBlock(context: LearningContext): string {
  const passages = context.relatedPassages ?? [];
  if (!passages.length) return '';
  const kind = context.transcriptSource === 'asr' ? ' (auto-generated captions, technical terms and names may be misheard)' : '';
  const lines = passages.map((p) => `[${formatTimestamp(p.startSec)}–${formatTimestamp(p.endSec)}]\n"""${p.text}"""`);
  return [`[From elsewhere in this video — transcript passages that match the question${kind}]`, ...lines].join('\n\n');
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
        .map((v) => `${v.position}. "${v.title}", ${v.channelTitle}${v.durationSec ? `, ${Math.round(v.durationSec / 60)} min` : ''}${v.views !== null ? `, ${v.views} views` : ''}${v.publishedText ? `, ${v.publishedText}` : ''} (${v.reason})`)
        .join('\n')
    : 'FocusSpace cannot see any videos on this page yet, the feed may still be loading, or Focus Mode may be off. This is not something to report unless the learner asks for a recommendation from this page.';
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
  const assemble = (related: string) => {
    const parts = [contextBlock(context), related, outline, historyBlock(history), `Learner's question: "${question.trim().slice(0, MAX_QUESTION_CHARS)}"`].filter(Boolean);
    return `${parts.join('\n\n')}\n\nTask: Answer the learner's question above.${language}`;
  };
  const withRelated = assemble(relatedBlock(context));
  // The passages are an extra, never the reason a turn is refused: a long conversation that leaves no room for them goes without.
  return { system: CHAT_SYSTEM, user: withRelated.length <= MAX_USER_CHARS ? withRelated : assemble('') };
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChatMessage(role: ChatMessage['role'], text: string, videoId: string, currentTime: number, voice = false): ChatMessage {
  return { id: randomId(), role, text, at: Date.now(), videoId, currentTime: Math.round(currentTime), voice };
}
