import { describe, expect, it } from 'vitest';
import type { CoursePayload } from '../../institute-api';
import { buildCourse, depth, groupOf, parsePlace, placeHash, summarise, toStudents, walk } from './model';

const outline: CoursePayload = {
  brand: { name: 'Demo' },
  subjects: [
    { id: 'polity', title: '1 · Polity', topics: [{ id: 'basics', title: 'Basics', subtopics: [], items: [{ type: 'video', videoId: 'aaaaaaaaaaa', quizId: 'q1' }, { type: 'video', videoId: 'bbbbbbbbbbb' }] }] },
    { id: 'history', title: '2 · History', topics: [{ id: 'modern', title: 'Modern', subtopics: [], items: [{ type: 'playlist', playlistId: 'PLx' }, { type: 'video', videoId: 'ccccccccccc', membersOnly: true }] }] },
  ],
  approvedChannels: [],
  modes: [],
};
const videos = [
  { video_id: 'aaaaaaaaaaa', started: 100, half: 90, done: 80 },
  { video_id: 'bbbbbbbbbbb', started: 60, half: 50, done: 40 },
  { video_id: 'ccccccccccc', started: 55, half: 50, done: 50 },
];

describe('Studio building', () => {
  const course = buildCourse('c1', 'GS Foundation', outline, videos, { aaaaaaaaaaa: 'Preamble' });

  it('keeps the faculty order, numbers lessons through the course and skips playlists', () => {
    expect(course.lessons.map((l) => [l.id, l.number])).toEqual([['aaaaaaaaaaa', 1], ['bbbbbbbbbbb', 2], ['ccccccccccc', 3]]);
    expect(course.children.map((c) => c.title)).toEqual(['Polity', 'History']);
    expect(course.lessons[0]).toMatchObject({ title: 'Preamble', quiz: true });
    expect(course.lessons[2]).toMatchObject({ title: null, membersOnly: true });
  });

  it('summarises a room: completion, carry-through and where viewers stopped', () => {
    const s = summarise(course.lessons);
    expect(s).toMatchObject({ lessons: 3, starts: 215, completions: 170 });
    expect(s.completionRate).toBeCloseTo(170 / 215);
    expect(s.carryThrough).toBeCloseTo(0.55);
    expect(s.biggestDrop).toMatchObject({ lost: 40, lesson: { id: 'aaaaaaaaaaa' } });
    expect(summarise([])).toMatchObject({ lessons: 0, completionRate: 0, carryThrough: 0, biggestDrop: null });
  });

  it('walks a path and stops at the deepest room that exists', () => {
    expect(walk(course, ['c1', 'polity', 'basics', 'bbbbbbbbbbb']).map((r) => r.id)).toEqual(['c1', 'polity', 'basics', 'bbbbbbbbbbb']);
    expect(walk(course, ['c1', 'polity', 'nope']).map((r) => r.id)).toEqual(['c1', 'polity']);
  });

  it('round-trips places through the URL hash', () => {
    for (const hash of ['#/', '#/ask', '#/ask/thread-1', '#/context', '#/playbooks', '#/results', '#/courses', '#/students', '#/students/talent', '#/student/u1', '#/requests', '#/brief', '#/course/c1/polity/basics']) expect(placeHash(parsePlace(hash))).toBe(hash);
    expect(parsePlace('#/unknown')).toEqual({ room: 'lobby' });
    expect(parsePlace('#/students/nonsense')).toEqual({ room: 'students' });
    expect(depth(parsePlace('#/course/c1/polity'))).toBe(3);
  });

  it('puts each consenting student in one of four groups', () => {
    const [top, talent, help, drifting] = toStudents([
      { user_id: '1', name: 'A', completion_percent: 80, quiz_score: 90, completed_videos: 20 },
      { user_id: '2', name: 'B', completion_percent: 20, quiz_score: 85, completed_videos: 5 },
      { user_id: '3', name: 'C', completion_percent: 70, quiz_score: 30, completed_videos: 18 },
      { user_id: '4', name: null, completion_percent: null, quiz_score: null, completed_videos: null },
    ]);
    expect([groupOf(top), groupOf(talent), groupOf(help), groupOf(drifting)]).toEqual(['toppers', 'talent', 'help', 'drifting']);
    expect(drifting).toMatchObject({ name: 'Student', completion: null });
  });
});
