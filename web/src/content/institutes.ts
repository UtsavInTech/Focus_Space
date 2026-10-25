import { CONTACT } from './legal';

/** Proposed pilot only. Consent rules: server/institutes/README.md.
 * No institute has agreed to this programme; none is named or pictured here.
 */
export const INSTITUTE_LINK = { label: 'For institutes', to: '/institutes' } as const;
export const INSTITUTE_PILOT_STRIP = 'Coaching institute? Talk to us about the pilot';
export const INSTITUTE_CONTACT = `mailto:${CONTACT}?subject=${encodeURIComponent('FocusSpace for institutes')}`;

export const INSTITUTES = {
  title: 'For coaching institutes · FocusSpace',
  eyebrow: 'FOR COACHING INSTITUTES',
  status: 'PROPOSED PILOT',
  headline: ['Your lectures.', 'Their learning space.'],
  intro: 'We’re planning an institute’s own Space on YouTube. Your lectures in your order, grouped by subject and topic, for the students you teach.',
  availability: 'The pilot implementation is in development and is not publicly available yet.',
  invitation: 'We’re starting this with a small number of institutes as a pilot. Talk to us.',
  contactLabel: 'Talk to us about the pilot',
  studentLabel: 'See how it works for students',
  flowTitle: 'The student journey we’re planning',
  flow: [
    { title: 'A join code from you', text: 'Students would join their institute’s Space with a code from their institute.' },
    { title: 'Clear steps when they join', text: 'They would verify their mobile number and be told, before joining, that your institute receives their name and number. Sharing progress would be a separate, optional choice, and “Yes, contact me” would put them first in your list.' },
    { title: 'A place for today’s class', text: 'Your faculty would choose the class. Students would find it alongside the subjects and topics in their course.' },
  ],
  detailsTitle: 'Your course, with a little more structure.',
  detailsIntro: 'Here is what we propose to build with the pilot institutes.',
  details: [
    { title: 'The course you teach', text: 'Lectures and playlists in your order, grouped by subject and topic. Only channels you approve, with no Shorts or videos from other channels in the institute Space.' },
    { title: 'A clearer view of progress', text: 'An institute dashboard would show who watched which lessons and who is falling behind, for students who have agreed to share their institute progress.' },
    { title: 'Every student, reachable', text: 'You would receive the name and verified number of every student who joins your course, with students who ask to be contacted marked first and flagged to you straight away. Watching your lectures on YouTube alone would not give you anyone’s number.' },
  ],
  privacyTitle: 'A student’s choice stays theirs.',
  privacy: 'In the proposed pilot, students would know before joining that you receive their name and number, would choose whether to share their progress, and could withdraw that choice at any time. Their personal Spaces would never be shared with the institute.',
  closingTitle: 'Help shape the pilot.',
  closingText: 'Tell us what you teach and how your students use YouTube. We’ll talk through whether this proposed pilot fits your institute.',
  faq: 'Not yet. We’re planning a pilot with a small number of coaching institutes. Institute Spaces, the dashboard and joining by code are being prepared for the pilot and are not publicly available today. Talk to us about the pilot on the institutes page.',
};
