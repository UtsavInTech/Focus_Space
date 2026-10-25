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

const UPDATED = '27 September 2026';
export const CONTACT = 'utsav.udk@gmail.com';

export const PRIVACY: LegalDoc = {
  slug: '/privacy',
  title: 'Privacy',
  updated: '25 October 2026',
  intro:
    'FocusSpace is built so that most of what it knows about you never leaves your browser. This page describes exactly what stays local, what is sent, and what we store.',
  sections: [
    {
      heading: 'What stays in your browser',
      body: [
        'Your personal Spaces, their topics and channel lists, personal watch progress, saved notes, mind maps and settings stay in Chrome’s local storage on your computer. Joining an institute course is a separate choice; its enrolment, phone and course progress handling are described below. Your personal Spaces and their history are never shared with an institute.',
        'The account page on this website shows your spaces and settings by asking the extension for them directly, in your browser. That data reaches the page; it does not reach our servers.',
        'Your YouTube watch history and subscriptions are read on youtube.com, by your own signed-in session, to rank your feed. They are used locally and never transmitted to us.',
      ],
    },
    {
      heading: 'What is sent to us, and when',
      body: [
        'Only when you click an AI action (Explain, Quiz me, Make Notes, a mind map, or a chat message), and only the context of that moment: the video title and channel, your position in it, the concept you are on, the names of nearby concepts, your space and topic names, and a short window of the transcript around that moment.',
        'For a chat message, also up to three short passages from elsewhere in the same video that match your question, about 1,800 characters in all. Your browser picks them from the captions it already has; the transcript is not uploaded to find them.',
        'For an outline of the whole video, which chat and notes use: when you open FocusSpace AI on a video that has no outline yet, the extension sends that video’s captions, shortened for long videos, once. We keep only the resulting outline, which anyone watching the same video then gets; the captions themselves are not stored.',
        'Never sent: your watch history, your subscriptions, your other videos, or the contents of any page you are not asking about. An AI action or chat message never carries the full transcript.',
        'Only when you use voice (Talk, the microphone button, or reading an answer aloud): the recording of what you say is sent to us and on to OpenAI to turn it into text, and the text of a reply is sent to OpenAI to turn it into speech. Your microphone is used only after you tap Talk or the microphone, and Chrome asks you for it first.',
        'When you set up with the guide, what you type or say to it, and the names of your spaces and their creators, are sent so it can work out which spaces and channels to create.',
        'Once a day at most, on a day you use FocusSpace on YouTube, the extension tells us that this install was used, with its random install identifier, whether you are signed in, and the names of any FocusSpace features a change on YouTube broke that day. Nothing about what you watched. It is how we count how many people use FocusSpace and whether they come back, and you can turn it off in Settings, under Your data.',
        'Watching a video in a personal Space sends no institute progress. Institute-course milestone handling is described below.',
      ],
    },
    {
      heading: 'What we store on our servers',
      body: [
        'Your account: email address, and phone, name and city if you provide them. Passwords are stored only as a salted hash and are never recoverable.',
        'Your sessions, so you stay signed in, and so you can sign out. Each session records the browser it was started from, so you can tell them apart.',
        'Usage records: which kind of AI action you ran, what it cost in credits, when, the model that answered, and the token counts reported back to us. We do not store your prompts, the transcripts sent with them, or the answers produced.',
        'If you use the AI signed out: a random identifier the extension generated at install, kept only as a salted hash alongside a daily counter, so the free allowance can be shared out fairly. It is not connected to any account, and your IP address is never stored.',
        'Payments: the plan, period, amount, and the payment identifier from Razorpay. We never see or store your card number, UPI ID or bank details. Those go directly to Razorpay.',
        'The names and identifiers of spaces you create while signed in, so your plan’s space allowance can be enforced. The contents of those spaces stay in your browser.',
        'Active-use counts: a salted hash of the install identifier and the dates it was used. It cannot be linked to your account, your address or anything you watched, and it is used only to count daily, weekly and monthly users.',
        'Voice usage: how many seconds of voice you used each month, so your plan’s voice allowance applies (signed out, against the same hashed install identifier). We never keep the recordings, or what was said.',
        'Quiz usage: how many Quiz me questions you were shown each month, so your plan’s quiz allowance applies. Not the questions, and not your answers.',
      ],
    },
    {
      heading: 'Institute courses and your choices',
      body: ['If you join an institute course, we store your account id, the institute and course or batch you joined, your join/leave dates, and your Indian mobile number, which you verify by SMS code before joining. When you join, the institute receives your name and this number so its faculty can contact you about its courses; the join page says so before you join, and we record which version of that notice you saw. FocusSpace does not show your number to anyone else, and we do not obtain phone numbers from YouTube subscribers, viewers or comments.', 'Two further choices are yours and start off: sharing your progress, and asking the institute to contact you (“Yes, contact me”), which puts you at the top of its list and notifies it straight away; the “Talk to your faculty” button does the same and can carry a short message. We record each choice with the notice version and the time you give or withdraw it. Videos, the course path, quizzes and notes remain available when both are off.', 'Institute-course milestones (started, half and completed) are sent to our server so enrolled students can be counted in course totals. Without progress sharing, we do not store progress or quiz scores in an identified student record. Private keyed receipts deduplicate the totals and keep completed-video quizzes usable. These receipts are pseudonymous internal counters, not a claim of irreversible anonymisation, and are not shown to the institute.', 'With progress sharing on, your institute can also see the institute-course videos you watched, how far into each, the time you spent in them, when you studied, and your institute quiz and Quiz me scores. Personal Spaces, personal videos, subscriptions, notes, mind maps and AI conversations are never included in institute reporting.', 'You can withdraw either choice at any time through your account’s course page. A “Withdraw institute sharing” control in the extension turns both off. Withdrawing progress sharing deletes your identified institute progress and quiz-score rows; it does not remove aggregate totals. Withdrawing “contact me” closes any open request. Your name and number stay with the institute while you are enrolled; leaving the course stops them being shared from then on. We cannot retract a list that an institute already downloaded. Leaving a course removes its Space; leaving your last course with an institute withdraws both choices for that institute.', 'Institute courses are cached locally for offline reading. Course refresh and enrolment checks require a connection; an explicit server refusal removes inaccessible cached course content. Personal learning data is not sent by institute reporting.'],
    },
    {
      heading: 'Who else is involved',
      body: [
        'OpenAI processes AI requests on our behalf and receives the moment context described above.',
        'OpenRouter checks Quiz me questions on our behalf before you see them, using a model from TypeSafe. It receives each question, its options and the stretch of transcript the question was written from, and nothing about you.',
        'Razorpay processes payments and receives whatever you enter into its own payment form.',
        'Resend delivers verification emails and receives your email address.',
        'Railway hosts the service and stores our database.',
        'We do not sell your data, and there is no advertising or analytics tracking in the extension.',
      ],
    },
    {
      heading: 'Your choices',
      body: [
        'You can use FocusSpace fully signed out. Most of it (spaces, ranking, the learning path, the knowledge map) never needed an account.',
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
        'Basic is a single payment that never expires. It stays on your account for as long as the service runs, underneath any other plan you buy.',
        'Other paid plans grant access for the period you buy (one month or twelve months), starting when the payment succeeds. If you do not own Basic yet, your first Plus payment includes it.',
        'You choose at checkout whether the plan renews automatically. If it does, we charge the same amount each period until you stop it, and you can stop it at any time from your account page. If it does not, the plan simply ends and the account returns to Basic if you own it, otherwise to the Free plan.',
        'Moving to a higher plan during a paid period, you pay only the difference: what is left of the current period is taken off the new price, and the new plan starts that day. Moving to a lower plan takes effect when the current period ends.',
        'When a plan ends, for either reason, nothing is deleted.',
        'Prices are shown in US dollars and, for customers in India, charged in Indian rupees through Razorpay. The rupee amount shown at checkout is what you are charged.',
        'We may change prices, but never for a period you have already paid for.',
        'AI allowances are counted in credits and reset each calendar month; the Free plan and Basic also have a daily limit, counted over the last 24 hours. Quiz me is counted in questions shown each month. Unused allowances do not carry over.',
      ],
    },
    {
      heading: 'What we do not promise',
      body: [
        'AI output can be wrong. FocusSpace labels it as such. Do not rely on it as your only source for anything that matters: an exam, an interview, or a decision.',
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
        'If your plan renews automatically, stop it from your account page: one click, no explanation needed, no email to write. You keep access for every day of the period you already paid for, and are not charged again.',
        'If you bought a single period instead, there is nothing to cancel: it ends by itself.',
        'Your spaces, notes and mind maps are not deleted when a plan ends. They are in your browser, where they always were.',
      ],
    },
    {
      heading: 'Refunds',
      body: [
        'If you are unhappy within 7 days of a payment and have used only a small part of your AI credits for that period, write to us and we will refund it in full.',
        'After 7 days, or once a substantial part of the period’s credits has been used, we refund the unused portion at our discretion.',
        'If FocusSpace is unavailable for an extended period through our fault, we refund that time whether or not you ask.',
        'If you were charged twice for the same thing, tell us and we will return the duplicate immediately, no questions.',
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
        'For anything about a payment, include the payment identifier from your account page. It makes it far quicker to find.',
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
