import type { InstituteItem, InstituteSource, LearningMode, Topic, WatchEntry } from '@/types/domain';

/**
 * The pure rules behind a student's institute home (src/content/ui/InstituteHome.tsx): which lesson is
 * featured, the shelves in the faculty's order, what counts as completed, and what the student is told
 * about sharing. No React, no storage, no network — so every rule here is tested on its own.
 */

/** The same completion convention as personal Spaces and the progress milestones (src/institutes/model.ts). */
export const COMPLETED_AT = 0.8;

/** One video lesson, with its place in the course. */
export interface Lesson {
  videoId: string;
  topicId: string;
  /** 1-based position among the course's video lessons, in the faculty's order. */
  number: number;
  quizId?: string;
}

/** An assignment as `/v1/institutes/:org/assignments` returns it. */
export interface Assignment {
  id?: string;
  item_ref: string;
  kind?: 'today' | 'homework' | string;
  note?: string | null;
  due_on?: number | null;
}

export interface Featured {
  lesson: Lesson;
  /** today: the batch's class for today · next: the first lesson not yet completed · review: the course is done. */
  reason: 'today' | 'next' | 'review';
  note: string | null;
}

/** An institute Space is read-only everywhere: no edit, rename, delete or subtopic controls. */
export const isReadOnlySpace = (mode: Pick<LearningMode, 'source' | 'kind'>): boolean => !!mode.source || mode.kind === 'institute';

/** Video lessons in course order. Playlists stay out: they have no single video to show or complete. */
export function courseLessons(source: Pick<InstituteSource, 'items'>): Lesson[] {
  const lessons: Lesson[] = [];
  for (const item of source.items) {
    if (item.type !== 'video' || !item.videoId) continue;
    lessons.push({ videoId: item.videoId, topicId: item.topicId, number: lessons.length + 1, ...(item.quizId ? { quizId: item.quizId } : {}) });
  }
  return lessons;
}

/** Videos this student finished in this Space, from their own watch history (kept in this browser). */
export function completedVideos(history: WatchEntry[] | undefined, modeId: string): Set<string> {
  const done = new Set<string>();
  for (const entry of history ?? []) if (entry.modeId === modeId && entry.progress >= COMPLETED_AT) done.add(entry.videoId);
  return done;
}

/** How far into each lesson the student got, for "Resume" and the progress bar. Highest wins. */
export function watchedShare(history: WatchEntry[] | undefined, modeId: string): Map<string, { progress: number; durationSec: number | null }> {
  const out = new Map<string, { progress: number; durationSec: number | null }>();
  for (const entry of history ?? []) {
    if (entry.modeId !== modeId) continue;
    const prior = out.get(entry.videoId);
    if (!prior || entry.progress > prior.progress) out.set(entry.videoId, { progress: entry.progress, durationSec: entry.durationSec ?? prior?.durationSec ?? null });
  }
  return out;
}

export const isVideoRef = (ref: string) => /^[\w-]{11}$/.test(ref);

export function splitAssignments(assignments: Assignment[]): { today: Assignment[]; homework: Assignment[] } {
  return {
    today: assignments.filter((a) => a.kind === 'today'),
    homework: assignments.filter((a) => a.kind === 'homework'),
  };
}

/**
 * The billboard's lesson: today's class when the batch has one (the first one in the course, preferring
 * one not yet watched), otherwise the next lesson not yet completed, in course order. A finished course
 * features its first lesson for review. Null only for a course with no video lessons.
 */
export function pickFeatured(lessons: Lesson[], completed: Set<string>, assignments: Assignment[] = []): Featured | null {
  if (!lessons.length) return null;
  const byVideo = new Map(lessons.map((lesson) => [lesson.videoId, lesson]));
  const todays = splitAssignments(assignments)
    .today.filter((a) => byVideo.has(a.item_ref))
    .map((a) => ({ lesson: byVideo.get(a.item_ref)!, note: a.note?.trim() || null }));
  const today = todays.find((t) => !completed.has(t.lesson.videoId)) ?? todays[0];
  if (today) return { lesson: today.lesson, reason: 'today', note: today.note };

  const next = lessons.find((lesson) => !completed.has(lesson.videoId));
  if (next) return { lesson: next, reason: 'next', note: null };
  return { lesson: lessons[0], reason: 'review', note: null };
}

export interface Shelf {
  topic: Topic;
  /** Exactly the faculty's order — never re-ranked. */
  lessons: Lesson[];
  /** Playlist items in this topic (shown as links, not posters). */
  playlists: string[];
}

/** One shelf per topic, topics and lessons both in course order. Topics with nothing in them are skipped. */
export function topicShelves(mode: Pick<LearningMode, 'topics'>, source: Pick<InstituteSource, 'items'>, topicIds?: Set<string>): Shelf[] {
  const lessons = courseLessons(source);
  const playlistsOf = (topicId: string) =>
    source.items.filter((item: InstituteItem) => item.topicId === topicId && item.type === 'playlist' && item.playlistId).map((item) => item.playlistId!);
  return mode.topics
    .filter((topic) => !topicIds || topicIds.has(topic.id))
    .map((topic) => ({ topic, lessons: lessons.filter((lesson) => lesson.topicId === topic.id), playlists: playlistsOf(topic.id) }))
    .filter((shelf) => shelf.lessons.length > 0 || shelf.playlists.length > 0);
}

/** A faculty quiz opens once its lesson is completed — the server refuses it before that anyway. */
export const showsQuizChip = (lesson: Pick<Lesson, 'quizId' | 'videoId'>, completed: Set<string>): boolean => !!lesson.quizId && completed.has(lesson.videoId);

/** Completed lessons per topic, and how many lessons each topic has — the path's progress. */
export function topicProgress(lessons: Lesson[], completed: Set<string>): { done: Map<string, number>; total: Map<string, number> } {
  const done = new Map<string, number>();
  const total = new Map<string, number>();
  for (const lesson of lessons) {
    total.set(lesson.topicId, (total.get(lesson.topicId) ?? 0) + 1);
    if (completed.has(lesson.videoId)) done.set(lesson.topicId, (done.get(lesson.topicId) ?? 0) + 1);
  }
  return { done, total };
}

/** One plain line about what the institute sees. Sharing never unlocks or locks anything in FocusSpace. */
export function sharingLine(source: Pick<InstituteSource, 'progressConsent'>): string {
  return source.progressConsent ? 'Your institute sees your course progress and quiz scores' : 'Only course totals are shared';
}
