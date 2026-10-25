/**
 * One student's report for their institute: where they are in the course, how much time they have put
 * in, how their quiz scores are moving and where they are strongest, and their study pattern (which days,
 * what time of day, how steadily, speeding up or slowing down). Built only from what the student shares.
 */
import { percent, type Lesson, type Section } from './model';

export interface ReportInput {
  lectures: { course_id: string; video_id: string; stage: string; seconds: number; updated_at: number }[];
  quizzes: { course_id: string; video_id: string; score: number; total: number; at: number; kind: 'institute' | 'quizme' }[];
}

export interface QuizPoint {
  at: number;
  percent: number;
  lesson: Lesson | null;
  kind: 'institute' | 'quizme';
}

export interface CourseProgress {
  course: Section;
  done: number;
  total: number;
  current: Lesson | null;
  next: Lesson | null;
  place: string; // "Polity › Fundamental Rights"
}

export interface Pattern {
  /** Last 8 weeks, oldest first, Monday-first weeks: lectures touched per day. */
  calendar: { day: string; count: number }[];
  activeDays: number;
  daysPerWeek: number;
  /** "late at night", "in the evening", … from the hours they study most. */
  usualTime: string | null;
  hours: number[]; // 24 buckets
  streak: number;
  pace: 'speeding up' | 'steady' | 'slowing down' | 'not enough data';
  lastActive: number | null;
}

const DAY = 86400000;

export function progressIn(courses: Section[], input: ReportInput): CourseProgress[] {
  return courses.map((course) => {
    const mine = input.lectures.filter((l) => l.course_id === course.id);
    const done = new Set(mine.filter((l) => l.stage === 'done').map((l) => l.video_id));
    const latest = [...mine].sort((a, b) => b.updated_at - a.updated_at)[0];
    const current = latest ? course.lessons.find((l) => l.id === latest.video_id) ?? null : null;
    // The next lecture is the first one, in the faculty's order, the student hasn't finished.
    const next = course.lessons.find((l) => !done.has(l.id)) ?? null;
    return { course, done: done.size, total: course.lessons.length, current, next, place: current ? placeOf(course, current) : '' };
  });
}

function placeOf(course: Section, lesson: Lesson): string {
  for (const subject of course.children) {
    if (subject.kind === 'lesson') continue;
    for (const topic of subject.children) {
      if (topic.kind !== 'lesson' && topic.children.some((c) => c.id === lesson.id)) return `${subject.title} › ${topic.title}`;
    }
  }
  return course.title;
}

export function quizSeries(courses: Section[], input: ReportInput): QuizPoint[] {
  const lessons = new Map(courses.flatMap((c) => c.lessons.map((l) => [l.id, l] as const)));
  return [...input.quizzes]
    .sort((a, b) => a.at - b.at)
    .map((q) => ({ at: q.at, percent: Math.round((q.score / q.total) * 100), lesson: lessons.get(q.video_id) ?? null, kind: q.kind }));
}

/** Average score per subject, best first. Subjects with fewer than two quizzes are left out. */
export function subjectScores(courses: Section[], points: QuizPoint[]): { subject: string; average: number; quizzes: number }[] {
  const subjectOf = new Map<string, string>();
  for (const course of courses) {
    for (const subject of course.children) {
      if (subject.kind === 'lesson') continue;
      for (const lesson of subject.lessons) subjectOf.set(lesson.id, subject.title);
    }
  }
  const groups = new Map<string, number[]>();
  for (const p of points) {
    const subject = p.lesson ? subjectOf.get(p.lesson.id) : undefined;
    if (!subject) continue;
    groups.set(subject, [...(groups.get(subject) ?? []), p.percent]);
  }
  return [...groups.entries()]
    .filter(([, xs]) => xs.length >= 2)
    .map(([subject, xs]) => ({ subject, average: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), quizzes: xs.length }))
    .sort((a, b) => b.average - a.average);
}

/** Recent quizzes against earlier ones: up, down or holding, by at least five points. */
export function quizTrend(points: QuizPoint[]): 'rising' | 'falling' | 'steady' | null {
  if (points.length < 4) return null;
  const half = Math.floor(points.length / 2);
  const avg = (xs: QuizPoint[]) => xs.reduce((n, p) => n + p.percent, 0) / xs.length;
  const delta = avg(points.slice(half)) - avg(points.slice(0, half));
  return delta >= 5 ? 'rising' : delta <= -5 ? 'falling' : 'steady';
}

export function pattern(input: ReportInput, now: number, timeZoneOffsetMinutes = 330): Pattern {
  // Every recorded moment of study: lecture milestones and quizzes, in the student's local time (IST by default).
  const moments = [...input.lectures.map((l) => l.updated_at), ...input.quizzes.map((q) => q.at)].filter((t) => t > 0);
  const local = (t: number) => new Date(t + timeZoneOffsetMinutes * 60000);
  const dayKey = (t: number) => local(t).toISOString().slice(0, 10);
  const perDay = new Map<string, number>();
  for (const l of input.lectures) if (l.updated_at > 0) perDay.set(dayKey(l.updated_at), (perDay.get(dayKey(l.updated_at)) ?? 0) + 1);
  for (const q of input.quizzes) if (q.at > 0 && !perDay.has(dayKey(q.at))) perDay.set(dayKey(q.at), 0);

  // Eight weeks ending this week, starting on a Monday so the calendar lines up.
  const todayLocal = local(now);
  const mondayOffset = (todayLocal.getUTCDay() + 6) % 7;
  const start = Date.UTC(todayLocal.getUTCFullYear(), todayLocal.getUTCMonth(), todayLocal.getUTCDate()) - (mondayOffset + 49) * DAY;
  const calendar = Array.from({ length: 56 }, (_, i) => {
    const day = new Date(start + i * DAY).toISOString().slice(0, 10);
    return { day, count: perDay.get(day) ?? 0 };
  });

  const hours = Array.from({ length: 24 }, () => 0);
  for (const t of moments) hours[local(t).getUTCHours()] += 1;
  const usualTime = moments.length >= 3 ? timeOfDay(hours) : null;

  const activeKeys = [...perDay.keys()].sort();
  const first = activeKeys[0];
  const weeks = first ? Math.max(1, (Date.parse(dayKey(now)) - Date.parse(first)) / (7 * DAY)) : 1;

  let streak = 0;
  for (let d = Date.parse(dayKey(now)); perDay.has(new Date(d).toISOString().slice(0, 10)) || (streak === 0 && d === Date.parse(dayKey(now))); d -= DAY) {
    if (perDay.has(new Date(d).toISOString().slice(0, 10))) streak += 1;
    else if (streak === 0) continue; // today without study yet doesn't break a streak that ran to yesterday
  }

  const recent = input.lectures.filter((l) => now - l.updated_at < 14 * DAY).length;
  const before = input.lectures.filter((l) => now - l.updated_at >= 14 * DAY && now - l.updated_at < 28 * DAY).length;
  const pace: Pattern['pace'] = recent + before < 3 ? 'not enough data' : recent >= before * 1.25 + 1 ? 'speeding up' : recent <= before * 0.75 - 1 ? 'slowing down' : 'steady';

  return {
    calendar,
    activeDays: perDay.size,
    daysPerWeek: Math.round((perDay.size / weeks) * 10) / 10,
    usualTime,
    hours,
    streak,
    pace,
    lastActive: moments.length ? Math.max(...moments) : null,
  };
}

function timeOfDay(hours: number[]): string {
  const span = (from: number, to: number) => hours.slice(from, to).reduce((a, b) => a + b, 0);
  const buckets: [string, number][] = [
    ['early in the morning', span(4, 9)],
    ['during the day', span(9, 17)],
    ['in the evening', span(17, 21)],
    ['late at night', span(21, 24) + span(0, 4)],
  ];
  return buckets.sort((a, b) => b[1] - a[1])[0][0];
}

export function hoursAndMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function ago(time: number | null, now: number): string {
  if (!time) return 'never';
  const days = Math.floor((now - time) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'a week ago' : `${weeks} weeks ago`;
}

/** The report's opening paragraph, in plain words. Names, never pronouns. */
export function summary(name: string, progress: CourseProgress[], seconds: number, points: QuizPoint[], subjects: ReturnType<typeof subjectScores>, p: Pattern, now: number): string {
  const first = name.split(' ')[0];
  const lines: string[] = [];
  const main = progress[0];
  if (main) {
    lines.push(`${first} has finished ${main.done} of ${main.total} lectures in ${main.course.title} (${percent(main.total ? main.done / main.total : 0)}) and has spent ${hoursAndMinutes(seconds)} in lectures.`);
    if (main.current) lines.push(`Last seen on lecture ${main.current.number}, ${main.place}.`);
  }
  if (points.length) {
    const avg = Math.round(points.reduce((n, q) => n + q.percent, 0) / points.length);
    const trend = quizTrend(points);
    let s = `Quiz average ${avg}% over ${points.length} quiz${points.length === 1 ? '' : 'zes'}`;
    if (trend === 'rising') s += ', and rising';
    if (trend === 'falling') s += ', and falling';
    if (subjects.length >= 2) s += `; strongest in ${subjects[0].subject} (${subjects[0].average}%), weakest in ${subjects.at(-1)!.subject} (${subjects.at(-1)!.average}%)`;
    lines.push(`${s}.`);
  }
  if (p.activeDays) {
    let s = `Studies about ${p.daysPerWeek} day${p.daysPerWeek === 1 ? '' : 's'} a week`;
    if (p.usualTime) s += `, mostly ${p.usualTime}`;
    if (p.pace === 'speeding up' || p.pace === 'slowing down') s += `, and is ${p.pace} over the last two weeks`;
    lines.push(`${s}. Last active ${ago(p.lastActive, now)}.`);
  }
  return lines.join(' ');
}
