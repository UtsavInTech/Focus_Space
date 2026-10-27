import {studioWorkflow,type StudioRuntime} from './studio-workflows';
import {contextInput,integer as studioInteger} from './studio-types';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, CORS_HEADERS, readJsonBody, sendJson } from '../http';
import { RateLimiter } from '../auth/rate-limit';
import type { InstitutesDb } from './db';
import { ProgressQueue } from './queue';
import type { Actor, Milestone, OrgRole } from './types';
import * as v from './validate';
import { importChannel, resolveChannel, youtubeFetch } from './import';
import { TitleCache } from './titles';

export interface InstituteDependencies extends StudioRuntime {
  database: () => Promise<InstitutesDb>;
  identity: (authorization: string | undefined) => Actor;
  startPhone: (actor: Actor, phone: string) => Promise<unknown>;
  verifyPhone: (actor: Actor, phone: string, code: string) => Promise<void>;
  staff?: string;
  userExists: (id: string) => boolean;
  clientIp: (request: IncomingMessage) => string;
  /** Lesson titles for the Studio, held in memory only. Tests pass one with a fake fetch. */
  titles?: TitleCache;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** The largest epoch-ms value a JavaScript Date accepts. */
const MAX_EPOCH_MS = 8640000000000000;
const CSV_COLUMNS = ['name', 'phone', 'wants_contact', 'courses', 'completion_percent', 'completed_videos', 'quiz_score', 'watch_seconds', 'last_active'];

/** Staff by account id, or by email only when that email is verified — an unverified address proves nothing. */
export function staffAllowed(actor: Actor, allowList: string): boolean {
  const entries = allowList
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.includes(actor.id)) return true;
  return !!actor.email && actor.emailVerified === true && entries.some((value) => value.toLowerCase() === actor.email!.toLowerCase());
}

/** Quoted, with spreadsheet-formula prefixes neutralised so an exported name can't run as a formula. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^\s*[=+@\-]|^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csv(items: Record<string, unknown>[]): string {
  // Times as readable dates for a spreadsheet, and the priority flag as a plain word.
  const value = (row: Record<string, unknown>, column: string) => {
    if (column === 'last_active') return row.last_active ? new Date(Number(row.last_active)).toISOString().slice(0, 10) : '';
    if (column === 'wants_contact') return row.wants_contact ? 'yes' : 'no';
    return row[column];
  };
  const rows = items.map((row) => CSV_COLUMNS.map((column) => csvCell(value(row, column))).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

export function institutePath(path: string): boolean {
  if (path === '/v1/me/institutes' || path === '/v1/enroll' || path === '/v1/progress' || path === '/v1/quiz-attempts' || path === '/v1/consents') return true;
  if (path.startsWith('/v1/institutes/') || path.startsWith('/v1/courses/') || path.startsWith('/v1/join/') || path.startsWith('/v1/studio/')) return true;
  return path.startsWith('/v1/admin/') && path !== '/v1/admin/metrics';
}

/** Everything one request's handlers need, so each route group is a plain function of it. */
interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  path: string;
  /** `/v1/studio/org/funnel` → `['v1', 'studio', 'org', 'funnel']` */
  parts: string[];
  method: string | undefined;
  /** Undefined only on a public GET made without a session. */
  actor: Actor | undefined;
  db: InstitutesDb;
  queue: ProgressQueue;
  deps: InstituteDependencies;
  body: () => Promise<unknown>;
  respond: (result: unknown, status?: number) => true;
  limited: (limiter: RateLimiter, key: string) => void;
  limiters: Limiters;
}

interface Limiters {
  join: RateLimiter;
  progress: RateLimiter;
  read: RateLimiter;
  /** Studio and admin pages: one screen loads several reads per course, so staff get more room. */
  staff: RateLimiter;
}

/** A handler answers and returns true, or returns false to let the next group try. */
type Handler = (ctx: Context) => Promise<boolean>;

/* ─── The signed-in user's own institute access ────────────────────────────── */

async function accountRoutes({ method, path, actor, db, deps, respond }: Context): Promise<boolean> {
  if (method === 'GET' && path === '/v1/institutes/access') return respond({ staff: staffAllowed(actor!, deps.staff ?? ''), orgs: await db.myOrgs(actor!.id) });
  if (method === 'GET' && path === '/v1/me/institutes') return respond({ courses: await db.mine(actor!.id) });
  return false;
}

/* ─── Public join pages and course metadata ────────────────────────────────── */

async function publicRoutes(ctx: Context): Promise<boolean> {
  const { method, parts, db, deps, respond, limited, limiters } = ctx;
  if (method === 'GET' && parts[1] === 'join' && parts.length === 3) {
    limited(limiters.join, `ip:${deps.clientIp(ctx.req)}`);
    return respond({ batch: await db.resolveJoin(v.text(parts[2], 'join code', 100)) });
  }
  if (method === 'GET' && parts[1] === 'courses') {
    const course = await db.resolveCourse(v.id(parts[2]));
    if (parts.length === 3) return respond({ course });
    if (parts[3] === 'v' && parts.length === 5) return courseVersion(ctx, course);
  }
  return false;
}

async function courseVersion({ req, res, parts, actor, db, respond }: Context, course: Record<string, unknown>): Promise<boolean> {
  const number = v.integer(Number(parts[4]), 'version', 1, 1000000);
  const version = await db.courseVersion(String(course.org_id), String(course.id), number, actor?.id);
  // Always revalidate membership before 304. A former member must not reuse a private cached body.
  res.setHeader('ETag', version.etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  if (req.headers['if-none-match'] === version.etag) {
    res.writeHead(304, CORS_HEADERS);
    res.end();
    return true;
  }
  return respond(version);
}

/* ─── Students: enrolment, consent, progress, quizzes ──────────────────────── */

async function enrolmentRoutes({ req, method, path, url, parts, actor, db, deps, body, respond, limited, limiters }: Context): Promise<boolean> {
  if (method === 'POST' && path === '/v1/enroll') {
    limited(limiters.join, `ip:${deps.clientIp(req)}`);
    limited(limiters.join, `user:${actor!.id}`);
    const input = v.enrollment(await body());
    const course = input.joinCode ? await db.resolveJoin(input.joinCode) : await db.resolveCourse(input.courseId!);
    const enrollment = await db.enroll(String(course.org_id), String(course.course_id ?? course.id), actor!, input);
    return respond({ enrollment }, 201);
  }
  if (method === 'POST' && path === '/v1/consents') {
    const input = v.object(await body());
    await db.changeConsent(v.id(input.orgId), actor!.id, v.sharing(input.consents));
    return respond({});
  }
  if (method === 'GET' && path === '/v1/consents') return respond({ consents: await db.myConsents(v.id(url.searchParams.get('orgId')), actor!.id) });
  if (method === 'GET' && parts[1] === 'institutes' && parts.length === 4 && parts[3] === 'assignments') {
    return respond({ assignments: await db.assignments(v.id(parts[2]), v.id(url.searchParams.get('courseId')), actor!.id) });
  }
  return false;
}

function progressEvent(raw: unknown, userId: string) {
  const event = v.object(raw);
  if (!['started', 'half', 'done'].includes(String(event.stage))) return v.invalid('Invalid milestone.');
  return {
    orgId: v.id(event.orgId),
    courseId: v.id(event.courseId),
    videoId: v.video(event.videoId),
    stage: event.stage as Milestone,
    seconds: v.integer(event.seconds ?? 0, 'seconds', 0, 86400),
    userId,
  };
}

async function progressRoutes({ method, path, actor, db, queue, body, respond, limited, limiters }: Context): Promise<boolean> {
  if (method === 'POST' && path === '/v1/progress') {
    limited(limiters.progress, actor!.id);
    const input = v.object(await body());
    // One milestone, or a batch of up to 100 — the extension coalesces before sending.
    const events = Array.isArray(input.events) ? input.events : [input];
    if (!events.length || events.length > 100) return v.invalid('Send between 1 and 100 milestones.');
    const parsed = events.map((raw) => progressEvent(raw, actor!.id));
    await Promise.all(parsed.map((event) => queue.enqueue(event)));
    return respond({ accepted: parsed.length });
  }
  if (method === 'POST' && path === '/v1/institutes/quiz-score') {
    const input = v.object(await body());
    const total = v.integer(input.total, 'total', 1, 1000);
    const score = v.integer(input.score, 'score', 0, total);
    return respond(await db.quizMeScore(v.id(input.orgId), v.id(input.courseId), actor!.id, v.video(input.videoId), score, total));
  }
  if (method === 'POST' && path === '/v1/quiz-attempts') {
    const input = v.object(await body());
    if (!Array.isArray(input.answers) || input.answers.length > 50) return v.invalid('Invalid answers.');
    const answers = input.answers.map((answer) => v.integer(answer, 'answer', 0, 5));
    return respond(await db.attemptQuiz(v.id(input.orgId), v.id(input.quizId), actor!.id, answers));
  }
  return false;
}

async function studentInstituteRoutes({ method, parts, actor, db, deps, body, respond }: Context): Promise<boolean> {
  if (parts[1] === 'institutes' && parts[2] === 'phone' && method === 'POST') {
    const input = v.object(await body());
    const mobile = v.phone(input.phone);
    if (parts[3] === 'start') return respond(await deps.startPhone(actor!, mobile));
    if (parts[3] === 'verify') {
      const code = v.text(input.code, 'verification code', 6);
      if (!/^\d{6}$/.test(code)) return v.invalid('Enter the six-digit code.');
      await deps.verifyPhone(actor!, mobile, code);
      await db.verifyPhone(actor!, mobile);
      return respond({ verified: true });
    }
  }
  if (parts[1] === 'institutes' && parts.length === 4 && parts[3] === 'leave' && method === 'POST') {
    const input = v.object(await body());
    await db.leave(v.id(input.orgId), v.id(parts[2]), actor!.id);
    return respond({});
  }
  if (parts[1] === 'institutes' && parts[2] === 'contact' && parts.length === 3 && method === 'POST') {
    // "Talk to your faculty": the student asks to be called; the institute sees it first in its inbox.
    const input = v.object(await body());
    const note = input.note === undefined || input.note === '' ? null : v.text(input.note, 'message', 500);
    return respond(await db.requestContact(v.id(input.orgId), v.id(input.courseId), actor!.id, note));
  }
  if (parts[1] === 'institutes' && parts[2] === 'quizzes' && parts.length === 5 && method === 'GET') {
    return respond(await db.quiz(v.id(parts[3]), v.id(parts[4]), actor!.id));
  }
  return false;
}

/* ─── Studio: an institute's own staff. Writes: channel approval and marking a request handled ── */

async function studioRoutes({ res, method, url, parts, actor, db, deps, body, respond }: Context): Promise<boolean> {
  if (parts[1] !== 'studio') return false;
  const orgId = v.id(parts[2]);
  if (!(await db.role(orgId, actor!.id))) throw new ApiError(403, 'forbidden', 'Institute staff access is required.');
  const workflow=await studioWorkflow(db,deps,orgId,actor!.id,method,parts,url,body);if(workflow!==undefined)return respond(workflow);

  if(parts[3]==='context'&&parts.length===4){
    if(method==='GET')return respond(await db.studioContext(orgId));
    if(method==='POST'){const input=v.object(await body());return respond(await db.saveStudioContext(orgId,actor!.id,contextInput(input.data),studioInteger(input.version)));}
  }
  if (method === 'POST' && parts[3] === 'channels' && parts.length === 4) {
    const input = v.object(await body());
    await db.suggestChannel(orgId, v.id(input.courseId), actor!.id, v.channel(input.channelId), true);
    return respond({});
  }
  if (method === 'POST' && parts[3] === 'requests' && parts.length === 6 && parts[5] === 'handled') {
    await db.handleRequest(orgId, v.id(parts[4]), actor!.id);
    return respond({});
  }
  if (method === 'GET' && parts[3] === 'students' && parts.length === 5) return respond(await db.studentReport(orgId, v.id(parts[4]), actor!.id));
  if (method !== 'GET' || parts.length !== 4) return false;

  if (parts[3] === 'setup') return respond(await db.setupChecklist(orgId));
  const filter = v.page(url.searchParams);
  if (parts[3] === 'courses') return respond({ courses: await db.courses(orgId) });
  if (parts[3] === 'channels' && filter.courseId) return respond({ channels: await db.channelSuggestions(orgId, filter.courseId) });
  if (parts[3] === 'funnel') return respond(await db.funnel(orgId, filter.courseId));
  if (parts[3] === 'activity') return respond({ days: await db.activity(orgId, filter.courseId) });
  if (parts[3] === 'requests') return respond({ requests: await db.requests(orgId) });
  if (parts[3] === 'outline' && filter.courseId) {
    // The institute's own published course, so the Studio can group lesson stats into subjects and topics.
    const outline = await db.outline(orgId, filter.courseId);
    const ids = outline.data.subjects.flatMap((s) => s.topics.flatMap((t) => t.items.flatMap((item) => (item.videoId ? [item.videoId] : []))));
    return respond({ ...outline, titles: await deps.titles!.titles(ids) });
  }
  if (parts[3] === 'students') return respond(await db.students(orgId, filter));
  if (parts[3] === 'leads.csv') {
    const result = await db.leads(orgId, actor!.id, filter);
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="focusspace-leads.csv"',
      'Cache-Control': 'no-store',
      ...(result.next ? { 'X-Next-Cursor': result.next } : {}),
      'Access-Control-Expose-Headers': 'X-Next-Cursor',
    });
    res.end(csv(result.items));
    return true;
  }
  return false;
}

/* ─── Admin: FocusSpace staff only (checked before any of these run) ───────── */

function orgInput(input: Record<string, unknown>) {
  const accent = (): string => (/^#[\da-fA-F]{6}$/.test(String(input.accent)) ? String(input.accent) : v.invalid('Invalid accent.'));
  return {
    slug: v.id(input.slug),
    name: v.text(input.name, 'institute name'),
    ...(input.logo === undefined ? {} : { logo: v.https(input.logo) }),
    ...(input.accent === undefined ? {} : { accent: accent() }),
  };
}

async function adminOrgListRoutes({ method, parts, actor, db, body, respond }: Context): Promise<boolean> {
  if (parts[2] !== 'orgs' || parts.length !== 3) return false;
  if (method === 'GET') return respond({ orgs: await db.orgs() });
  if (method === 'POST') {
    const input = v.object(await body());
    return respond({ org: await db.createOrg(actor!.id, orgInput(input)) }, 201);
  }
  return false;
}

/** `/v1/admin/orgs/:org/:resource[/:resourceId[/:action]]` */
interface OrgTarget {
  orgId: string;
  resource: string;
  resourceId: string | undefined;
  action: string | undefined;
}

async function adminOrgReads({ parts, db, respond }: Context, { orgId, resource, resourceId, action }: OrgTarget): Promise<boolean> {
  if (parts.length === 5) {
    if (resource === 'courses') return respond({ courses: await db.courses(orgId) });
    if (resource === 'batches') return respond({ batches: await db.batches(orgId) });
  }
  if (resource === 'courses' && resourceId && parts.length === 7 && action === 'draft') return respond({ draft: await db.draft(orgId, resourceId) });
  return false;
}

async function adminOrgSettings({ parts, actor, db, deps, respond }: Context, { orgId, resource }: OrgTarget, input: Record<string, unknown>): Promise<boolean> {
  if (resource === 'settings' && parts.length === 5) {
    if (!['pilot', 'active', 'paused'].includes(String(input.status))) return v.invalid('Invalid institute status.');
    await db.orgStatus(orgId, actor!.id, input.status as 'pilot' | 'active' | 'paused');
    return respond({});
  }
  if (resource === 'members' && parts.length === 5) {
    if (!['owner', 'admin', 'faculty'].includes(String(input.role))) return v.invalid('Invalid institute role.');
    if (!deps.userExists(v.id(input.userId))) return v.invalid('That FocusSpace account does not exist.');
    await db.setMember(orgId, actor!.id, v.id(input.userId), input.role as OrgRole);
    return respond({});
  }
  return false;
}

/** The import needs the server's YouTube key, and is served from the day's cache after the first run. */
async function importCourse({ actor, db, respond }: Context, orgId: string, courseId: string): Promise<boolean> {
  if (!process.env.YOUTUBE_API_KEY) throw new ApiError(503, 'internal_error', 'YouTube course import is not configured.');
  const claim = await db.claimImport(orgId, courseId);
  if (claim.cached) return respond({ payload: claim.cached, cached: true });
  const { course } = claim;
  const brand = {
    name: String(course.org_name),
    ...(course.logo_url ? { logo: String(course.logo_url) } : {}),
    ...(course.accent_color ? { accent: String(course.accent_color) } : {}),
  };
  const result = await importChannel(String(course.source_channel_id), brand, course.exam_id ? String(course.exam_id) : null, youtubeFetch());
  await db.finishImport(orgId, courseId, actor!.id, result.payload);
  return respond({ ...result, cached: false });
}

async function adminCourseWrites(ctx: Context, { orgId, resource, resourceId, action }: OrgTarget, input: Record<string, unknown>): Promise<boolean> {
  const { parts, actor, db, respond } = ctx;
  if (resource !== 'courses') return false;
  if (parts.length === 5) {
    if (input.kind !== 'free' && input.kind !== 'batch') return v.invalid('Invalid course kind.');
    const course = await db.createCourse(orgId, actor!.id, {
      title: v.text(input.title, 'course title'),
      kind: input.kind,
      channelId: await resolveChannel(v.text(input.channelId, 'channel id or URL', 300), youtubeFetch()),
      examId: input.examId === undefined ? undefined : v.id(input.examId),
    });
    return respond({ course }, 201);
  }
  if (parts.length !== 7 || !resourceId) return false;
  if (action === 'draft') {
    await db.saveDraft(orgId, resourceId, actor!.id, v.payload(input.payload));
    return respond({});
  }
  if (action === 'publish') return respond(await db.publish(orgId, resourceId, actor!.id));
  if (action === 'import') return importCourse(ctx, orgId, resourceId);
  if (action === 'suggestions') {
    await db.suggestChannel(orgId, resourceId, actor!.id, v.channel(input.channelId));
    return respond({});
  }
  if (action === 'quizzes') return respond({ quiz: await db.createQuiz(orgId, resourceId, actor!.id, v.video(input.videoId), v.quiz(input.questions)) }, 201);
  return false;
}

const optionalEpoch = (value: unknown, label: string) => (value === undefined ? undefined : v.integer(value, label, 0, MAX_EPOCH_MS));

async function adminBatchWrites({ parts, actor, db, respond }: Context, { orgId, resource, resourceId, action }: OrgTarget, input: Record<string, unknown>): Promise<boolean> {
  if (resource !== 'batches') return false;
  if (parts.length === 5) {
    const batch = await db.createBatch(orgId, actor!.id, {
      courseId: v.id(input.courseId),
      name: v.text(input.name, 'batch name'),
      seats: v.integer(input.seats, 'seats', 1, 1000000),
      startsOn: optionalEpoch(input.startsOn, 'start'),
      endsOn: optionalEpoch(input.endsOn, 'end'),
    });
    return respond({ batch }, 201);
  }
  if (resourceId && parts.length === 7 && action === 'settings') {
    if (input.status !== 'active' && input.status !== 'paused') return v.invalid('Invalid batch status.');
    await db.batchSettings(orgId, resourceId, actor!.id, input.status, v.integer(input.seats, 'seats', 1, 1000000));
    return respond({});
  }
  if (resourceId && action === 'rotate') return respond(await db.rotateCode(orgId, resourceId, actor!.id));
  if (resourceId && action === 'assignments') {
    if (input.kind !== 'today' && input.kind !== 'homework') return v.invalid('Invalid assignment kind.');
    const assignment = await db.assignment(orgId, resourceId, actor!.id, {
      itemRef: v.id(input.itemRef),
      kind: input.kind,
      note: input.note === undefined ? undefined : v.text(input.note, 'note', 2000),
      dueOn: optionalEpoch(input.dueOn, 'due date'),
    });
    return respond(assignment);
  }
  return false;
}

async function adminOrgRoutes(ctx: Context): Promise<boolean> {
  const { method, parts, actor, db, body, respond } = ctx;
  if (parts[2] !== 'orgs' || parts.length < 5) return false;
  const target: OrgTarget = {
    orgId: v.id(parts[3]),
    resource: parts[4],
    resourceId: parts[5] === undefined ? undefined : v.id(parts[5]),
    action: parts[6],
  };

  if (method === 'GET' && (await adminOrgReads(ctx, target))) return true;
  if (method !== 'POST') return false;

  const input = v.object(await body());
  if (await adminOrgSettings(ctx, target, input)) return true;
  if (await adminCourseWrites(ctx, target, input)) return true;
  if (await adminBatchWrites(ctx, target, input)) return true;
  if (target.resource === 'quizzes' && target.resourceId && target.action === 'publish') {
    await db.publishQuiz(target.orgId, target.resourceId, actor!.id);
    return respond({});
  }
  return false;
}

async function adminRoutes(ctx: Context): Promise<boolean> {
  if (ctx.parts[1] !== 'admin') return false;
  if (await adminOrgListRoutes(ctx)) return true;
  return adminOrgRoutes(ctx);
}

/** Tried in order; the first group that answers wins. */
const HANDLERS: Handler[] = [accountRoutes, publicRoutes, enrolmentRoutes, progressRoutes, studentInstituteRoutes, studioRoutes, adminRoutes];

export function instituteRoutes(input: InstituteDependencies) {
  const deps: InstituteDependencies = { ...input, titles: input.titles ?? new TitleCache() };
  const limiters: Limiters = {
    join: new RateLimiter(20, 10 * 60_000),
    progress: new RateLimiter(120, 60_000),
    read: new RateLimiter(120, 60_000),
    staff: new RateLimiter(600, 60_000),
  };
  let queue: ProgressQueue | undefined;
  const limited = (limiter: RateLimiter, key: string) => {
    if (!limiter.attempt(key)) throw new ApiError(429, 'rate_limited', 'Too many attempts. Try again shortly.');
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (!institutePath(path)) return false;
    const parts = path.split('/').filter(Boolean);

    // Authenticate before touching infrastructure for every private route; do not fall back to guest.
    const publicGet = req.method === 'GET' && (parts[1] === 'courses' || parts[1] === 'join');
    const identity = () => deps.identity(req.headers.authorization);
    const actor = publicGet ? (req.headers.authorization ? identity() : undefined) : identity();
    const staffPage = parts[1] === 'studio' || parts[1] === 'admin';
    limited(staffPage ? limiters.staff : limiters.read, `${staffPage ? 'staff' : 'read'}:${actor?.id ?? deps.clientIp(req)}`);
    if (parts[1] === 'admin' && !staffAllowed(actor!, deps.staff ?? '')) throw new ApiError(403, 'forbidden', 'FocusSpace staff access is required.');

    const db = await deps.database();
    queue ??= new ProgressQueue(db);
    const ctx: Context = {
      req,
      res,
      url,
      path,
      parts,
      method: req.method,
      actor,
      db,
      queue,
      deps,
      limiters,
      limited,
      body: () => readJsonBody(req, MAX_BODY_BYTES),
      respond: (result, status = 200) => {
        sendJson(res, status, { ok: true, ...(typeof result === 'object' && result !== null ? result : {}) });
        return true;
      },
    };

    for (const handler of HANDLERS) if (await handler(ctx)) return true;
    // Matched namespace but unknown method/path: never fall through into another auth/AI handler.
    throw new ApiError(404, 'invalid_request', 'Unknown institute route.');
  };
}
