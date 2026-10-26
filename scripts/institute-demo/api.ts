import {TitleCache} from '../../server/institutes/titles';
import {studioAi} from '../../server/usage/studio';
import {UsageDb} from '../../server/usage/db';
import {fakeStudioLlm} from '../../server/institutes/studio-fake';
import {EMPTY_CONTEXT} from '../../server/institutes/studio-types';
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
import { DEMO, demoFreePayload, demoPayload } from './course';

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
// With enough ids, the last few become a free weekly course; the batch course keeps the rest.
const batchIds = ids.length >= 16 ? ids.slice(0, ids.length - 6) : ids;
const freeIds = ids.length >= 16 ? ids.slice(ids.length - 6) : [];
const course = await db.createCourse(orgId, staff.id, { title: DEMO.course.title, kind: 'batch', channelId: DEMO.channelId });
const courseId = String(course.id);

// Version 1, then a quiz on the second lesson, then version 2 that links the quiz to its lesson.
await db.saveDraft(orgId, courseId, staff.id, demoPayload(batchIds));
await db.publish(orgId, courseId, staff.id);
const quizVideo = batchIds[1];
const quiz = await db.createQuiz(orgId, courseId, staff.id, quizVideo, [
  { question: 'Which part of the Constitution declares India a sovereign, socialist, secular, democratic republic?', options: ['The Preamble', 'Part III', 'The Seventh Schedule', 'Article 368'], answer: 0 },
  { question: 'Which writ directs a public authority to perform a duty it has failed to perform?', options: ['Habeas corpus', 'Mandamus', 'Quo warranto', 'Certiorari'], answer: 1 },
  { question: 'Fundamental Rights are listed in which Part of the Constitution?', options: ['Part II', 'Part III', 'Part IV', 'Part IVA'], answer: 1 },
]);
await db.publishQuiz(orgId, String(quiz.id), staff.id);
await db.saveDraft(orgId, courseId, staff.id, demoPayload(batchIds, { [quizVideo]: String(quiz.id) }));
await db.publish(orgId, courseId, staff.id);

const batch = await db.createBatch(orgId, staff.id, { courseId, name: DEMO.batch.name, seats: DEMO.batch.seats });
const batchId = String(batch.id);
// Demo-only: a readable join code in place of the random one createBatch issues (rotate it in the Control room to see the real kind).
await driver.query('UPDATE institutes.batches SET join_code=$3 WHERE org_id=$1 AND id=$2', [orgId, batchId, DEMO.joinCode]);
await db.assignment(orgId, batchId, staff.id, { itemRef: batchIds[2], kind: 'today', note: 'Today’s class: read the Preamble once before you watch.' });
await db.assignment(orgId, batchId, staff.id, { itemRef: batchIds[3], kind: 'homework', note: 'Homework: make notes on the three writs you find hardest.' });

let freeCourseId: string | null = null;
if (freeIds.length) {
  const free = await db.createCourse(orgId, staff.id, { title: DEMO.freeCourse.title, kind: 'free', channelId: DEMO.channelId });
  freeCourseId = String(free.id);
  await db.saveDraft(orgId, freeCourseId, staff.id, demoFreePayload(freeIds));
  await db.publish(orgId, freeCourseId, staff.id);
}

/*
 * Six weeks of a realistic batch, so the Studio shows what an institute would really see. Same calls as the
 * extension (enrol, milestones, Quiz me), run on a demo clock: each student joins on some day, studies at
 * their own hour on some days, and either keeps going, slows down or goes quiet. Seeded, so every run shows
 * the same story. The demo clock only exists while seeding; it is never part of FocusSpace itself.
 */
let seed = 20261026;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const RealDate = Date;
let clock: number | null = null;
class DemoDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor>) {
    if (args.length === 0 && clock !== null) super(clock);
    else super(...(args as [number]));
  }
  static now() {
    return clock ?? RealDate.now();
  }
}
globalThis.Date = DemoDate as DateConstructor;

const DAY = 86400000;
const today = new RealDate(new RealDate().toISOString().slice(0, 10)).getTime(); // midnight UTC
const START = today - 41 * DAY;
const at = (day: number, hour: number) => START + day * DAY + hour * 3600000 + Math.floor(random() * 50) * 60000;

const FIRST = ['Aarav', 'Ananya', 'Ishaan', 'Diya', 'Kabir', 'Meera', 'Vihaan', 'Saanvi', 'Arjun', 'Kavya', 'Reyansh', 'Aditi', 'Rohan', 'Nisha', 'Yash', 'Pooja', 'Dev', 'Riya', 'Karan', 'Sneha', 'Aman', 'Tanvi', 'Rahul', 'Ira'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Yadav', 'Mishra', 'Patel', 'Rao', 'Iyer', 'Das', 'Chauhan', 'Joshi', 'Nair', 'Kumar', 'Bhatt', 'Saxena'];
const NOTES = ['Is there a scholarship test for the next batch?', 'Please call after 6 pm.', 'I want to join the offline batch in Greater Noida.', 'Can I get the Polity notes PDF?', 'I am stuck on Fundamental Rights, can a mentor help?'];
const CLASSMATES = 180;

for (let i = 0; i < CLASSMATES; i += 1) {
  const name = `${FIRST[Math.floor(random() * FIRST.length)]} ${LAST[Math.floor(random() * LAST.length)]}`;
  const phone = `+9198765${String(10000 + i).padStart(5, '0')}`;
  const user = account(`demo-classmate-${i + 1}@example.com`);
  // Signed in with their phone, so the number is verified, as for every real student who joins.
  const who: Actor = { id: user.id, email: user.email, name, phone, emailVerified: false };
  const sharesProgress = random() < 0.62;
  const askedOnJoin = random() < 0.09;
  const joinDay = Math.floor(random() ** 1.7 * 30);
  const hour = [7, 8, 13, 18, 20, 21, 22, 23][Math.floor(random() * 8)];
  clock = at(joinDay, hour);
  await db.enroll(orgId, courseId, who, { phone, joinCode: DEMO.joinCode, consents: { textVersion: CONSENT_VERSION, progress: sharesProgress, contact: askedOnJoin } });

  // How far and how steadily: a few keep going every other day, most slow down, some stop.
  const pace = 0.25 + random() * 0.6; // chance of studying on a given day
  const quitDay = random() < 0.35 ? joinDay + 3 + Math.floor(random() * 20) : 99;
  const skill = 0.35 + random() * 0.6;
  let lesson = 0;
  for (let day = joinDay; day <= 41 && lesson < batchIds.length; day += 1) {
    if (day > quitDay || random() > pace) continue;
    const perDay = random() < 0.25 ? 2 : 1;
    for (let k = 0; k < perDay && lesson < batchIds.length; k += 1) {
      clock = at(day, hour + k);
      const videoId = batchIds[lesson];
      const finished = random() < 0.86;
      await db.recordProgress([{ orgId, courseId, userId: user.id, videoId, stage: finished ? 'done' : random() < 0.5 ? 'half' : 'started', seconds: finished ? 1500 + Math.floor(random() * 2400) : 300 + Math.floor(random() * 900) }]);
      if (finished && random() < 0.45) {
        const score = Math.max(0, Math.min(10, Math.round(10 * (skill + (random() - 0.5) * 0.3))));
        await db.quizMeScore(orgId, courseId, user.id, videoId, score, 10);
      }
      lesson += 1;
    }
  }

  // Some press "Talk to your faculty" later, with a note; a few of those were already called.
  if (!askedOnJoin && random() < 0.08) {
    clock = at(Math.min(41, joinDay + 2 + Math.floor(random() * 15)), 19);
    await db.requestContact(orgId, courseId, user.id, NOTES[Math.floor(random() * NOTES.length)]);
  }

  if (freeCourseId && random() < 0.5) {
    clock = at(joinDay, hour);
    await db.enroll(orgId, freeCourseId, who, { phone, consents: { textVersion: CONSENT_VERSION, progress: sharesProgress, contact: askedOnJoin } });
    for (const [n, videoId] of freeIds.entries()) {
      if (random() < 0.4) break;
      clock = at(Math.min(41, joinDay + n * 3), hour);
      await db.recordProgress([{ orgId, courseId: freeCourseId, userId: user.id, videoId, stage: 'done', seconds: 1200 }]);
      await db.quizMeScore(orgId,freeCourseId,user.id,videoId,6+Math.floor(random()*5),10);
    }
  }
}
// The institute keeps up with its calls: all but the seven newest requests were already handled.
clock = today - DAY;
const waiting = (await db.requests(orgId)).filter((r) => r.handled_at === null).sort((a, b) => Number(b.created_at) - Number(a.created_at));
for (const request of waiting.slice(7)) await db.handleRequest(orgId, String(request.id), faculty.id);
clock=at(1,10);
await db.setMember(orgId,staff.id,'demo-faculty-second','faculty');
await db.saveStudioContext(orgId,faculty.id,{...EMPTY_CONTEXT,about:'A fictional coaching centre for the local Studio demonstration.',products:[{name:'Foundation classroom course',fee:45000,startDate:'2026-11-15',mode:'offline',centre:'Demo learning centre'},{name:'Online revision course',fee:30000,startDate:'2026-11-20',mode:'online',centre:''}],offers:'Demo scholarship test on 2026-11-08. No scholarship is guaranteed.',counsellor:'Demo counsellor',callback:'+919000000000',tone:'Warm, practical, never pushy',language:'Hinglish',neverSay:'Never guarantee selection, marks, admission or a scholarship.',examples:['Hello, would you like help choosing your next step?','Aapki padhai kaisi chal rahi hai?','A short call is optional; tell us what suits you.'],rules:['Make the next step optional.']},0);
const starts=[{name:'Ready for the paid course',rules:{freeOnly:true,minLessons:3,minQuiz:70}},{name:'High scorers falling behind',rules:{minQuiz:80,quietDays:7}},{name:'Came back after going quiet',rules:{returnedDays:7}},{name:'Needs a doubt session',rules:{minLessons:3,maxQuiz:50}},{name:'Scholarship test shortlist',rules:{minLessons:5,minQuiz:80}}];
for(const [i,start]of starts.entries()){
 const playbook=await db.savePlaybook(orgId,faculty.id,{...start,template:'Hello {{firstName}}, would you like to discuss your next step with {{counsellor}}?',channel:'whatsapp',personalize:true});
 for(const day of [12,23,34,40]){clock=at(day,19);const matching=await db.playbookMatches(orgId,playbook.id);for(const [n,person]of matching.items.slice(0,3).entries()){const claim=await db.claimPlaybook(orgId,playbook.id,String(person.user_id));await db.savePlaybookDraft(orgId,String(claim.id),faculty.id,'Hello, would you like to discuss your next study step?',[]);await db.finishPlaybookSend(orgId,String(claim.id),faculty.id,'sent','Hello, would you like to discuss your next study step?');await db.recordOutcome(orgId,faculty.id,{userId:String(person.user_id),kind:n===0?'enrolled':n===1?'interested':'no_answer',course:`Demo paid course ${i+1}`,fee:45000,playbookId:playbook.id});}}
}
clock=at(41,20);
await db.saveStudioQuestion(orgId,faculty.id,'Who asked us to call?',{calls:[{fn:'requests',args:{open:true}}],intent:'Contact requests'});
const saved=await db.saveStudioQuestion(orgId,faculty.id,'How much did we record in enrolment fees?',{calls:[{fn:'outcomes',args:{}}],intent:'Recorded fees'});await db.pinStudioThread(orgId,saved,true);
clock = null;
globalThis.Date = RealDate;

/* ─── HTTP ───────────────────────────────────────────────────────────────────── */

const studioUsage=new UsageDb(process.env.DB_PATH??'');
const liveAi=!!process.env.OPENAI_API_KEY;
console.log(`Studio assistant: ${liveAi?'live provider':'fake (no provider requests)'}; seed token usage: ${studioUsage.studioUsage(orgId).tokens}.`);
const handleInstitutes = instituteRoutes({
  ai:studioAi(studioUsage,{apiKey:process.env.OPENAI_API_KEY??'demo-no-provider',model:process.env.STUDIO_MODEL??process.env.SETUP_MODEL??'gpt-4.1-mini',maxTokens:1200},Number(process.env.STUDIO_AI_MONTHLY_LIMIT??200000),liveAi?undefined:fakeStudioLlm),
  usage:org=>studioUsage.studioUsage(org),aiMode:liveAi?'live':'demo',
  ...(process.env.DEMO_STUDIO_ONLY==='1'?{titles:new TitleCache(async id=>`Demo lecture ${ids.indexOf(id)+1} · fictional course fixture`)}:{}),
  database: async () => db,
  identity: (header) => authenticate(identityDb, config, header).user,
  // The demo student joins without sharing contact details, so no SMS code is ever needed.
  // Demo only: no SMS is sent. The code is always 000000, and the join page says so in the demo.
  startPhone: async () => ({ sent: true, demoCode: '000000' }),
  verifyPhone: async (_actor, _phone, code) => {
    if (code !== '000000') throw new ApiError(400, 'invalid_request', 'In the demo the code is 000000.');
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
  console.log(`DEMO_READY ${JSON.stringify({ assistantMode:liveAi?'live':'demo',assistantTokens:studioUsage.studioUsage(orgId).tokens,port: PORT, orgId, courseId, batchId, joinCode: DEMO.joinCode, quizId: String(quiz.id), users: DEMO.users, student: student.id })}`);
});
