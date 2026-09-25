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
    body: `${PLANS.filter((p) => p.id !== 'free')
      .map((p) => `${p.name} — ${formatAmountless(p.price.monthly)} a month. ${p.tagline}`)
      .join('\n')}\n\nFree stays free: ${GUEST_SPACE_LIMIT} Spaces without an account, ${FREE_SPACE_LIMIT} with a free account, and a monthly AI allowance. Indian visitors are charged in rupees through UPI or card; the dollar price is the headline everywhere.`,
    actions: [{ label: 'See full pricing', href: '/pricing' }],
  },
  {
    keywords: ['credit', 'credits', 'quota', 'allowance', 'limit', 'limits', 'usage'],
    title: 'How credits work',
    body: `One credit is one AI request, weighted by how much work it is:\n${CREDIT_COSTS.map((c) => `• ${c.action} — ${c.credits} credit${c.credits > 1 ? 's' : ''}`).join('\n')}\n\nWatching a video never costs a credit. Nothing is spent until you click an AI action.`,
    actions: [{ label: 'See full pricing', href: '/pricing' }],
  },
  {
    keywords: ['install', 'download', 'chrome', 'extension', 'add', 'setup', 'start', 'begin'],
    title: 'Installing FocusSpace',
    body: 'FocusSpace is a Chrome extension. Add it to Chrome, open YouTube, and it asks you one question: what do you want to focus on. Type it in plain words and your home page is rebuilt around it. Nothing else to configure — no API key, no account needed to start.',
    actions: [{ label: 'Add to Chrome', href: installHref() }],
  },
  {
    keywords: ['mode', 'modes', 'space', 'spaces', 'topic', 'topics', 'subtopic', 'subtopics'],
    title: 'What a mode is',
    body: `A mode is one intention — “DSA”, “System design”, “Punjabi music”. FocusSpace works out the topics, vocabulary and searches that express it, then ranks your subscriptions and the wider YouTube against it. You get ${GUEST_SPACE_LIMIT} without an account, ${FREE_SPACE_LIMIT} with a free account, ${planById('pro').limits.modes} on Pro, and unlimited on Unlimited and Max.`,
    actions: [{ label: 'See plans', href: '/pricing' }],
  },
  {
    keywords: ['privacy', 'data', 'history', 'track', 'tracking', 'private', 'safe', 'security'],
    title: 'What leaves your browser',
    body: 'Your watch history, subscriptions and modes stay in your browser and are used locally to rank your feed. When you click an AI action, what leaves is the current moment — the video title, the concept you are on, your course position and a short transcript window. Never your history, never your subscriptions, never the full transcript.',
  },
];

const FALLBACK: AssistantReply = {
  text: 'I can answer anything about FocusSpace itself — what a mode is, what it costs in dollars or rupees, how credits work, what leaves your browser, or how to install it. Ask me one of those, or have a look around the page.',
  actions: [
    { label: 'See pricing', href: '/pricing' },
    { label: 'Read the FAQ', href: '/#faq' },
  ],
};

/** Suggested openers, shown before the visitor has typed anything. */
export const SUGGESTIONS = ['What is FocusSpace?', 'How much does it cost?', 'Do I need an API key?', 'What is a mode?'];

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
