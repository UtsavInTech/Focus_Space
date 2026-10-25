import { CONTACT } from './legal';

/** Proposed pilot only. Based on docs/INSTITUTES.md, especially student consent in §2.7.
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
    { title: 'A clear choice about sharing', text: 'They would see what progress they’re being asked to share. Sharing a phone number for calls or messages would be a separate, optional choice.' },
    { title: 'A place for today’s class', text: 'Your faculty would choose the class. Students would find it alongside the subjects and topics in their course.' },
  ],
  detailsTitle: 'Your course, with a little more structure.',
  detailsIntro: 'Here is what we propose to build with the pilot institutes.',
  details: [
    { title: 'The course you teach', text: 'Lectures and playlists in your order, grouped by subject and topic. Only channels you approve, with no Shorts or videos from other channels in the institute Space.' },
    { title: 'A clearer view of progress', text: 'An institute dashboard would show who watched which lessons and who is falling behind, for students who have agreed to share their institute progress.' },
    { title: 'Contact with permission', text: 'You would receive phone numbers only from students who explicitly agree to share them for contact. Watching your lectures would not give you their number.' },
  ],
  privacyTitle: 'A student’s choice stays theirs.',
  privacy: 'In the proposed pilot, students would choose what they share and could withdraw their consent at any time. Their personal Spaces would never be shared with the institute.',
  closingTitle: 'Help shape the pilot.',
  closingText: 'Tell us what you teach and how your students use YouTube. We’ll talk through whether this proposed pilot fits your institute.',
  faq: 'Not yet. We’re planning a pilot with a small number of coaching institutes. Institute Spaces, the dashboard and joining by code are being prepared for the pilot and are not publicly available today. Talk to us about the pilot on the institutes page.',
};
