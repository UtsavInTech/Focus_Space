/**
 * "Your data", in plain language.
 *
 * This is the scannable version of the Privacy page, not a second policy — it sits at the top of
 * /privacy and the detailed sections stay underneath it. The wording is deliberately shorter and less
 * careful-sounding than the policy, because someone deciding whether to install an extension will read
 * five lines and no more.
 *
 * Every line below is checkable against the code, and nothing is claimed that is not:
 *
 * - "stays in the browser" → src/storage/storage.ts writes only to chrome.storage.local; the server has
 *   no route that accepts spaces, notes, history or channels (server/index.ts).
 * - "account" → the users table (server/auth/db.ts): email, optional phone, optional name and city, a
 *   hashed password. Never the password itself (server/auth/passwords.ts).
 * - "payments" → server/billing: plan, period, amount and Razorpay's payment id. Card details go to
 *   Razorpay's own form and never reach us.
 * - "space names" → server/usage/spaces.ts stores ids and names only, to enforce the plan's allowance.
 * - "AI usage" → the usage_events table (server/usage/db.ts): action, units, model and token counts.
 * - "sessions" → the sessions table (server/auth/db.ts), which records a user_agent.
 * - "signed out" → server/usage/service.ts's anonymousKey: a salted hash of the install id or address,
 *   never the address itself, in anon_usage — a table with no user_id at all.
 * - "sent to YouTube" → src/content/data/youtube.ts and src/integrations/youtube/* make the same
 *   requests the page itself makes, from youtube.com, with the visitor's own session.
 * - "sent to AI" → src/learning/context/context.ts builds what leaves the browser; it is a moment, not
 *   a history. On-device AI (src/ai/on-device.ts) sends nothing anywhere.
 *
 * If any of those change, this file changes with them. An overclaim here is worse than silence.
 */

export interface DataGroup {
  id: string;
  title: string;
  /** One line under the heading. */
  summary: string;
  points: string[];
  /** 'local' reads as reassurance, 'sent' as disclosure — the page styles them differently. */
  tone: 'local' | 'sent';
}

export const DATA_GROUPS: DataGroup[] = [
  {
    id: 'browser',
    title: 'Stays on your computer',
    summary: 'The part of FocusSpace you actually use every day never leaves your browser.',
    tone: 'local',
    points: [
      'Your spaces, their topics and the channels you chose for them.',
      'What you watched with Focus Mode on, and how far you got.',
      'Your notes, mind maps and AI conversations.',
      'Your settings, and the feed FocusSpace builds for you.',
    ],
  },
  {
    id: 'account',
    title: 'What we store, if you make an account',
    summary: 'An account is optional. FocusSpace works signed out; an account raises your limits.',
    tone: 'sent',
    points: [
      'Your email address, and your phone number, name or city only if you add them yourself.',
      'Your password, as a hash we cannot reverse. We never see the password itself.',
      'Your sessions, so you stay signed in and can sign out. Each one records the browser it was started from.',
      'Your plan, and your AI usage: which kind of action you ran, the credits it cost, the model, and the token counts the provider reported back. Never your prompts or the answers.',
      'Payments: the plan, the amount and Razorpay’s payment reference, so we can show you a receipt. Card and UPI details go straight to Razorpay and never reach us.',
      'The names of your spaces, so your plan’s space limit can be applied wherever you sign in. Not what is in them.',
    ],
  },
  {
    id: 'youtube',
    title: 'What goes to YouTube',
    summary: 'The same requests the YouTube page already makes, from YouTube, using your own session.',
    tone: 'sent',
    points: [
      'Searches FocusSpace runs for your space, and the details of the video you are watching.',
      'Your subscriptions, when you choose to import them.',
      'While you are signed in to YouTube, your history and recommendations, so your feed can be ranked.',
      'None of this is copied to us. It is read in your browser and used there.',
    ],
  },
  {
    id: 'ai',
    title: 'What goes to the AI',
    summary: 'Only when you ask for an explanation, a quiz, notes, a mind map or a chat message.',
    tone: 'sent',
    points: [
      'The moment you asked about: the video’s title and channel, your timestamp, the nearby outline, your space and topic names, a short stretch of the transcript, and your question.',
      'For a chat message, also up to three short passages from elsewhere in the same video that match your question. Your browser picks them; the transcript is not uploaded to find them.',
      'To outline a video no one has outlined yet, its captions are sent once. Only the outline is kept, and it is shared with everyone watching that video.',
      'Not your watch history, not your other videos. A request never carries the whole transcript.',
      'OpenAI processes it for us. We do not keep your prompts or the answers.',
      'Quiz me questions are checked by a second model, reached through OpenRouter, before you see them. It receives each question and the stretch of transcript it came from. We keep only how many questions you were shown.',
      'Once a day at most, that this install was used (a random id, kept only as a hash), so we can count active users. Nothing about what you watched, and it can be turned off in Settings.',
      'Voice, only when you talk to FocusSpace: your recording is turned into text, and replies into speech, by OpenAI. We keep only how many seconds you used, never the recording or what was said.',
      'If your computer supports Chrome’s built-in on-device AI, you can use that instead. Then nothing leaves your browser at all.',
      'Signed out, a request also sends a random id the extension made up when you installed it, so your small daily free allowance is yours rather than your whole network’s. It is not linked to you, and the server keeps only a hashed counter against it.',
    ],
  },
];

/**
 * The whole of DATA_GROUPS in three lines, for /data (DataPage.tsx), which is read in seconds. Each line
 * compresses a group above and claims nothing it does not: 'browser', 'ai', and 'account' in turn.
 */
export const DATA_DOES: string[] = [
  'Keeps your Spaces, notes, mind maps and history in your browser.',
  'Sends the AI only the moment you ask about, never your history or subscriptions.',
  'Stores your account and plan only if you sign in.',
];

/** Stated as plainly as the rest, because "we don't do X" is the part people most want to hear. */
export const DATA_NEVER: string[] = [
  'We do not sell your data, and there is no advertising in FocusSpace.',
  'There is no analytics or tracking in the extension.',
  'Watching a video sends us nothing. Nothing in the playback path touches our servers.',
  'We cannot read your spaces, notes or history. They are not on our servers to read.',
];
