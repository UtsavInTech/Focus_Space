/**
 * The student's own report for an institute course, worked out on their device from their own watch
 * history and the quiz scores kept with the course: where they are, how much they have done, how their
 * quizzes are going and how they study. Nothing here is sent anywhere.
 */
import type { WatchEntry } from '@/types/domain';
import type { LocalScore } from './model';
import { completedVideos, type Lesson } from './home';

const DAY = 86400000;

export interface StudentReport {
  done: number;
  total: number;
  seconds: number;
  /** The course lecture watched most recently, and the first one not yet finished, in the faculty's order. */
  current: Lesson | null;
  next: Lesson | null;
  quiz: { average: number | null; count: number; trend: 'rising' | 'falling' | 'steady' | null; recent: number[] };
  study: { daysLast28: number; daysPerWeek: number; usualTime: string | null; streak: number; lastActive: number | null; week: boolean[] };
}

export function studentReport(history: WatchEntry[] | undefined, modeId: string, lessons: Lesson[], scores: LocalScore[] | undefined, now: number, offsetMinutes = 330): StudentReport {
  const inCourse = new Set(lessons.map((l) => l.videoId));
  const mine = (history ?? []).filter((e) => e.modeId === modeId && inCourse.has(e.videoId));
  const completed = completedVideos(history, modeId);
  const done = lessons.filter((l) => completed.has(l.videoId)).length;

  // Time: how far into each lecture, times its length (the furthest point reached, once per lecture).
  const furthest = new Map<string, number>();
  for (const e of mine) if (e.durationSec) furthest.set(e.videoId, Math.max(furthest.get(e.videoId) ?? 0, e.progress * e.durationSec));
  const seconds = Math.round([...furthest.values()].reduce((a, b) => a + b, 0));

  const latest = [...mine].sort((a, b) => b.watchedAt - a.watchedAt)[0];
  const current = latest ? lessons.find((l) => l.videoId === latest.videoId) ?? null : null;
  const next = lessons.find((l) => !completed.has(l.videoId)) ?? null;

  const ordered = [...(scores ?? [])].sort((a, b) => a.at - b.at).map((s) => Math.round((s.score / s.total) * 100));
  const average = ordered.length ? Math.round(ordered.reduce((a, b) => a + b, 0) / ordered.length) : null;
  let trend: StudentReport['quiz']['trend'] = null;
  if (ordered.length >= 4) {
    const half = Math.floor(ordered.length / 2);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const delta = avg(ordered.slice(half)) - avg(ordered.slice(0, half));
    trend = delta >= 5 ? 'rising' : delta <= -5 ? 'falling' : 'steady';
  }

  // Study days in the student's local time (IST by default).
  const moments = [...mine.map((e) => e.watchedAt), ...(scores ?? []).map((s) => s.at)].filter((t) => t > 0);
  const dayOf = (t: number) => Math.floor((t + offsetMinutes * 60000) / DAY);
  const days = new Set(moments.map(dayOf));
  const today = dayOf(now);
  const daysLast28 = [...days].filter((d) => today - d < 28).length;
  const first = days.size ? Math.min(...days) : today;
  const weeks = Math.max(1, Math.min(4, (today - first + 1) / 7));
  let streak = 0;
  for (let d = days.has(today) ? today : today - 1; days.has(d); d -= 1) streak += 1;
  const hours = Array.from({ length: 24 }, () => 0);
  for (const t of moments) hours[new Date(t + offsetMinutes * 60000).getUTCHours()] += 1;

  return {
    done,
    total: lessons.length,
    seconds,
    current,
    next,
    quiz: { average, count: ordered.length, trend, recent: ordered.slice(-12) },
    study: {
      daysLast28,
      daysPerWeek: Math.round((Math.min(daysLast28, days.size) / weeks) * 10) / 10,
      usualTime: moments.length >= 3 ? usualTime(hours) : null,
      streak,
      lastActive: moments.length ? Math.max(...moments) : null,
      week: Array.from({ length: 7 }, (_, i) => days.has(today - 6 + i)),
    },
  };
}

function usualTime(hours: number[]): string {
  const span = (from: number, to: number) => hours.slice(from, to).reduce((a, b) => a + b, 0);
  const buckets: [string, number][] = [
    ['early mornings', span(4, 9)],
    ['daytime', span(9, 17)],
    ['evenings', span(17, 21)],
    ['late nights', span(21, 24) + span(0, 4)],
  ];
  return buckets.sort((a, b) => b[1] - a[1])[0][0];
}

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
