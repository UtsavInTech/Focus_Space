/**
 * Privacy, Terms, Refunds and Contact.
 *
 * Written from what the product actually does, not from a template: every
 * claim here is checkable against the code (what leaves the browser is
 * `LearningContext`/`HomepageContext`, what the server stores is the `users`,
 * `sessions`, `usage_events`, `spaces` and `payments` tables, and spaces and
 * subscriptions genuinely never leave `chrome.storage.local`). A privacy
 * policy that overclaims is worse than none, because it is the one document
 * people quote back at you.
 *
 * Razorpay requires Privacy, Terms, Refunds and Contact pages to be live for
 * account activation, and the Chrome Web Store requires a privacy policy URL —
 * which is why these exist now rather than later.
 *
 * Not legal advice. These are honest descriptions of behaviour that a lawyer
 * should review before they are relied on commercially.
 */

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  slug: string;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}

const UPDATED = '19 September 2026';
const CONTACT = 'hello@focusspace.xyz';

export const PRIVACY: LegalDoc = {
  slug: '/privacy',
  title: 'Privacy',
  updated: UPDATED,
  intro:
    'FocusSpace is built so that most of what it knows about you never leaves your browser. This page describes exactly what stays local, what is sent, and what we store.',
  sections: [
    {
      heading: 'What stays in your browser',
      body: [
        'Your spaces, topics, channel list, watch progress, saved notes, mind maps and settings are stored by the extension in Chrome’s local storage on your own machine. They are not uploaded to us, and we cannot read them.',
        'The account page on this website shows your spaces and settings by asking the extension for them directly, in your browser. That data reaches the page; it does not reach our servers.',
        'Your YouTube watch history and subscriptions are read on youtube.com, by your own signed-in session, to rank your feed. They are used locally and never transmitted to us.',
      ],
    },
    {
      heading: 'What is sent to us, and when',
      body: [
        'Only when you click an AI action — Explain, Quiz me, Make Notes, a mind map, or a chat message — and only the context of that moment: the video title and channel, your position in it, the concept you are on, the names of nearby concepts, your space and topic names, and a short window of the transcript around that moment.',
        'Never sent: your watch history, your subscriptions, your other videos, the full transcript, or the contents of any page you are not asking about.',
        'Watching a video sends nothing. Nothing in the playback path contacts our servers.',
      ],
    },
    {
      heading: 'What we store on our servers',
      body: [
        'Your account: email address, and phone, name and city if you provide them. Passwords are stored only as a salted hash and are never recoverable.',
        'Your sessions, so you stay signed in, and so you can sign out.',
        'Usage records: which kind of AI action you ran, what it cost in credits, when, and the token counts reported back to us. We do not store your prompts, the transcripts sent with them, or the answers produced.',
        'Payments: the plan, period, amount, and the payment identifier from Razorpay. We never see or store your card number, UPI ID or bank details — those go directly to Razorpay.',
        'The names and identifiers of spaces you create while signed in, so your plan’s space allowance can be enforced. The contents of those spaces stay in your browser.',
      ],
    },
    {
      heading: 'Who else is involved',
      body: [
        'OpenRouter processes AI requests on our behalf and receives the moment context described above.',
        'Razorpay processes payments and receives whatever you enter into its own payment form.',
        'Resend delivers verification emails and receives your email address.',
        'Railway hosts the service and stores our database.',
        'We do not sell your data, and there is no advertising or analytics tracking in the extension.',
      ],
    },
    {
      heading: 'Your choices',
      body: [
        'You can use FocusSpace fully signed out. Most of it — spaces, ranking, the learning path, the knowledge map — never needed an account.',
        'You can turn Focus Mode off at any time, which leaves YouTube exactly as it was.',
        'You can delete your account by writing to us, and we will remove your account, sessions, usage records and space records. Payment records are kept where tax law requires.',
        'Uninstalling the extension removes everything it stored in your browser.',
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  slug: '/terms',
  title: 'Terms',
  updated: UPDATED,
  intro: 'The agreement between you and FocusSpace. Plain language, because you should be able to read it.',
  sections: [
    {
      heading: 'What FocusSpace is',
      body: [
        'FocusSpace is a Chrome extension and accompanying website that reorganises how YouTube looks to you and adds AI study tools on top of what you watch.',
        'FocusSpace is not affiliated with, endorsed by, or connected to YouTube or Google. It works alongside YouTube using the same public interfaces your browser already uses, and YouTube’s own terms continue to apply to your use of YouTube.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'You are responsible for keeping your password safe and for activity under your account.',
        'One account is for one person. You may not resell access or share an account with others.',
        'We may suspend an account that is being used to abuse the service, attack it, or evade usage limits.',
      ],
    },
    {
      heading: 'Plans and payment',
      body: [
        'Paid plans grant access for the period you buy — one month or twelve months — starting when the payment succeeds. Access does not renew automatically; when the period ends, the account returns to the Free plan and nothing is deleted.',
        'Prices are shown in US dollars and, for customers in India, charged in Indian rupees through Razorpay. The rupee amount shown at checkout is what you are charged.',
        'We may change prices, but never for a period you have already paid for.',
        'AI allowances are counted in credits and reset each calendar month. Unused credits do not carry over.',
      ],
    },
    {
      heading: 'What we do not promise',
      body: [
        'AI output can be wrong. FocusSpace labels it as such. Do not rely on it as your only source for anything that matters — an exam, an interview, or a decision.',
        'FocusSpace depends on YouTube’s website continuing to work the way it currently does. A large change at YouTube’s end can break features until we update.',
        'The service is provided as is. We do not guarantee uninterrupted availability.',
      ],
    },
    {
      heading: 'Ending it',
      body: [
        'You can stop using FocusSpace at any time by uninstalling the extension, and ask us to delete your account whenever you want.',
        'We may end service with notice, and will refund the unused part of a paid period if we do.',
        'These terms are governed by the laws of India.',
      ],
    },
  ],
};

export const REFUNDS: LegalDoc = {
  slug: '/refunds',
  title: 'Refunds and cancellation',
  updated: UPDATED,
  intro: 'What happens if you change your mind, and how to cancel.',
  sections: [
    {
      heading: 'Cancelling',
      body: [
        'There is nothing to cancel. Plans do not renew automatically: a paid plan runs for the period you bought and then stops. You will not be charged again unless you choose to buy again.',
        'Your spaces, notes and mind maps are not deleted when a plan ends. They are in your browser, where they always were.',
      ],
    },
    {
      heading: 'Refunds',
      body: [
        'If you are unhappy within 7 days of a payment and have used only a small part of your AI credits for that period, write to us and we will refund it in full.',
        'After 7 days, or once a substantial part of the period’s credits has been used, we refund the unused portion at our discretion.',
        'If FocusSpace is unavailable for an extended period through our fault, we refund that time whether or not you ask.',
        'If you were charged twice for the same thing, tell us and we will return the duplicate immediately — no questions.',
      ],
    },
    {
      heading: 'How long it takes',
      body: [
        'We approve refunds within 3 working days of hearing from you.',
        'Razorpay then returns the money to the original payment method, which typically takes a further 5 to 7 working days depending on your bank.',
        `To request one, email ${CONTACT} with the payment identifier shown on your account page.`,
      ],
    },
  ],
};

export const CONTACT_DOC: LegalDoc = {
  slug: '/contact',
  title: 'Contact',
  updated: UPDATED,
  intro: 'A real person reads these.',
  sections: [
    {
      heading: 'Get in touch',
      body: [
        `Email: ${CONTACT}`,
        'For anything about a payment, include the payment identifier from your account page — it makes it far quicker to find.',
        'For a bug, telling us the video you were on and what you expected to happen is usually enough for us to reproduce it.',
      ],
    },
    {
      heading: 'Response times',
      body: ['We aim to reply within two working days.', 'Refund requests are handled within three working days.'],
    },
  ],
};

export const LEGAL_DOCS: Record<string, LegalDoc> = {
  '/privacy': PRIVACY,
  '/terms': TERMS,
  '/refunds': REFUNDS,
  '/contact': CONTACT_DOC,
};
