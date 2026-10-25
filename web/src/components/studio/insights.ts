/**
 * The Studio's overview, worked out the way a good assistant would brief an institute owner: one short
 * story of the week, then a ranked list of things to act on today, each a plain sentence with the number
 * behind it and the room to open. Rule-based and explainable (the approach of Data Narrator's "act on
 * today"): no rule fires without enough data to be worth saying.
 */
import { count, groupOf, percent, summarise, type Lesson, type Place, type Section } from './model';

export interface Member {
  id: string;
  name: string;
  phone: string;
  joinedAt: number;
  sharing: boolean;
  wantsContact: boolean;
  openRequest: boolean;
  completion: number | null;
  quiz: number | null;
  lessonsDone: number | null;
  watchSeconds: number | null;
  lastActive: number | null;
  activeDays: number | null;
}

export interface Request {
  id: string;
  userId: string;
  name: string;
  phone: string;
  courseTitle: string | null;
  source: 'join' | 'sharing' | 'button';
  note: string | null;
  createdAt: number;
  handledAt: number | null;
}

export interface DayCount {
  day: string; // YYYY-MM-DD
  started: number;
  done: number;
}

export interface Action {
  priority: 'high' | 'medium' | 'low';
  area: string;
  title: string;
  detail: string;
  place: Place;
}

export interface Week {
  plays: number;
  finished: number;
  previousPlays: number;
  previousFinished: number;
  /** null when last week had nothing to compare with. */
  change: number | null;
}

const DAY = 86400000;
const RANK = { high: 0, medium: 1, low: 2 } as const;

export function toMembers(rows: Record<string, unknown>[]): Member[] {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({
    id: String(r.user_id),
    name: r.name ? String(r.name) : 'Student',
    phone: String(r.phone ?? ''),
    joinedAt: Number(r.joined_at) || 0,
    sharing: !!r.sharing_progress,
    wantsContact: !!r.wants_contact,
    openRequest: !!r.open_request,
    completion: num(r.completion_percent),
    quiz: num(r.quiz_score),
    lessonsDone: num(r.completed_videos),
    watchSeconds: num(r.watch_seconds),
    lastActive: num(r.last_active),
    activeDays: num(r.active_days),
  }));
}

export function toRequests(rows: Record<string, unknown>[]): Request[] {
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    name: r.name ? String(r.name) : 'Student',
    phone: String(r.phone ?? ''),
    courseTitle: r.course_title ? String(r.course_title) : null,
    source: (r.source as Request['source']) ?? 'button',
    note: r.note ? String(r.note) : null,
    createdAt: Number(r.created_at) || 0,
    handledAt: r.handled_at === null || r.handled_at === undefined ? null : Number(r.handled_at),
  }));
}

/** Days as a continuous series ending today (missing days count as zero), summed over courses. */
export function dailySeries(rows: Record<string, unknown>[], now: number, days = 28): DayCount[] {
  const byDay = new Map<string, DayCount>();
  for (const r of rows) {
    const day = String(r.day);
    const d = byDay.get(day) ?? { day, started: 0, done: 0 };
    d.started += Number(r.started) || 0;
    d.done += Number(r.done) || 0;
    byDay.set(day, d);
  }
  const end = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(end - (days - 1 - i) * DAY).toISOString().slice(0, 10);
    return byDay.get(day) ?? { day, started: 0, done: 0 };
  });
}

/** The last seven days against the seven before. */
export function week(series: DayCount[]): Week {
  const last = series.slice(-7);
  const before = series.slice(-14, -7);
  const sum = (xs: DayCount[], k: 'started' | 'done') => xs.reduce((n, d) => n + d[k], 0);
  const plays = sum(last, 'started');
  const previousPlays = sum(before, 'started');
  return { plays, finished: sum(last, 'done'), previousPlays, previousFinished: sum(before, 'done'), change: previousPlays ? plays / previousPlays - 1 : null };
}

export const quiet = (m: Member, now: number) => m.sharing && m.lastActive !== null && now - m.lastActive >= 7 * DAY;
// The same groups as the Students map (model.groupOf): one definition everywhere, so counts always agree.
const sharer = (m: Member) => m.sharing && m.completion !== null;
export const hiddenTalent = (m: Member) => sharer(m) && groupOf(m) === 'talent';
export const needsHelp = (m: Member) => sharer(m) && m.quiz !== null && groupOf(m) === 'help';
export const topper = (m: Member) => sharer(m) && groupOf(m) === 'toppers';

const names = (ms: { name: string }[], n = 3) => {
  const shown = ms.slice(0, n).map((m) => m.name);
  return ms.length > n ? `${shown.join(', ')} and ${ms.length - n} more` : shown.join(' and ').replace(/ and (?=.* and )/, ', ');
};

/** Where in a course the most students stop: the largest fall in starts between two lectures in a row. */
function leak(course: Section): { lesson: Lesson; next: Lesson; lost: number; share: number } | null {
  const ls = course.lessons;
  let best: { lesson: Lesson; next: Lesson; lost: number; share: number } | null = null;
  for (let i = 0; i < ls.length - 1; i += 1) {
    const lost = ls[i].stats.started - ls[i + 1].stats.started;
    const share = ls[i].stats.started ? lost / ls[i].stats.started : 0;
    if (lost >= 5 && share >= 0.15 && (!best || lost > best.lost)) best = { lesson: ls[i], next: ls[i + 1], lost, share };
  }
  return best;
}

/** The lecture that loses the most viewers before its end, compared with how the course usually does. */
function weakLecture(course: Section): { lesson: Lesson; rate: number; usual: number } | null {
  const enough = Math.max(10, Math.round(Math.max(0, ...course.lessons.map((l) => l.stats.started)) * 0.2));
  const judged = course.lessons.filter((l) => l.stats.started >= enough);
  if (judged.length < 3) return null;
  const usual = summarise(judged).completionRate;
  const worst = judged.reduce((a, b) => (b.stats.done / b.stats.started < a.stats.done / a.stats.started ? b : a));
  const rate = worst.stats.done / worst.stats.started;
  return usual - rate >= 0.12 ? { lesson: worst, rate, usual } : null;
}

function lessonPlace(course: Section, lesson: Lesson): Place {
  for (const subject of course.children) {
    if (subject.kind === 'lesson') continue;
    for (const topic of subject.children) {
      if (topic.kind !== 'lesson' && topic.children.some((c) => c.id === lesson.id)) return { room: 'course', path: [course.id, subject.id, topic.id, lesson.id] };
    }
  }
  return { room: 'course', path: [course.id] };
}

export function actions(input: { members: Member[]; requests: Request[]; courses: Section[]; week: Week; now: number }): Action[] {
  const { members, requests, courses, now } = input;
  const out: Action[] = [];

  const open = requests.filter((r) => r.handledAt === null).sort((a, b) => a.createdAt - b.createdAt);
  if (open.length) {
    const oldest = Math.floor((now - open[0].createdAt) / DAY);
    out.push({
      priority: 'high',
      area: 'Requests',
      title: `Call ${count(open.length)} student${open.length === 1 ? '' : 's'} who asked to talk`,
      detail: `${names(open)}${oldest >= 1 ? `. The oldest has waited ${oldest} day${oldest === 1 ? '' : 's'}.` : '.'}`,
      place: { room: 'requests' },
    });
  }

  const talent = members.filter(hiddenTalent).sort((a, b) => (b.quiz ?? 0) - (a.quiz ?? 0));
  if (talent.length) {
    out.push({
      priority: 'high',
      area: 'Students',
      title: `${count(talent.length)} high scorer${talent.length === 1 ? ' is' : 's are'} falling behind`,
      detail: `${names(talent)} score 70% or more on quizzes but have watched less than half the lectures. A call now could keep them.`,
      place: { room: 'students', filter: 'talent' },
    });
  }

  if (input.week.change !== null && input.week.previousPlays >= 20 && input.week.change <= -0.2) {
    out.push({
      priority: 'high',
      area: 'This week',
      title: `Lecture plays fell ${percent(-input.week.change)} this week`,
      detail: `${count(input.week.plays)} plays in the last 7 days, against ${count(input.week.previousPlays)} the week before. Check whether new lectures went up on time.`,
      place: { room: 'lobby' },
    });
  }

  for (const course of courses) {
    const l = leak(course);
    if (l) {
      out.push({
        priority: l.share >= 0.3 ? 'high' : 'medium',
        area: course.title,
        title: `Students stop after lecture ${l.lesson.number}`,
        detail: `${count(l.lost)} fewer students began lecture ${l.next.number}${l.next.title ? ` (${l.next.title})` : ''}. Look at how lecture ${l.lesson.number} ends and what it asks students to do next.`,
        place: lessonPlace(course, l.lesson),
      });
    }
    const w = weakLecture(course);
    if (w) {
      out.push({
        priority: 'medium',
        area: course.title,
        title: `Lecture ${w.lesson.number} loses viewers before its end`,
        detail: `Only ${percent(w.rate)} finish it, against ${percent(w.usual)} for this course's other lectures.`,
        place: lessonPlace(course, w.lesson),
      });
    }
  }

  const gone = members.filter((m) => quiet(m, now)).sort((a, b) => (b.lessonsDone ?? 0) - (a.lessonsDone ?? 0));
  if (gone.length) {
    out.push({
      priority: gone.length >= 10 ? 'high' : 'medium',
      area: 'Students',
      title: `${count(gone.length)} student${gone.length === 1 ? '' : 's'} went quiet`,
      detail: `${names(gone)} have not watched anything for a week or more.`,
      place: { room: 'students', filter: 'quiet' },
    });
  }

  const help = members.filter(needsHelp);
  if (help.length) {
    out.push({
      priority: 'medium',
      area: 'Students',
      title: `${count(help.length)} student${help.length === 1 ? ' keeps' : 's keep'} up but score low`,
      detail: `${names(help)} have watched at least half the lectures but score under 70% on quizzes. A doubt session would help them most.`,
      place: { room: 'students', filter: 'help' },
    });
  }

  if (input.week.change !== null && input.week.previousPlays >= 20 && input.week.change >= 0.2) {
    out.push({
      priority: 'low',
      area: 'This week',
      title: `Lecture plays are up ${percent(input.week.change)}`,
      detail: `${count(input.week.plays)} plays in the last 7 days. Whatever changed this week is working.`,
      place: { room: 'lobby' },
    });
  }

  const toppers = members.filter(topper);
  if (toppers.length >= 3) {
    out.push({
      priority: 'low',
      area: 'Students',
      title: `${count(toppers.length)} toppers for a scholarship shortlist`,
      detail: `${names(toppers)} have watched at least half the course and score 70% or more.`,
      place: { room: 'students', filter: 'toppers' },
    });
  }

  return out.sort((a, b) => RANK[a.priority] - RANK[b.priority]);
}

/** The week in two or three sentences, the way an owner would want it read to them. */
export function story(input: { orgName: string; members: Member[]; week: Week; open: number; actions: number; now: number }): string {
  const { week: w } = input;
  const joinedThisWeek = input.members.filter((m) => input.now - m.joinedAt < 7 * DAY).length;
  const parts: string[] = [];
  const trend = w.change === null ? '' : w.change >= 0.05 ? `, ${percent(w.change)} more than the week before` : w.change <= -0.05 ? `, ${percent(-w.change)} fewer than the week before` : ', about the same as the week before';
  parts.push(`In the last 7 days, students began ${count(w.plays)} lectures and finished ${count(w.finished)}${trend}.`);
  if (joinedThisWeek) parts.push(`${count(joinedThisWeek)} new student${joinedThisWeek === 1 ? '' : 's'} joined.`);
  if (input.open) parts.push(`${count(input.open)} ${input.open === 1 ? 'is' : 'are'} waiting for a call.`);
  else if (input.actions) parts.push(`${count(input.actions)} thing${input.actions === 1 ? ' needs' : 's need'} you today.`);
  return parts.join(' ');
}

/** The morning brief as plain text, ready for WhatsApp. */
export function brief(input: { orgName: string; week: Week; yesterday: DayCount | undefined; actions: Action[]; quietNames: string[]; link: string }): string {
  const y = input.yesterday;
  const lines = [`*${input.orgName}: morning brief*`, ''];
  if (y) lines.push(`Yesterday: ${count(y.started)} lectures begun, ${count(y.done)} finished.`);
  lines.push(`Last 7 days: ${count(input.week.plays)} begun${input.week.change === null ? '' : ` (${input.week.change >= 0 ? '+' : ''}${Math.round(input.week.change * 100)}% on the week before)`}.`);
  if (input.actions.length) {
    lines.push('', '*Act on today*');
    input.actions.slice(0, 3).forEach((a, i) => lines.push(`${i + 1}. ${a.title}. ${a.detail}`));
  }
  if (input.quietNames.length) lines.push('', `*Went quiet:* ${input.quietNames.slice(0, 8).join(', ')}${input.quietNames.length > 8 ? ` and ${input.quietNames.length - 8} more` : ''}.`);
  lines.push('', input.link);
  return lines.join('\n');
}
