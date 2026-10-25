/**
 * Copy for the institute pages (Control room, Studio, join and account). The join wording follows the owner's
 * decision of 26 Oct 2026 (the institute receives every member's number). Change it together with the privacy page.
 */
export const TOOLS = {
  admin: 'Control room',
  studio: 'Institute studio',
  join: 'Join an institute course',
  signin: 'Sign in to continue',
  loading: 'Loading institute data…',
  unavailable: 'This account does not have access to this tool.',
  intro: 'Courses, batches and the students who choose to share with you.',
  consentTitle: 'Your choices',
  progress: 'Share my progress and quiz scores with this institute',
  progressHelp: 'Faculty see which lectures you finished, your quiz scores and how much you study, so they can help you where you are stuck and spot students for scholarships and results. Off unless you turn it on; you can turn it off any time.',
  contact: 'Yes, contact me about this course',
  contactHelp: 'You go to the top of the list, and the institute is told straight away. Use it if you want a call about the course, a doubt, a scholarship test or joining a batch.',
  phoneTitle: 'Your mobile number',
  phoneShared: (org: string) => `${org} receives your name and this number when you join, so its faculty can reach you about this course. FocusSpace never shows your number to anyone else. Leaving the course stops new sharing.`,
  phoneHelp: 'We send a six-digit code to check the number is yours.',
  notice:
    'Without sharing progress you can still watch, follow the path, take quizzes and make notes, and you are counted in course totals only. Your personal Spaces are never shared. Change your choices any time from your account.',
  joined: 'You have joined. Connect the extension to this account, then open YouTube to find your institute Space.',
  metrics: {
    joined: 'Joined',
    started: 'Started',
    half: 'Half way',
    done: 'Completed',
    passed_quiz: 'Passed quiz',
    shared_progress: 'Sharing progress',
    shared_contact: 'Sharing contact',
  },
};
