import type { CoursePayload } from '../../server/institutes/types';

/**
 * The demo's fictional institute and course. Everything here is authored demo data: the institute name,
 * accent, subjects and topics. The only YouTube data is the list of video ids below — ids only, never a
 * title or thumbnail (those load from YouTube at display time, as for a real institute).
 *
 * VIDEO_IDS must come from one public UPSC lecture playlist, in its order. It ships empty because the
 * environment this demo was written in could not reach YouTube to pick and check real ids, and an
 * invented id would only show a broken poster. Fill it once, on a machine that can reach YouTube:
 *
 *   node scripts/institute-demo.mjs --ids-from-playlist "https://www.youtube.com/playlist?list=PL…"
 *
 * prints the playlist's ids ready to paste here (no API key: it reads the public playlist page once).
 * Or pass them for one run with `--ids id1,id2,…`. At least five are needed, one per topic.
 */
export const VIDEO_IDS: string[] = [];

export const DEMO = {
  org: { slug: 'demo-ias-academy', name: 'Demo IAS Academy', accent: '#c2410c' },
  course: { title: 'GS Foundation 2026' },
  /** A syntactically valid, fictional channel id: the demo has no real source channel. */
  channelId: 'UCDemoIASAcademy00000000',
  batch: { name: 'Morning batch 2026', seats: 60 },
  /**
   * The join code students type. The server accepts codes of 10–100 characters, so the demo's code is
   * DEMO-2026-IAS rather than the 9-character DEMO-2026.
   */
  joinCode: 'DEMO-2026-IAS',
  password: 'demo-password-2026',
  users: {
    staff: 'demo-staff@example.com',
    faculty: 'demo-faculty@example.com',
    student: 'demo-student@example.com',
  },
  studentPhone: '+919876500001',
} as const;

/** Subjects and topics in teaching order; the playlist's videos are dealt into topics in this order. */
const OUTLINE = [
  { id: 'polity', title: '1 · Polity', topics: [
    { id: 'constitution-basics', title: 'Constitution basics', subtopics: ['Preamble', 'Salient features', 'Sources of the Constitution'] },
    { id: 'fundamental-rights', title: 'Fundamental Rights', subtopics: ['Right to equality', 'Writs', 'Reasonable restrictions'] },
  ] },
  { id: 'modern-history', title: '2 · Modern History', topics: [
    { id: 'revolt-1857', title: '1857 and after', subtopics: ['Causes of the revolt', 'Crown rule'] },
    { id: 'national-movement', title: 'National movement', subtopics: ['Moderates and extremists', 'Non-cooperation', 'Quit India'] },
  ] },
  { id: 'geography', title: '3 · Geography', topics: [
    { id: 'physical-geography', title: 'Physical geography', subtopics: ['Interior of the earth', 'Plate tectonics', 'Climatology'] },
  ] },
];

const topicCount = OUTLINE.reduce((n, subject) => n + subject.topics.length, 0);

/** Deals the ids into topics in order, as evenly as possible; the first topics take any remainder. */
export function demoPayload(ids: readonly string[], quizzes: Record<string, string> = {}): CoursePayload {
  if (ids.length < topicCount) throw new Error(`The demo needs at least ${topicCount} video ids (one per topic); got ${ids.length}.`);
  const per = Math.floor(ids.length / topicCount);
  let extra = ids.length % topicCount;
  let at = 0;
  const take = () => {
    const n = per + (extra-- > 0 ? 1 : 0);
    const slice = ids.slice(at, at + n);
    at += n;
    return slice;
  };
  return {
    brand: { name: DEMO.org.name, accent: DEMO.org.accent },
    subjects: OUTLINE.map((subject) => ({
      id: subject.id,
      title: subject.title,
      topics: subject.topics.map((topic) => ({
        ...topic,
        items: take().map((videoId) => ({ type: 'video' as const, videoId, ...(quizzes[videoId] ? { quizId: quizzes[videoId] } : {}) })),
      })),
    })),
    approvedChannels: [{ id: DEMO.channelId }],
    modes: [],
  };
}
