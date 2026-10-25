/**
 * The Studio's building: an institute is a lobby, each course a wing, each subject and topic a room, each
 * lesson the last door. Everything here is plain data built from what the API already returns (course
 * outline, per-lesson stats, consenting students), so it is easy to test and the screens stay simple.
 */
import type { CoursePayload } from '../../institute-api';

export interface LessonStats {
  started: number;
  half: number;
  done: number;
}

export interface Lesson {
  kind: 'lesson';
  id: string; // the YouTube video id
  title: string | null;
  number: number; // position in the whole course, from 1
  quiz: boolean;
  membersOnly: boolean;
  stats: LessonStats;
}

export interface Section {
  kind: 'course' | 'subject' | 'topic';
  id: string;
  title: string;
  children: (Section | Lesson)[];
  lessons: Lesson[]; // every lesson inside, in course order
}

export interface Summary {
  lessons: number;
  /** Lesson plays that began, half-way marks, and full watches, added up over the lessons. */
  starts: number;
  completions: number;
  /** Share of started plays that were watched to the end. */
  completionRate: number;
  /** How many of the people who started the first lesson here also started the last one. */
  carryThrough: number;
  /** The lesson after which the most viewers stopped, if any did. */
  biggestDrop: { lesson: Lesson; lost: number } | null;
}

type VideoRow = Record<string, unknown>;

const EMPTY: LessonStats = { started: 0, half: 0, done: 0 };

export function buildCourse(id: string, title: string, outline: CoursePayload, videos: VideoRow[], titles: Record<string, string>): Section {
  const stats = new Map(videos.map((row) => [String(row.video_id), { started: Number(row.started) || 0, half: Number(row.half) || 0, done: Number(row.done) || 0 }]));
  let number = 0;
  const course: Section = { kind: 'course', id, title, children: [], lessons: [] };
  for (const subject of outline.subjects) {
    const subjectRoom: Section = { kind: 'subject', id: subject.id, title: cleanTitle(subject.title), children: [], lessons: [] };
    for (const topic of subject.topics) {
      const topicRoom: Section = { kind: 'topic', id: topic.id, title: topic.title, children: [], lessons: [] };
      for (const item of topic.items) {
        if (item.type !== 'video' || !item.videoId) continue;
        number += 1;
        const lesson: Lesson = {
          kind: 'lesson',
          id: item.videoId,
          title: titles[item.videoId] ?? null,
          number,
          quiz: !!item.quizId,
          membersOnly: !!item.membersOnly,
          stats: stats.get(item.videoId) ?? EMPTY,
        };
        topicRoom.children.push(lesson);
        topicRoom.lessons.push(lesson);
      }
      subjectRoom.children.push(topicRoom);
      subjectRoom.lessons.push(...topicRoom.lessons);
    }
    course.children.push(subjectRoom);
    course.lessons.push(...subjectRoom.lessons);
  }
  return course;
}

/** "1 · Polity" → "Polity": the order already shows in the room's position. */
function cleanTitle(title: string) {
  return title.replace(/^\s*\d+\s*[·.)-]\s*/, '');
}

export function summarise(lessons: Lesson[]): Summary {
  const starts = lessons.reduce((n, l) => n + l.stats.started, 0);
  const completions = lessons.reduce((n, l) => n + l.stats.done, 0);
  let biggestDrop: Summary['biggestDrop'] = null;
  for (let i = 0; i < lessons.length - 1; i += 1) {
    const lost = lessons[i].stats.started - lessons[i + 1].stats.started;
    if (lost > 0 && (!biggestDrop || lost > biggestDrop.lost)) biggestDrop = { lesson: lessons[i], lost };
  }
  const first = lessons[0]?.stats.started ?? 0;
  const last = lessons.at(-1)?.stats.started ?? 0;
  return {
    lessons: lessons.length,
    starts,
    completions,
    completionRate: starts ? completions / starts : 0,
    carryThrough: first ? Math.min(1, last / first) : 0,
    biggestDrop,
  };
}

/** Where the Studio is: the lobby, a room inside a course, or one of the side rooms. Lives in the URL hash. */
export type StudentFilter = 'all' | 'priority' | 'sharing' | 'talent' | 'toppers' | 'help' | 'quiet' | 'private';

export type Place =
  | { room: 'lobby' } // the overview
  | { room: 'courses' }
  | { room: 'students'; filter?: StudentFilter }
  | { room: 'student'; id: string }
  | { room: 'requests' }
  | { room: 'brief' }
  | { room: 'course'; path: string[] }; // [courseId, subjectId?, topicId?, lessonId?]

const FILTERS: StudentFilter[] = ['all', 'priority', 'sharing', 'talent', 'toppers', 'help', 'quiet', 'private'];

export function parsePlace(hash: string): Place {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'students') return FILTERS.includes(parts[1] as StudentFilter) && parts[1] !== 'all' ? { room: 'students', filter: parts[1] as StudentFilter } : { room: 'students' };
  if (parts[0] === 'student' && parts[1]) return { room: 'student', id: parts[1] };
  if (parts[0] === 'requests') return { room: 'requests' };
  if (parts[0] === 'brief') return { room: 'brief' };
  if (parts[0] === 'courses') return { room: 'courses' };
  if (parts[0] === 'course' && parts[1]) return { room: 'course', path: parts.slice(1, 5) };
  return { room: 'lobby' };
}

export function placeHash(place: Place): string {
  if (place.room === 'course') return `#/course/${place.path.map(encodeURIComponent).join('/')}`;
  if (place.room === 'student') return `#/student/${encodeURIComponent(place.id)}`;
  if (place.room === 'students') return place.filter && place.filter !== 'all' ? `#/students/${place.filter}` : '#/students';
  if (place.room === 'lobby') return '#/';
  return `#/${place.room}`;
}

export function depth(place: Place): number {
  if (place.room === 'course') return place.path.length + 1;
  if (place.room === 'student') return 2;
  return place.room === 'lobby' ? 0 : 1;
}

/** Follows a course path down the building. Unknown ids stop at the deepest room that exists. */
export function walk(course: Section, path: string[]): (Section | Lesson)[] {
  const trail: (Section | Lesson)[] = [course];
  let here: Section | Lesson = course;
  for (const id of path.slice(1)) {
    if (here.kind === 'lesson') break;
    const next: Section | Lesson | undefined = here.children.find((child) => child.id === id);
    if (!next) break;
    trail.push(next);
    here = next;
  }
  return trail;
}

export interface Student {
  id: string;
  name: string;
  completion: number | null;
  quiz: number | null;
  lessonsDone: number | null;
}

export function toStudents(rows: Record<string, unknown>[]): Student[] {
  return rows.map((row) => ({
    id: String(row.user_id),
    name: row.name ? String(row.name) : 'Student',
    completion: row.completion_percent === null || row.completion_percent === undefined ? null : Number(row.completion_percent),
    quiz: row.quiz_score === null || row.quiz_score === undefined ? null : Number(row.quiz_score),
    lessonsDone: row.completed_videos === null || row.completed_videos === undefined ? null : Number(row.completed_videos),
  }));
}

/**
 * Four groups an institute acts on differently: toppers (scholarships, results), hidden talent (strong
 * scores, not keeping up: worth a call), needs help (keeps watching, scores low: faculty attention) and
 * drifting (neither yet).
 */
export type Group = 'toppers' | 'talent' | 'help' | 'drifting';

export const GROUPS: Record<Group, { label: string; hint: string }> = {
  toppers: { label: 'Toppers', hint: 'At least half the course watched, and 70% or more on quizzes.' },
  talent: { label: 'Hidden talent', hint: '70% or more on quizzes, but less than half the lectures watched. Worth a call.' },
  help: { label: 'Needs help', hint: 'At least half the lectures watched, but under 70% on quizzes.' },
  drifting: { label: 'Drifting', hint: 'Behind on lectures and under 70% on quizzes. Not yet engaged.' },
};

/** The one definition used everywhere (map, filters, overview): half the course, and a 70% quiz average. */
export const COMPLETION_LINE = 50;
export const SCORE_LINE = 70;

export function groupOf(student: Pick<Student, 'completion' | 'quiz'>, completionLine = COMPLETION_LINE, scoreLine = SCORE_LINE): Group {
  const keepingUp = (student.completion ?? 0) >= completionLine;
  const scoring = (student.quiz ?? 0) >= scoreLine;
  if (keepingUp && scoring) return 'toppers';
  if (scoring) return 'talent';
  if (keepingUp) return 'help';
  return 'drifting';
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const count = (value: number) => new Intl.NumberFormat('en-IN').format(value);
