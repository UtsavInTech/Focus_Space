/**
 * What FocusSpace actually stores and sends, as data rather than prose.
 *
 * Account and Settings both answer "what do you know about me", and they used to answer it in their own
 * words — which is how one of them came to say FocusSpace uses your *name* to sign you in (it does not;
 * name and city are profile fields and nothing reads them but the greeting on Home). One list, rendered
 * twice, cannot drift.
 *
 * Every line is traced to the code that makes it true. If a column is added to one of these tables, the
 * fact belongs here before the feature ships:
 *
 *   users            server/auth/db.ts   email, phone, password hash, email_verified, name, city
 *   sessions         server/auth/db.ts   refresh-token hash, user agent, timestamps
 *   verifications    server/auth/db.ts   6-digit codes, stored only as keyed hashes
 *   entitlements     server/usage/db.ts  plan, expiry, auto-renew, payment/subscription id
 *   payments         server/usage/db.ts  plan, period, currency, amount, status, Razorpay order id
 *   usage_events     server/usage/db.ts  action kind, credits, model, prompt/completion token counts
 *   spaces           server/usage/db.ts  space id and name only — never their contents
 *   anon_usage       server/usage/db.ts  signed out: a salted hash of the install id or address
 *
 * And what never reaches a server at all: everything written through src/storage/storage.ts, which only
 * ever writes chrome.storage.local — Spaces and their contents, notes, mind maps, chats, watch history,
 * the channel library and settings. No route in server/index.ts accepts any of them.
 */

export interface DataFact {
  id: string;
  /** The heading: what is held. */
  label: string;
  /** Why, in one sentence a learner can check against their own experience. */
  detail: string;
}

/** Held on FocusSpace's server, and only once an account exists. Order: most personal first. */
export const ACCOUNT_DATA_FACTS: readonly DataFact[] = [
  {
    id: 'identity',
    label: 'Your email address, and a hash of your password',
    detail: 'How you sign in. The password itself is never stored, and verification codes are kept only as hashes.',
  },
  {
    id: 'profile',
    label: 'Your phone number, name and city — only if you add them',
    detail: 'All optional, all blank until you fill them in, and shown only to you.',
  },
  {
    id: 'sessions',
    label: 'Your sessions',
    detail: 'So you stay signed in, and can sign out. Each one records the browser it was started from.',
  },
  {
    id: 'plan',
    label: 'Your plan and what you have paid',
    detail: 'The plan, period, amount and Razorpay’s payment reference, so your receipts are here. Card and UPI details go straight to Razorpay and never reach us.',
  },
  {
    id: 'usage',
    label: 'Your AI usage',
    detail: 'Which kind of action you ran, the credits it cost, the model, and the token counts the provider reported. Never your prompts or the answers.',
  },
  {
    id: 'spaces',
    label: 'The names of your Spaces',
    detail: 'Names and ids only, so your plan’s Space limit applies wherever you sign in. Never what is in them.',
  },
];

/** The part that needs no account, and never leaves the browser. */
export const LOCAL_DATA_SUMMARY =
  'Your Spaces and everything in them, your notes, mind maps and AI chats, what you watched, your channel choices and your settings all stay in this browser. FocusSpace cannot read them — they are never uploaded.';

/** What one AI request carries. `who` is the endpoint's own name, so the sentence names what it talks to. */
export const aiDataSummary = (who: string): string =>
  `${who} receives only the moment you ask about: the video and channel, your timestamp, the nearby outline, your Space and topic names, a short transcript excerpt and your question. Never your history, and never the whole transcript.`;

/** Signed out, the AI still has to be metered somehow — and this is the whole of how. */
export const ANONYMOUS_AI_SUMMARY =
  'Signed out, an AI request sends a random id this install made up, so your daily free allowance is yours rather than your whole network’s. It is not linked to you, and the server keeps only a hashed counter.';
