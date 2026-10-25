import { getItem, getItems, setItem, updateItem } from '@/storage/storage';
import { ownerGuard } from '@/storage/ownership';
import { apiBaseUrl, status } from './auth';
import { compileCourse, instituteModeId, mergeInstituteModes, milestoneFor, type InstituteMembership, type InstituteCache } from '@/institutes/model';
import type { LearningMode } from '@/types/domain';
import type { CoursePayload } from '@/institutes/model';

/**
 * Institute courses in the service worker: syncing the learner's courses into read-only Spaces, and
 * reporting course milestones and quiz scores. Every call is made as the signed-in account that owns this
 * browser's data; nothing is sent for a personal Space.
 */

/** A server answer with its HTTP status, so callers can tell "you no longer have access" from "try again". */
class InstituteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Session = { base: string; token: string; user: string };
type Result = { ok: boolean; error?: string };

const REQUEST_TIMEOUT_MS = 20000;
/** Course lists are refreshed at most this often unless forced (YouTube open, or after a change). */
const SYNC_INTERVAL_MS = 4 * 3600000;
/** Milestones wait this long so a burst of progress updates goes out as one request. */
const MILESTONE_DELAY_MS = 1500;
const MILESTONE_RETRY_MS = 10000;
const MILESTONE_ATTEMPTS = 5;
const MAX_PENDING_MILESTONES = 100;

/** These statuses mean the content is genuinely gone for this account — not a network blip. */
const isAccessLost = (e: unknown, statuses: number[]) => e instanceof InstituteError && statuses.includes(e.status);

/** A session only when the signed-in account is also the owner of this browser's data. */
async function session(): Promise<Session | null> {
  const [base, auth] = await Promise.all([apiBaseUrl(), status()]);
  const ownership = await getItem('ownership');
  if (!base || !auth.user || !auth.accessToken || ownership.owner !== auth.user.id) return null;
  return { base, token: auth.accessToken, user: auth.user.id };
}

async function json<T>(s: Session, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${s.base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${s.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json();
  if (!response.ok) throw new InstituteError(data.error ?? 'Institute request failed.', response.status);
  return data as T;
}

/* ─── Sync ──────────────────────────────────────────────────────────────────── */

let syncing: Promise<Result> | undefined;

/** One sync at a time; a second caller shares the one already running. */
export function syncInstitutes(force = false): Promise<Result> {
  if (syncing) return syncing;
  syncing = sync(force)
    .catch((e) => ({ ok: false, error: (e as Error).message }))
    .finally(() => {
      syncing = undefined;
    });
  return syncing;
}

/** An explicit refusal of the membership list removes every institute Space and its cache. */
async function forgetAllCourses(): Promise<void> {
  await updateItem('modes', (m) => mergeInstituteModes(m, []));
  await setItem('instituteCache', { lastSync: 0, courses: {} });
  await repairCourseSelection();
}

/** The published version's payload, revalidated by ETag so an unchanged course costs a 304. */
async function fetchCourse(s: Session, membership: InstituteMembership, old: InstituteCache['courses'][string] | undefined) {
  const response = await fetch(`${s.base}/v1/courses/${encodeURIComponent(membership.courseId)}/v/${membership.courseVersion}`, {
    headers: { Authorization: `Bearer ${s.token}`, ...(old ? { 'If-None-Match': old.etag } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 304 && old) return { payload: old.payload, etag: old.etag };
  const data = await response.json();
  if (!response.ok) throw new InstituteError(data.error ?? 'Course unavailable.', response.status);
  return { payload: data.payload as CoursePayload, etag: response.headers.get('ETag') ?? (data.etag as string) };
}

async function sync(force: boolean): Promise<Result> {
  const s = await session();
  if (!s) return { ok: true };
  const guard = await ownerGuard();
  const cache = await getItem('instituteCache');
  if (!force && Date.now() - cache.lastSync < SYNC_INTERVAL_MS) return { ok: true };

  let memberships: InstituteMembership[];
  try {
    memberships = (await json<{ courses: InstituteMembership[] }>(s, '/v1/me/institutes')).courses;
  } catch (e) {
    if (isAccessLost(e, [401, 403]) && (await guard())) await forgetAllCourses();
    throw e;
  }
  if (!Array.isArray(memberships)) throw new Error('Invalid institute membership response.');

  let failed = false;
  const courses: InstituteCache['courses'] = {};
  const incoming: LearningMode[] = [];
  for (const membership of memberships) {
    const key = instituteModeId(membership);
    const old = cache.courses[key];
    try {
      const { payload, etag } = await fetchCourse(s, membership, old);
      courses[key] = { membership, payload, etag };
      incoming.push(compileCourse(membership, payload));
    } catch (e) {
      failed = true;
      // Offline or a server error: keep the saved course (with today's sharing choices). Lost access: drop it.
      if (old && !isAccessLost(e, [401, 403, 404])) {
        courses[key] = { ...old, membership: { ...old.membership, consents: membership.consents } };
        incoming.push(compileCourse({ ...old.membership, consents: membership.consents }, old.payload));
      }
    }
  }
  if (!(await guard())) return { ok: false };

  const { modes, settings } = await getItems(['modes', 'settings']);
  const merged = mergeInstituteModes(modes, incoming);
  // A learner with no institute Spaces before or after: leave `modes` untouched (no write, no change event).
  if (merged !== modes && !(incoming.length === 0 && modes.every((m) => !m.source))) await setItem('modes', merged);
  await repairCourseSelection();
  if (incoming.length && !settings.onboarded) {
    await updateItem('settings', (v) => ({
      ...v,
      onboarded: true,
      exam: v.exam ?? 'none',
      activeModeId: v.activeModeId ?? incoming[0].id,
      defaultModeId: v.defaultModeId ?? incoming[0].id,
    }));
  }
  // A partial failure retries on the next sync rather than waiting out the interval.
  await setItem('instituteCache', { lastSync: failed ? 0 : Date.now(), courses });
  return { ok: true };
}

/** If the active or default Space was an institute course that no longer exists, fall back to the first Space. */
async function repairCourseSelection(): Promise<void> {
  const { modes, settings } = await getItems(['modes', 'settings']);
  const missing = (id: string | null) => !!id?.startsWith('institute:') && !modes.some((m) => m.id === id);
  if (!missing(settings.activeModeId) && !missing(settings.defaultModeId)) return;
  await updateItem('settings', (v) => ({
    ...v,
    activeModeId: missing(v.activeModeId) ? (modes[0]?.id ?? null) : v.activeModeId,
    defaultModeId: missing(v.defaultModeId) ? (modes[0]?.id ?? null) : v.defaultModeId,
  }));
}

/* ─── Leaving and withdrawing ───────────────────────────────────────────────── */

export async function leaveInstitute(modeId: string) {
  const guard = await ownerGuard();
  const mode = (await getItem('modes')).find((m) => m.id === modeId);
  if (!mode?.source) throw new Error('Not an institute course.');
  const source = mode.source;
  const s = await session();
  if (!s) throw new Error('Sign in to leave a course.');
  await json(s, `/v1/institutes/${source.courseId}/leave`, { orgId: source.orgId });
  if (!(await guard())) return { ok: false };
  await updateItem('modes', (m) => m.filter((v) => v.source?.courseId !== source.courseId || v.source.orgId !== source.orgId));
  await repairCourseSelection();
  await syncInstitutes(true);
  return { ok: true };
}

export async function withdrawInstitute(orgId: string) {
  const s = await session();
  if (!s) throw new Error('Sign in first.');
  await json(s, '/v1/consents', { orgId, consents: { textVersion: 'institute-consent-v1', progress: false, contact: false } });
  await syncInstitutes(true);
  return { ok: true };
}

/* ─── Milestones ────────────────────────────────────────────────────────────── */

type Milestone = NonNullable<ReturnType<typeof milestoneFor>>;

/** Coalesced in memory, keyed by account so one learner's pending events never go out as another's. */
const pending = new Map<string, Milestone>();
let timer: ReturnType<typeof setTimeout> | undefined;
let attempts = 0;

function scheduleFlush(owner: string, delay: number) {
  timer = setTimeout(() => {
    timer = undefined;
    void flushMilestones(owner);
  }, delay);
}

export async function recordMilestone(input: { modeId: string; videoId: string; progress: number; seconds: number }) {
  const modes = await getItem('modes');
  const mode = modes.find((m) => m.id === input.modeId) ?? null;
  const event = milestoneFor(mode, input.videoId, input.progress, input.seconds);
  if (!event) return { ok: true };
  const s = await session();
  if (!s) return { ok: false };

  const key = `${s.user}:${event.orgId}:${event.courseId}:${event.videoId}`;
  const prior = pending.get(key);
  if (!prior || event.seconds >= prior.seconds) pending.set(key, event);
  if (pending.size > MAX_PENDING_MILESTONES) pending.delete(pending.keys().next().value!);
  if (!timer) scheduleFlush(s.user, MILESTONE_DELAY_MS);
  return { ok: true };
}

/**
 * Sends this owner's pending milestones. A refusal (400/401/403/404) drops them — retrying cannot help;
 * anything else retries a few times. This is best effort: closing the browser can lose pending events.
 */
async function flushMilestones(owner: string) {
  const s = await session();
  if (!s || s.user !== owner) {
    pending.clear();
    return;
  }
  const guard = await ownerGuard();
  const events = [...pending.entries()].filter(([key]) => key.startsWith(`${owner}:`));
  if (!events.length) return;

  try {
    await json(s, '/v1/progress', { events: events.map(([, event]) => event) });
    if (!(await guard())) {
      pending.clear();
      return;
    }
    // Only what was sent: an event that changed while the request was in flight stays queued.
    for (const [key, event] of events) if (pending.get(key) === event) pending.delete(key);
    attempts = 0;
  } catch (e) {
    if (isAccessLost(e, [400, 401, 403, 404])) {
      pending.clear();
      attempts = 0;
    } else if (++attempts < MILESTONE_ATTEMPTS && !timer) {
      scheduleFlush(owner, MILESTONE_RETRY_MS);
    }
  }
}

/* ─── Quizzes and assignments ───────────────────────────────────────────────── */

/** A self-reported "Quiz me" score — sent only while progress sharing is on, and only for a course video. */
export async function reportQuizScore(input: { modeId: string; videoId: string; score: number; total: number }) {
  const mode = (await getItem('modes')).find((m) => m.id === input.modeId);
  if (!mode?.source?.progressConsent || !mode.source.items.some((item) => item.videoId === input.videoId)) return { ok: true };
  const s = await session();
  if (!s) return { ok: false };
  await json(s, '/v1/institutes/quiz-score', { orgId: mode.source.orgId, courseId: mode.source.courseId, videoId: input.videoId, score: input.score, total: input.total });
  return { ok: true };
}

/** One message for the student's reads and quiz submission: a quiz (open, or submit with answers), else assignments. */
export async function instituteStudentRequest(input: { orgId: string; courseId?: string; quizId?: string; answers?: number[] }) {
  const s = await session();
  if (!s) throw new Error('Sign in first.');
  if (input.quizId) return input.answers ? json(s, '/v1/quiz-attempts', input) : json(s, `/v1/institutes/quizzes/${input.orgId}/${input.quizId}`);
  return json(s, `/v1/institutes/${input.orgId}/assignments?courseId=${encodeURIComponent(input.courseId ?? '')}`);
}
