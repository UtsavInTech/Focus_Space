/** One vocabulary for Studio pages, explanations and suggested questions. */
export const STUDIO_PAGES = {
 lobby: ['Home', 'Ask about your students, finish setting up, or choose someone who needs you today.'],
 ask: ['Ask', 'Ask a question about your institute. Check the table and how the answer was found.'],
 requests: ['Requests', 'Students asked to hear from you. Open their report, call, and record what happened.'],
 students: ['Students', 'Find a student, understand their learning, and choose the next helpful conversation.'],
 student: ['Student report', 'Read what this student has shared, then record the next step together.'],
 playbooks: ['Playbooks', 'Choose who needs a message, review each draft, and contact them yourself.'],
 results: ['Results', 'Record paid enrolments and see the fees your team has attributed to its conversations.'],
 courses: ['Courses', 'Open a course to see its lectures and where students stop watching.'],
 course: ['Course', 'Follow the course into a subject or lecture to see what students watched.'],
 context: ['Context', 'Tell your assistant about your courses, fees and voice. Approve what it learns from edits.'],
 brief: ['Morning brief', 'Review today’s summary, then copy it for your team.'],
} as const;
export const SUGGESTED_QUESTIONS = ['Who asked us to call?', 'Which students finished at least 10 lectures?', 'Who scores above 80% but went quiet?', 'Which lectures lose the most viewers?', 'How much did we record in enrolment fees this month?'];
export const STUDIO_GLOSSARY = {
 joined: ['Joined', 'Distinct student–course enrolments, including those who later left; one student in two courses counts twice.'],
 students: ['Students', 'Distinct currently enrolled students in the selected institute or course.'],
 started: ['Begun', 'Student–lecture pairs with a started milestone; repeated plays do not add another start.'],
 done: ['Finished', 'Student–lecture pairs that reached at least 80% of a video; this does not mean finishing the whole course.'],
 completion: ['Lectures finished', 'Finished lectures divided by lectures available in the student’s enrolled courses, capped at 100%; shown only with progress sharing.'],
 quiz: ['Quiz average', 'The mean of recorded quiz percentages, shown only for students sharing progress; these are study results, not certified exam marks.'],
 quiet: ['Went quiet', 'No recorded course activity for the chosen number of days, among students sharing progress.'],
 time: ['Study time', 'Saved video positions summed across lectures; seeking and replaying mean this is not exact time spent studying.'],
 activity: ['Study days', 'Distinct dates of the latest saved lecture progress; this is not a complete attendance record.'],
 drop: ['Stopped watching', 'The difference between lecture starts and completions; later lecture comparisons describe counts, not the same people.'],
 enrolled: ['Paid enrolments', 'Unique recorded student and paid-course enrolments within the selected dates, entered by institute staff.'],
 revenue: ['Recorded fees', 'The sum of staff-entered fees for paid enrolments, in rupees. It is attributed revenue, not verified payments or proof of causation.'],
 contacted: ['Contacted', 'Students whose message was explicitly marked sent or whose call outcome was recorded by staff.'],
} as const;
