import { installHref } from './install';
import { FAQ } from './content/faq';
import { FEATURES } from './content/features';
import { CREDIT_COSTS, PLANS, formatAmountless } from './content/plans-helpers';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT, planById } from './content/plans';

/**
 * The site guide behind the chat bubble.
 *
 * It answers from this site's own content — the FAQ, the feature tabs and the
 * price book — with a small local matcher. No network call, no credit spent,
 * and it works before the API is even deployed. That is a deliberate choice
 * rather than a placeholder: a visitor asking "how much is it" or "do I need
 * an API key" deserves the real answer instantly, and routing that through an
 * LLM would be slower, costlier and less accurate than the text we already
 * wrote.
 *
 * `escalate` is the seam for later: once the deployed API is live, unmatched
 * questions can be forwarded to it instead of returning the fallback.
 */

export interface AssistantAction {
  label: string;
  href: string;
}

export interface AssistantReply {
  text: string;
  actions: AssistantAction[];
}

interface Entry {
  /** Terms that should pull this entry up, beyond the words in its text. */
  keywords: string[];
  title: string;
  body: string;
  actions?: AssistantAction[];
}

const STOP = new Set([
  'a','an','and','are','as','at','be','but','by','can','do','does','for','from','get','has','have','how','i','if','in','is','it','its','me','my','of','on','or','so','that','the','their','them','there','they','this','to','was','what','when','where','which','who','will','with','you','your',
]);

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

const KNOWLEDGE: Entry[] = [
  ...FAQ.map((item) => ({ keywords: tokens(item.q), title: item.q, body: item.a })),
  ...FEATURES.map((f) => ({
    keywords: [f.id, ...tokens(f.label), ...tokens(f.headline)],
    title: f.headline,
    body: `${f.body}\n\n${f.points.map((p) => `• ${p}`).join('\n')}`,
    actions: [{ label: `See ${f.label}`, href: `/#feature-${f.id}` }],
  })),
  {
    keywords: ['price', 'pricing', 'cost', 'plan', 'plans', 'much', 'rupees', 'inr', 'dollar', 'usd', 'subscription', 'pay', 'paid', 'money', 'upi', 'razorpay'],
    title: 'What FocusSpace costs',
    body: `${PLANS.filter((p) => !p.unlisted)
      .map((p) => (p.oneTime ? `${p.name}: ${formatAmountless(p.oneTime)} once. ${p.tagline}` : `${p.name}: ${formatAmountless(p.price!.monthly)} a month. ${p.tagline}`))
      .join('\n')}\n\nMoving up later, you only pay the difference. You can also start free: ${GUEST_SPACE_LIMIT} Spaces without an account, ${FREE_SPACE_LIMIT} with a free account, and a small daily AI allowance. Indian visitors are charged in rupees through UPI or card; the dollar price is the headline everywhere.`,
    actions: [{ label: 'See full pricing', href: '/pricing' }],
  },
  {
    keywords: ['quiz', 'quizzes', 'questions', 'test', 'jev', 'typesafe', 'check', 'checked', 'accurate', 'wrong', 'answer', 'answers', 'mcq'],
    title: 'How Quiz me works, and why you can trust it',
    body: `Quiz me asks on what you have watched so far, or the whole video: five questions for every fifteen minutes, one round at a time. Every question is checked before you see it. Jev, a decision model from TypeSafe, solves each one on its own without seeing the answer. When Jev disagrees or is unsure, a reasoning model traces it step by step: a wrong answer key is corrected, and a question with no right option, or two, is dropped. Code questions are traced exactly as the code runs. Quiz me needs a free account: ${planById('free').limits.quizQuestions} questions a month free, ${planById('basic').limits.quizQuestions} on Basic, ${planById('plus').limits.quizQuestions} on Plus and ${planById('pro').limits.quizQuestions} on Pro, where you also choose Easy, Medium or Hard and keep score.`,
    actions: [{ label: 'See how it works', href: '/#feature-quiz' }],
  },
  {
    keywords: ['model', 'models', 'gpt', 'openai', 'chatgpt', 'gemini', 'claude', 'llm', 'jev', 'which', 'ai', 'powered'],
    title: 'Which AI models FocusSpace uses',
    body: 'Explanations, chat, notes and mind maps run on OpenAI models on our own servers, so you never need a key. Quiz questions are checked by Jev, TypeSafe’s decision model, reached through OpenRouter, with a reasoning model settling the hard cases. Voice uses OpenAI’s speech models. FocusSpace does not use Gemini. If you would rather nothing left your browser, Chrome’s built-in on-device model is also supported.',
    actions: [{ label: 'What leaves your browser', href: '/privacy' }],
  },
  {
    keywords: ['basic', 'lifetime', 'life', 'once', 'forever', '99', 'cheap', 'cheapest', 'one', 'time'],
    title: 'Basic, for life',
    body: `Basic is ${formatAmountless(planById('basic').oneTime!)} once and never expires: ${planById('basic').limits.modes} Spaces, choosing the channels in every Space, ${planById('basic').limits.savedNotes} saved notes and mind maps, and ${planById('basic').limits.aiCreditsPerDay} AI credits a day. It stays on your account underneath any plan you buy later, so when that plan ends you are back on Basic, not Free. New here? Your first month of Plus includes Basic for life.`,
    actions: [{ label: 'See plans', href: '/pricing' }],
  },
  {
    keywords: ['upgrade', 'upgrading', 'switch', 'change', 'difference', 'prorate', 'prorated', 'credit', 'downgrade', 'cancel', 'refund'],
    title: 'Changing plans',
    body: 'Moving up, you only pay the difference: whatever is left of your current plan is taken off the new price, and the new plan starts that day. Basic owners get their first month of Plus for less. Moving down happens when your current period ends, since those days are already paid for. Turning off renewal is one click on your account page, and you keep every day you paid for.',
    actions: [{ label: 'See plans', href: '/pricing' }],
  },
  {
    keywords: ['voice', 'talk', 'speak', 'microphone', 'mic', 'hands', 'free', 'listen', 'aloud', 'dictate'],
    title: 'Talking to FocusSpace',
    body: `Tap Talk and just say it: set up your Spaces, ask about the lecture, switch Space or open a video. FocusSpace listens and answers out loud. A free account includes ${planById('free').limits.voiceMinutes} minutes of voice a month, and paid plans more. We keep only how many seconds you used, never the recording.`,
  },
  {
    keywords: ['credit', 'credits', 'quota', 'allowance', 'limit', 'limits', 'usage'],
    title: 'How credits work',
    body: `One credit is one AI request, weighted by how much work it is:\n${CREDIT_COSTS.map((c) => `• ${c.action}: ${c.credits} credit${c.credits > 1 ? 's' : ''}`).join('\n')}\n\nWatching a video never costs a credit. Nothing is spent until you click an AI action.`,
    actions: [{ label: 'See full pricing', href: '/pricing' }],
  },
  {
    keywords: ['install', 'download', 'chrome', 'extension', 'add', 'setup', 'start', 'begin'],
    title: 'Installing FocusSpace',
    body: 'FocusSpace is a Chrome extension. Add it to Chrome, open YouTube, and it asks you one question: what do you want to focus on. Type it in plain words and your home page is rebuilt around it. Nothing else to configure, no API key, no account needed to start.',
    actions: [{ label: 'Add to Chrome', href: installHref() }],
  },
  {
    keywords: ['mode', 'modes', 'space', 'spaces', 'topic', 'topics', 'subtopic', 'subtopics'],
    title: 'What a mode is',
    body: `A mode is one intention: “DSA”, “System design”, “Punjabi music”. FocusSpace works out the topics, vocabulary and searches that express it, then ranks your subscriptions and the wider YouTube against it. You get ${GUEST_SPACE_LIMIT} without an account, ${FREE_SPACE_LIMIT} with a free account, ${planById('basic').limits.modes} on Basic, ${planById('plus').limits.modes} on Plus, ${planById('pro').limits.modes} on Pro, and unlimited on Max.`,
    actions: [{ label: 'See plans', href: '/pricing' }],
  },
  {
    keywords: ['privacy', 'data', 'history', 'track', 'tracking', 'private', 'safe', 'security'],
    title: 'What leaves your browser',
    body: 'Your watch history, subscriptions and modes stay in your browser and are used locally to rank your feed. When you click an AI action, what leaves is the current moment, the video title, the concept you are on, your course position and a short transcript window, plus, for a chat message, a few short passages from the same video that match your question. Never your history, never your subscriptions, and a request never carries the full transcript.',
  },
];

const FALLBACK: AssistantReply = {
  text: 'I can answer anything about FocusSpace itself: what a mode is, what it costs, how quizzes are checked, which AI it uses, what leaves your browser, or how to install it. Ask me one of those, or have a look around the page.',
  actions: [
    { label: 'See pricing', href: '/pricing' },
    { label: 'Read the FAQ', href: '/#faq' },
  ],
};

/** Suggested openers, shown before the visitor has typed anything. */
export const SUGGESTIONS = ['What is FocusSpace?', 'How much does it cost?', 'How are quizzes checked?', 'What is Basic?'];

function score(entry: Entry, queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const haystack = new Set([...entry.keywords, ...tokens(entry.title), ...tokens(entry.body)]);
  const titleTerms = new Set([...entry.keywords, ...tokens(entry.title)]);
  let total = 0;
  for (const term of queryTokens) {
    // A hit in the question/keywords is worth far more than one buried in the body,
    // so "how much does it cost" finds the pricing entry rather than any paragraph
    // that happens to contain the word "much".
    if (titleTerms.has(term)) total += 3;
    else if (haystack.has(term)) total += 1;
  }
  return total / queryTokens.length;
}

/**
 * Best match, or the fallback. The threshold is deliberately not zero: half an
 * accidental word overlap is not an answer, and a confident wrong answer is
 * worse here than admitting the question was not understood.
 */
export function answer(question: string): AssistantReply {
  const queryTokens = tokens(question);
  let best: Entry | null = null;
  let bestScore = 0;
  for (const entry of KNOWLEDGE) {
    const s = score(entry, queryTokens);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  if (!best || bestScore < 0.5) return FALLBACK;
  return { text: best.body, actions: best.actions ?? [] };
}
