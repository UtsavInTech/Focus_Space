// The demo API. Run by scripts/institute-demo.mjs through vite-node (for the `@/` imports); not on its own.
//
// It answers institute routes with the real handlers (server/institutes/routes.ts) on the real
// InstitutesDb, over in-process PGlite — the same adapter the tests use — and forwards every other
// request (sign-in, accounts, usage, CORS preflight) to the real FocusSpace API built from server/index.ts,
// which shares this process's SQLite identity file and token secret. Nothing here is a mock of FocusSpace.
import { createServer, request as forward, type IncomingMessage, type ServerResponse } from 'node:http';
import { IdentityDb } from '../../server/auth/db';
import { authenticate, register, type AuthConfig } from '../../server/auth/service';
import { ApiError, sendJson } from '../../server/http';
import { InstitutesDb } from '../../server/institutes/db';
import { institutePath, instituteRoutes } from '../../server/institutes/routes';
import { testDriver } from '../../server/institutes/test-driver';
import { CONSENT_VERSION, type Actor } from '../../server/institutes/types';
import { DEMO, demoPayload } from './course';

const PORT = Number(process.env.DEMO_API_PORT ?? 8790);
const REAL_API = new URL(process.env.REAL_API ?? 'http://127.0.0.1:8791');
const config: AuthConfig = { tokenSecret: process.env.AUTH_TOKEN_SECRET ?? '' };
const ids: string[] = JSON.parse(process.env.DEMO_IDS ?? '[]');

const identityDb = new IdentityDb(process.env.DB_PATH ?? '');
const driver = await testDriver();
// The receipt key only has to be stable for this run.
const db = new InstitutesDb(driver, `${config.tokenSecret}:demo-receipts`);
await db.migrate();

const account = (email: string) => register(identityDb, config, email, DEMO.password, 'institute-demo').user;
const actor = (user: { id: string; email: string | null }, phone: string | null = null): Actor => ({ id: user.id, email: user.email, name: null, phone, emailVerified: false });

/* ─── Seed: one fictional institute, built through the same calls staff make ── */

const staff = account(DEMO.users.staff);
const faculty = account(DEMO.users.faculty);
const student = account(DEMO.users.student);

const org = await db.createOrg(staff.id, { slug: DEMO.org.slug, name: DEMO.org.name, accent: DEMO.org.accent });
const orgId = String(org.id);
await db.setMember(orgId, staff.id, faculty.id, 'owner');
const course = await db.createCourse(orgId, staff.id, { title: DEMO.course.title, kind: 'batch', channelId: DEMO.channelId });
const courseId = String(course.id);

// Version 1, then a quiz on the second lesson, then version 2 that links the quiz to its lesson.
await db.saveDraft(orgId, courseId, staff.id, demoPayload(ids));
await db.publish(orgId, courseId, staff.id);
const quizVideo = ids[1];
const quiz = await db.createQuiz(orgId, courseId, staff.id, quizVideo, [
  { question: 'Which part of the Constitution declares India a sovereign, socialist, secular, democratic republic?', options: ['The Preamble', 'Part III', 'The Seventh Schedule', 'Article 368'], answer: 0 },
  { question: 'Which writ directs a public authority to perform a duty it has failed to perform?', options: ['Habeas corpus', 'Mandamus', 'Quo warranto', 'Certiorari'], answer: 1 },
  { question: 'Fundamental Rights are listed in which Part of the Constitution?', options: ['Part II', 'Part III', 'Part IV', 'Part IVA'], answer: 1 },
]);
await db.publishQuiz(orgId, String(quiz.id), staff.id);
await db.saveDraft(orgId, courseId, staff.id, demoPayload(ids, { [quizVideo]: String(quiz.id) }));
await db.publish(orgId, courseId, staff.id);

const batch = await db.createBatch(orgId, staff.id, { courseId, name: DEMO.batch.name, seats: DEMO.batch.seats });
const batchId = String(batch.id);
// Demo-only: a readable join code in place of the random one createBatch issues (rotate it in the Control room to see the real kind).
await driver.query('UPDATE institutes.batches SET join_code=$3 WHERE org_id=$1 AND id=$2', [orgId, batchId, DEMO.joinCode]);
await db.assignment(orgId, batchId, staff.id, { itemRef: ids[2], kind: 'today', note: 'Today’s class: read the Preamble once before you watch.' });
await db.assignment(orgId, batchId, staff.id, { itemRef: ids[3], kind: 'homework', note: 'Homework: make notes on the three writs you find hardest.' });

// A few fictional classmates with progress, so the Studio funnel has something to count. Same calls as the
// extension: enrol (with or without sharing), then progress milestones.
const classmates = [
  { phone: '+919876500011', progress: true, watched: 5 },
  { phone: '+919876500012', progress: true, watched: 3 },
  { phone: '+919876500013', progress: false, watched: 4 },
  { phone: '+919876500014', progress: true, watched: 1 },
  { phone: '+919876500015', progress: false, watched: 0 },
];
for (const [i, mate] of classmates.entries()) {
  const user = account(`demo-classmate-${i + 1}@example.com`);
  await db.enroll(orgId, courseId, actor(user), { phone: mate.phone, joinCode: DEMO.joinCode, consents: { textVersion: CONSENT_VERSION, progress: mate.progress, contact: false } });
  const events = ids.slice(0, mate.watched).map((videoId, n) => ({ orgId, courseId, userId: user.id, videoId, stage: n < mate.watched - 1 ? ('done' as const) : ('half' as const), seconds: 600 }));
  if (events.length) await db.recordProgress(events);
}

/* ─── HTTP ───────────────────────────────────────────────────────────────────── */

const handleInstitutes = instituteRoutes({
  database: async () => db,
  identity: (header) => authenticate(identityDb, config, header).user,
  // The demo student joins without sharing contact details, so no SMS code is ever needed.
  startPhone: async () => {
    throw new ApiError(503, 'internal_error', 'SMS codes are not available in the demo. Join without contact sharing.');
  },
  verifyPhone: async () => {
    throw new ApiError(503, 'internal_error', 'SMS codes are not available in the demo.');
  },
  staff: staff.id,
  userExists: (id) => !!identityDb.findUserById(id),
  clientIp: () => '127.0.0.1',
});

function proxy(req: IncomingMessage, res: ServerResponse) {
  const upstream = forward({ hostname: REAL_API.hostname, port: REAL_API.port, path: req.url, method: req.method, headers: req.headers }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => sendJson(res, 502, { ok: false, code: 'upstream_error', error: 'The FocusSpace API is not running.' }));
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'OPTIONS' || !institutePath(path)) return proxy(req, res);
  try {
    if (!(await handleInstitutes(req, res))) proxy(req, res);
  } catch (err) {
    if (err instanceof ApiError) sendJson(res, err.status, err.toResponse());
    else {
      console.error('[institute demo]', err);
      sendJson(res, 500, { ok: false, code: 'internal_error', error: 'Something went wrong.' });
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // One line the orchestrator waits for.
  console.log(`DEMO_READY ${JSON.stringify({ port: PORT, orgId, courseId, batchId, joinCode: DEMO.joinCode, quizId: String(quiz.id), users: DEMO.users, student: student.id })}`);
});
