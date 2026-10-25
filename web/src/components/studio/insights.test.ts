import { describe, expect, it } from 'vitest';
import type { CoursePayload } from '../../institute-api';
import { actions, brief, dailySeries, story, toMembers, week, type Member } from './insights';
import { buildCourse } from './model';
import { hoursAndMinutes, pattern, progressIn, quizSeries, quizTrend, subjectScores, summary } from './report';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 26, 6, 0); // Monday 26 Oct 2026, 11:30 IST

const outline: CoursePayload = {
  brand: { name: 'Demo' },
  subjects: [
    { id: 'polity', title: 'Polity', topics: [{ id: 'basics', title: 'Basics', subtopics: [], items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((videoId) => ({ type: 'video' as const, videoId })) }] },
    { id: 'history', title: 'History', topics: [{ id: 'modern', title: 'Modern', subtopics: [], items: ['ddddddddddd', 'eeeeeeeeeee'].map((videoId) => ({ type: 'video' as const, videoId })) }] },
  ],
  approvedChannels: [],
  modes: [],
};
const videos = [
  { video_id: 'aaaaaaaaaaa', started: 100, half: 95, done: 90 },
  { video_id: 'bbbbbbbbbbb', started: 90, half: 85, done: 80 },
  { video_id: 'ccccccccccc', started: 50, half: 40, done: 20 }, // a leak before it, and weak inside it
  { video_id: 'ddddddddddd', started: 48, half: 45, done: 44 },
  { video_id: 'eeeeeeeeeee', started: 47, half: 45, done: 43 },
];
const course = buildCourse('c1', 'GS Foundation', outline, videos, {});

const member = (over: Partial<Member>): Member => ({
  id: Math.random().toString(36), name: 'Student', phone: '+919876500000', joinedAt: NOW - 20 * DAY, sharing: true, wantsContact: false, openRequest: false,
  completion: 30, quiz: 50, lessonsDone: 10, watchSeconds: 3600, lastActive: NOW - DAY, activeDays: 8, ...over,
});

describe('Studio overview', () => {
  it('fills missing days and compares this week with last', () => {
    const series = dailySeries([{ day: '2026-10-26', started: 10, done: 5 }, { day: '2026-10-26', started: 2, done: 1 }, { day: '2026-10-15', started: 20, done: 10 }], NOW, 14);
    expect(series).toHaveLength(14);
    expect(series.at(-1)).toEqual({ day: '2026-10-26', started: 12, done: 6 });
    expect(week(series)).toMatchObject({ plays: 12, previousPlays: 20, change: -0.4 });
  });

  it('ranks what to act on: requests and falling-behind high scorers first, then leaks and quiet students', () => {
    const members = [
      member({ name: 'Pooja Gupta', quiz: 95, completion: 20 }),
      member({ name: 'Dev Joshi', lastActive: NOW - 10 * DAY }),
      member({ name: 'Ira Rao', completion: 80, quiz: 35 }),
      member({ name: 'Not sharing', sharing: false, quiz: null, completion: null, lastActive: null }),
    ];
    const requests = [{ id: 'r1', userId: 'u', name: 'Aman Das', phone: '+91', courseTitle: null, source: 'button' as const, note: null, createdAt: NOW - 3 * DAY, handledAt: null }];
    const list = actions({ members, requests, courses: [course], week: { plays: 70, finished: 50, previousPlays: 100, previousFinished: 80, change: -0.3 }, now: NOW });
    expect(list.map((a) => a.title)).toEqual([
      'Call 1 student who asked to talk',
      '1 high scorer is falling behind',
      'Lecture plays fell 30% this week',
      'Students stop after lecture 2',
      'Lecture 3 loses viewers before its end',
      '1 student went quiet',
      '1 student keeps up but score low',
    ]);
    expect(list[0].detail).toContain('waited 3 days');
    expect(list[3].place).toEqual({ room: 'course', path: ['c1', 'polity', 'basics', 'bbbbbbbbbbb'] });
    expect(list.some((a) => a.detail.includes('Not sharing'))).toBe(false);
  });

  it('says nothing it cannot back up', () => {
    expect(actions({ members: [], requests: [], courses: [], week: { plays: 3, finished: 1, previousPlays: 1, previousFinished: 0, change: 2 }, now: NOW })).toEqual([]);
  });

  it('tells the week in plain words and builds a WhatsApp brief', () => {
    const members = toMembers([{ user_id: 'a', name: 'New', phone: '+91', joined_at: NOW - DAY, sharing_progress: false }]);
    const w = { plays: 120, finished: 90, previousPlays: 100, previousFinished: 70, change: 0.2 };
    expect(story({ orgName: 'Demo', members, week: w, open: 2, actions: 3, now: NOW })).toBe(
      'In the last 7 days, students began 120 lectures and finished 90, 20% more than the week before. 1 new student joined. 2 are waiting for a call.',
    );
    const text = brief({ orgName: 'Demo', week: w, yesterday: { day: '2026-10-25', started: 14, done: 9 }, actions: [], quietNames: ['Dev Joshi'], link: 'https://focusspace.xyz/studio' });
    expect(text).toContain('Yesterday: 14 lectures begun, 9 finished.');
    expect(text).toContain('*Went quiet:* Dev Joshi.');
  });
});

describe('Student report', () => {
  const at = (daysAgo: number, hourIst: number) => NOW - daysAgo * DAY + (hourIst - 11.5) * 3600000;
  const input = {
    lectures: [
      { course_id: 'c1', video_id: 'aaaaaaaaaaa', stage: 'done', seconds: 2400, updated_at: at(20, 22) },
      { course_id: 'c1', video_id: 'bbbbbbbbbbb', stage: 'done', seconds: 1800, updated_at: at(18, 23) },
      { course_id: 'c1', video_id: 'ccccccccccc', stage: 'half', seconds: 600, updated_at: at(16, 22) },
      { course_id: 'c1', video_id: 'ddddddddddd', stage: 'done', seconds: 2000, updated_at: at(2, 21) },
    ],
    quizzes: [
      { course_id: 'c1', video_id: 'aaaaaaaaaaa', score: 6, total: 10, at: at(20, 22), kind: 'quizme' as const },
      { course_id: 'c1', video_id: 'bbbbbbbbbbb', score: 7, total: 10, at: at(18, 23), kind: 'quizme' as const },
      { course_id: 'c1', video_id: 'ddddddddddd', score: 9, total: 10, at: at(2, 21), kind: 'institute' as const },
      { course_id: 'c1', video_id: 'eeeeeeeeeee', score: 10, total: 10, at: at(1, 22), kind: 'quizme' as const },
    ],
  };

  it('finds where the student is, what is next, and the time put in', () => {
    const [p] = progressIn([course], input);
    expect(p).toMatchObject({ done: 3, total: 5, place: 'History › Modern' });
    expect(p.current?.id).toBe('ddddddddddd');
    expect(p.next?.id).toBe('ccccccccccc');
    expect(hoursAndMinutes(6800)).toBe('1 h 53 min');
  });

  it('reads quiz scores over time and by subject', () => {
    const points = quizSeries([course], input);
    expect(points.map((p) => p.percent)).toEqual([60, 70, 90, 100]);
    expect(quizTrend(points)).toBe('rising');
    expect(subjectScores([course], points)).toEqual([{ subject: 'History', average: 95, quizzes: 2 }, { subject: 'Polity', average: 65, quizzes: 2 }]);
  });

  it('reads the study pattern in Indian time', () => {
    const p = pattern(input, NOW);
    expect(p.calendar).toHaveLength(56);
    expect(new Date(p.calendar[0].day).getUTCDay()).toBe(1); // starts on a Monday
    expect(p.usualTime).toBe('late at night');
    expect(p.activeDays).toBe(5);
    expect(p.lastActive).toBe(at(1, 22));
    const text = summary('Pooja Gupta', progressIn([course], input), 6800, quizSeries([course], input), subjectScores([course], quizSeries([course], input)), p, NOW);
    expect(text).toContain('Pooja has finished 3 of 5 lectures in GS Foundation (60%)');
    expect(text).toContain('strongest in History (95%), weakest in Polity (65%)');
    expect(text).toContain('mostly late at night');
  });
});
