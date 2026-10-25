import { describe, expect, it } from 'vitest';
import type { WatchEntry } from '@/types/domain';
import { blankMode } from '@/modes/templates';
import { compileCourse, type CoursePayload } from './model';
import { completedVideos, courseLessons, isReadOnlySpace, pickFeatured, sharingLine, showsQuizChip, topicProgress, topicShelves, watchedShare } from './home';

/** Ids are deliberately out of alphabetical order, so "course order" can't pass by accident of sorting. */
const V = { z: 'zzzzzzzzzz1', a: 'aaaaaaaaaa2', m: 'mmmmmmmmmm3', b: 'bbbbbbbbbb4', q: 'qqqqqqqqqq5' };

const payload: CoursePayload = {
  brand: { name: 'Demo Academy' },
  subjects: [
    {
      id: 'history',
      title: 'History',
      topics: [
        { id: 'ancient', title: 'Ancient', subtopics: ['Indus valley'], items: [{ type: 'video', videoId: V.z }, { type: 'video', videoId: V.a, quizId: 'quiz1' }] },
        { id: 'modern', title: 'Modern', subtopics: [], items: [{ type: 'playlist', playlistId: 'PLmodern' }, { type: 'video', videoId: V.m }] },
      ],
    },
    { id: 'polity', title: 'Polity', topics: [{ id: 'basics', title: 'Basics', subtopics: [], items: [{ type: 'video', videoId: V.b }, { type: 'video', videoId: V.q }] }] },
  ],
  approvedChannels: [{ id: `UC${'a'.repeat(22)}` }],
  modes: [],
};

const mode = compileCourse({ orgId: 'org', courseId: 'course', batchId: 'batch', courseVersion: 3, etag: 'e', org: { name: 'Demo Academy' } }, payload, 1);
const lessons = courseLessons(mode.source!);
const watched = (videoId: string, progress: number, modeId = mode.id): WatchEntry => ({
  videoId,
  title: '',
  channelTitle: '',
  channelId: null,
  modeId,
  topicId: null,
  watchedAt: 1,
  progress,
  durationSec: 600,
  playlistId: null,
  playlistIndex: null,
});

describe('the featured lesson', () => {
  it("is today's class when the batch has one", () => {
    const featured = pickFeatured(lessons, new Set(), [{ item_ref: V.m, kind: 'today', note: 'Revise before class' }]);
    expect(featured).toMatchObject({ reason: 'today', note: 'Revise before class', lesson: { videoId: V.m, number: 3 } });
  });

  it('prefers a today assignment not yet watched, and ignores homework and playlists', () => {
    const featured = pickFeatured(lessons, new Set([V.z]), [
      { item_ref: 'PLmodern', kind: 'today' },
      { item_ref: V.b, kind: 'homework' },
      { item_ref: V.z, kind: 'today' },
      { item_ref: V.q, kind: 'today' },
    ]);
    expect(featured).toMatchObject({ reason: 'today', lesson: { videoId: V.q } });
  });

  it('is otherwise the next unwatched lesson in course order', () => {
    expect(pickFeatured(lessons, new Set())).toMatchObject({ reason: 'next', lesson: { videoId: V.z, number: 1 } });
    expect(pickFeatured(lessons, new Set([V.z, V.a]))).toMatchObject({ reason: 'next', lesson: { videoId: V.m } });
    // A today assignment for a video outside the course is not a class in this course.
    expect(pickFeatured(lessons, new Set([V.z]), [{ item_ref: 'notinthis11', kind: 'today' }])).toMatchObject({ reason: 'next', lesson: { videoId: V.a } });
  });

  it('features the first lesson for review once everything is completed, and nothing for an empty course', () => {
    expect(pickFeatured(lessons, new Set(Object.values(V)))).toMatchObject({ reason: 'review', lesson: { videoId: V.z } });
    expect(pickFeatured([], new Set())).toBeNull();
  });
});

describe('shelves', () => {
  it('are one per topic, in course order, with lessons in the faculty order', () => {
    const shelves = topicShelves(mode, mode.source!);
    expect(shelves.map((s) => s.topic.id)).toEqual(['ancient', 'modern', 'basics']);
    expect(shelves.flatMap((s) => s.lessons.map((l) => l.videoId))).toEqual([V.z, V.a, V.m, V.b, V.q]);
    expect(shelves.flatMap((s) => s.lessons.map((l) => l.number))).toEqual([1, 2, 3, 4, 5]);
    expect(shelves[1].playlists).toEqual(['PLmodern']);
  });

  it('narrow to the selected topics without reordering them', () => {
    expect(topicShelves(mode, mode.source!, new Set(['basics', 'ancient'])).map((s) => s.topic.id)).toEqual(['ancient', 'basics']);
  });
});

describe('completion and quizzes', () => {
  it("counts only this Space's finished lessons (80% or more)", () => {
    const done = completedVideos([watched(V.z, 0.8), watched(V.a, 0.79), watched(V.m, 1, 'another-space')], mode.id);
    expect([...done]).toEqual([V.z]);
    expect(watchedShare([watched(V.a, 0.3), watched(V.a, 0.6)], mode.id).get(V.a)).toEqual({ progress: 0.6, durationSec: 600 });
  });

  it('shows the institute quiz chip only once its lesson is completed', () => {
    const quizLesson = lessons.find((l) => l.quizId)!;
    expect(showsQuizChip(quizLesson, new Set())).toBe(false);
    expect(showsQuizChip(quizLesson, new Set([quizLesson.videoId]))).toBe(true);
    expect(showsQuizChip(lessons[0], new Set([lessons[0].videoId]))).toBe(false);
  });

  it('measures path progress per topic from completed lessons', () => {
    const { done, total } = topicProgress(lessons, new Set([V.z, V.b]));
    expect(Object.fromEntries(total)).toEqual({ ancient: 2, modern: 1, basics: 2 });
    expect(Object.fromEntries(done)).toEqual({ ancient: 1, basics: 1 });
  });
});

describe('read-only and sharing', () => {
  it('marks institute Spaces read-only and personal Spaces editable', () => {
    expect(isReadOnlySpace(mode)).toBe(true);
    expect(isReadOnlySpace({ ...blankMode('x', 1), kind: 'institute' })).toBe(true);
    expect(isReadOnlySpace(blankMode('personal', 1))).toBe(false);
  });

  it('says plainly what is shared', () => {
    expect(sharingLine({ progressConsent: true })).toBe('Your institute sees your course progress and quiz scores');
    expect(sharingLine({ progressConsent: false })).toBe('Only course totals are shared');
  });
});
