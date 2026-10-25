/** Website copy checked against modes/exams.ts, modes/curricula.ts and QuizCards.tsx.
 * These are learning-map examples, not official syllabi. No extension runtime imports.
 */
export const EXAM_STORY = {
  eyebrow: 'A PLACE TO START',
  title: 'Pick your exam. Find your direction.',
  intro: 'UPSC, NEET, JEE, or your engineering degree. Start with your goal. FocusSpace asks the questions that matter, then builds your Space around the subjects you need.',
  steps: [
    { title: 'Your goal. Your choices.', text: 'Choose your UPSC optional, your state, or your B.Tech branch and year. Pick the creators you want to learn from before creating your Space.' },
    { title: 'A subject, then a little deeper.', text: 'Move from NEET to Chemistry, then Organic Chemistry and its subtopics. Keep the bigger picture while choosing what to study next.' },
    { title: 'A path when there’s an order.', text: 'In System Design, follow stages from Foundations through HLD, LLD and interview practice. See your progress and where to pick up.' },
  ],
  note: 'A starting map for learning, not an official syllabus. Check your exam’s current notification. Exam bodies do not endorse FocusSpace or the channels shown.',
};

export const SPACE_GALLERY = [
  { id: 'upsc', label: 'UPSC', icon: 'exam', caption: 'Prelims, Mains and your optional. A Space shaped around the choices you make.', outline: ['Prelims · GS', 'Polity', 'Fundamental rights'], image: 'feed', imageAlt: 'Existing System Design Space on YouTube with topic chips and relevant video recommendations', imageLabel: 'Product view: System Design. UPSC example described above.' },
  { id: 'neet', label: 'NEET', icon: 'science', caption: 'Biology, Physics and Chemistry. Choose a subject, a topic, then the part you want to understand.', outline: ['Chemistry', 'Organic Chemistry', 'Isomerism'], image: 'feed', imageAlt: 'Existing System Design Space on YouTube with topic chips and relevant video recommendations', imageLabel: 'Product view: System Design. NEET example described above.' },
  { id: 'jee', label: 'JEE', icon: 'science', caption: 'Main or Advanced. Start with Physics, Chemistry and Mathematics, then work on one topic at a time.', outline: ['Mathematics', 'Calculus', 'Integration'], image: 'feed', imageAlt: 'Existing System Design Space on YouTube with topic chips and relevant video recommendations', imageLabel: 'Product view: System Design. JEE example described above.' },
  { id: 'btech', label: 'B.Tech CSE', icon: 'code', caption: 'Your branch, your year, your subjects. Add the skills you want to learn alongside your degree.', outline: ['CSE · Your year', 'Core subjects', 'Skills you choose'], image: 'web-development', imageAlt: 'Existing Web Development Space on YouTube showing web development topic chips and lessons', imageLabel: 'Product view: Web Development. B.Tech setup described above.' },
  { id: 'system-design', label: 'System Design', icon: 'layers', caption: 'From Foundations to HLD, LLD and interview practice. A learning path with a place to begin.', outline: ['Foundations', 'HLD building blocks', 'HLD case studies', 'LLD foundations', 'LLD case studies', 'Interview'], image: 'feed', imageAlt: 'System Design Space on YouTube with topic chips and relevant video recommendations', imageLabel: 'System Design Space. Existing product capture.' },
  { id: 'japanese', label: 'Japanese', icon: 'language', caption: 'Grammar, conversations, and a whole new way to see the world.', outline: [], image: 'japanese', imageAlt: 'Japanese learning Space on YouTube with language topic chips and Japanese lessons', imageLabel: 'Japanese Space on YouTube.' },
  { id: 'music', label: 'Music', icon: 'music', caption: 'Your favourites, your discoveries. A Space to find your rhythm.', outline: [], image: 'music', imageAlt: 'Music Space on YouTube with music topics and matching videos', imageLabel: 'Music Space on YouTube.' },
] as const;

export const LIGHT_SPACE_COPY = {
  intro: 'An exam to prepare for. A course to follow. A language just for you. Give your curiosity a direction.',
  details: [
    { title: 'Your next lesson, up front.', text: 'A streaming-style home on YouTube, with a featured video and shelves of lessons organised around your Space.' },
    { title: 'Your subscriptions, with intention.', text: 'Your channels, ranked around what you’re learning. Relevant discoveries from wider YouTube sit alongside them.' },
    { title: 'A little more room to learn.', text: 'Go full screen from your Space. Hide the browser tabs and bars, then press Esc to return.' },
  ],
};

export const QUIZ_COPY = 'Choose 5, 10, 15 or 20 questions per round on what you’ve watched or the full video. FocusSpace AI follows your plan’s question allowance. On-device AI is available on supported computers without using credits.';
