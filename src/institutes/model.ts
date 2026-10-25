import type { FilterConfig, InstituteItem, LearningMode } from '@/types/domain';
import { blankMode } from '@/modes/templates';
import type { CoursePayload } from '../../server/institutes/types';

export type { CoursePayload };

/** One course the signed-in learner is enrolled in, as `/v1/me/institutes` lists it. */
export interface InstituteMembership {
  orgId: string;
  courseId: string;
  batchId?: string | null;
  courseVersion: number;
  etag: string;
  title?: string;
  org: { name: string; logo?: string | null; accent?: string | null };
  consents?: { progress: boolean; contact: boolean };
}

export interface InstituteCache {
  lastSync: number;
  courses: Record<string, { membership: InstituteMembership; payload: CoursePayload; etag: string }>;
}

type CourseItem = InstituteItem;

/** Institute Spaces filter hard and never discover: the faculty's course is the whole feed. */
const INSTITUTE_FILTERS: FilterConfig = {
  intensity: 'strict',
  filters: {
    hideShorts: true,
    replaceHomeFeed: true,
    relatedVideos: 'hide',
    hideEndScreens: true,
    hideExplore: true,
    hideComments: false,
    hideNotifications: false,
    searchResults: 'show',
  },
};

export const instituteModeId = (m: Pick<InstituteMembership, 'orgId' | 'courseId' | 'batchId'>) => `institute:${m.orgId}:${m.courseId}:${m.batchId ?? 'free'}`;

/** Every item in faculty order, tagged with the topic it sits in. */
function courseItems(payload: CoursePayload): CourseItem[] {
  return payload.subjects.flatMap((subject) => subject.topics.flatMap((topic) => topic.items.map((item) => ({ ...item, topicId: topic.id }))));
}

function hasInvalidId(item: CourseItem): boolean {
  if (item.type === 'video') return !/^[\w-]{11}$/.test(item.videoId ?? '');
  return item.type !== 'playlist' || !/^[\w-]+$/.test(item.playlistId ?? '');
}

/** Branding is shown only when it is safe to render: an https logo and a plain hex accent. */
const safeLogo = (logo: string | null | undefined) => (logo?.startsWith('https://') ? logo : undefined);
const safeAccent = (accent: string | null | undefined) => (/^#[\da-f]{6}$/i.test(accent ?? '') ? accent! : undefined);

/** Turns a published course into a read-only Space. Throws on anything malformed rather than storing it. */
export function compileCourse(m: InstituteMembership, payload: CoursePayload, now = Date.now()): LearningMode {
  if (!payload || !Array.isArray(payload.subjects) || !Array.isArray(payload.approvedChannels) || !payload.brand?.name) throw new Error('Invalid institute course.');
  const id = instituteModeId(m);
  const mode = blankMode(id, now);
  const items = courseItems(payload);
  if (items.some(hasInvalidId)) throw new Error('Invalid institute video/playlist id.');

  return {
    ...mode,
    name: m.title ?? `${m.org.name} course`,
    kind: 'institute',
    icon: 'graduation-cap',
    description: `${m.org.name} · Read-only institute course`,
    topics: payload.subjects.flatMap((subject) => subject.topics.map((topic) => ({ id: topic.id, name: topic.title, group: subject.title, keywords: topic.subtopics }))),
    discovery: false,
    // A fresh copy per Space, as before: no two Spaces share one mutable filter object.
    filterOverride: { ...INSTITUTE_FILTERS, filters: { ...INSTITUTE_FILTERS.filters } },
    allowedChannels: payload.approvedChannels.map((c) => ({ id: c.id, title: c.id })),
    source: {
      orgId: m.orgId,
      courseId: m.courseId,
      ...(m.batchId ? { batchId: m.batchId } : {}),
      courseVersion: m.courseVersion,
      orgName: m.org.name,
      logo: safeLogo(m.org.logo),
      accent: safeAccent(m.org.accent),
      items,
      progressConsent: m.consents?.progress === true,
      contactConsent: m.consents?.contact === true,
    },
  };
}

/**
 * Replaces every institute Space with `incoming` and keeps personal Spaces as they are. A learner with no
 * institute gets the very same array back — not a copy — so nothing downstream sees a change.
 */
export function mergeInstituteModes(personalAndOld: LearningMode[], incoming: LearningMode[]): LearningMode[] {
  const personal = personalAndOld.filter((m) => !m.source);
  return incoming.length || personal.length !== personalAndOld.length ? [...personal, ...incoming] : personalAndOld;
}

/** Started is any watched progress, half is 50%, done is 80% — the same completion convention as personal Spaces. */
function stageFor(progress: number): 'started' | 'half' | 'done' {
  if (progress >= 0.8) return 'done';
  if (progress >= 0.5) return 'half';
  return 'started';
}

/** The milestone to report for this watch, or null when it is not an institute course video (personal Spaces report nothing). */
export function milestoneFor(mode: LearningMode | null, videoId: string, progress: number, seconds: number) {
  const inCourse = !!mode?.source?.items.some((item) => item.type === 'video' && item.videoId === videoId);
  if (!mode?.source || !inCourse || progress <= 0) return null;
  return {
    orgId: mode.source.orgId,
    courseId: mode.source.courseId,
    videoId,
    stage: stageFor(progress),
    seconds: Math.max(0, Math.min(86400, Math.round(seconds))),
  };
}
