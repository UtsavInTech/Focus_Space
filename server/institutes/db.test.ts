import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InstitutesDb, publicPayload, type Driver } from './db';
import { testDriver } from './test-driver';
import { ProgressQueue } from './queue';
import { CONSENT_VERSION, type Actor, type CoursePayload } from './types';

let driver: Driver;
let db: InstitutesDb;
let phoneNumber = 9000000000;

const nextPhone = () => `+91${++phoneNumber}`;
/** A learner signed in with a verified phone (the phone on the session matches the one they join with). */
const actor = (): Actor => ({ id: randomUUID(), email: null, name: 'Learner', phone: nextPhone() });
/** A learner whose phone was never verified. */
const unverified = (): Actor => ({ id: randomUUID(), email: null, name: 'Learner', phone: null });
const sharing = (progress = false, contact = false) => ({ textVersion: CONSENT_VERSION, progress, contact });
const join = (orgId: string, courseId: string, person: Actor, consents = sharing(), joinCode?: string) =>
  db.enroll(orgId, courseId, person, { phone: person.phone ?? nextPhone(), consents, ...(joinCode ? { joinCode } : {}) });

const video = 'abcdefghijk';
const privateVideo = 'lmnopqrstuv';
const channel = `UC${'a'.repeat(22)}`;
const data = (): CoursePayload => ({
  brand: { name: 'Test Institute' },
  subjects: [{ id: 'subject', title: 'Subject', topics: [{ id: 'topic', title: 'Topic', subtopics: ['A concept'], items: [{ type: 'video', videoId: video }, { type: 'video', videoId: privateVideo, membersOnly: true }] }] }],
  approvedChannels: [{ id: channel }],
  modes: [],
});

async function course(kind: 'free' | 'batch' = 'free') {
  const org = await db.createOrg('staff', { slug: randomUUID(), name: 'Test Institute' });
  const orgId = String(org.id);
  const row = await db.createCourse(orgId, 'staff', { title: 'Test Course', kind, channelId: channel });
  const courseId = String(row.id);
  await db.saveDraft(orgId, courseId, 'staff', data());
  await db.publish(orgId, courseId, 'staff');
  return { orgId, courseId };
}

const rows = (sql: string, orgId: string) => driver.query(sql, [orgId]);

beforeAll(async () => {
  driver = await testDriver();
  db = new InstitutesDb(driver, 'r'.repeat(32));
  await db.migrate();
}, 30000);
afterAll(async () => {
  await driver?.close();
});

describe('Postgres institutes data boundaries', () => {
  it('derives setup from this institute only',async()=>{
    // A draft does not count; a published course does, imported from YouTube or built by hand.
    const draftOrg=String((await db.createOrg('staff',{slug:randomUUID(),name:'Draft only'})).id);
    await db.createCourse(draftOrg,'staff',{title:'Draft',kind:'free',channelId:channel});
    expect((await db.setupChecklist(draftOrg)).items.find(i=>i.id==='course')?.done).toBe(false);
    const a=await course(),b=await db.createOrg('staff',{slug:randomUUID(),name:'Another demo institute'});
    const checklist=await db.setupChecklist(a.orgId);expect(checklist.items.find(i=>i.id==='course')?.done).toBe(true);expect(checklist.total).toBe(7);
    expect((await db.setupChecklist(String(b.id))).completed).toBe(0);
  });
  it('migrates idempotently, and separates organisation roles and resources', async () => {
    await db.migrate();
    expect(await driver.query('SELECT version FROM institutes.migrations')).toHaveLength(5);
    const a = await course();
    const b = await course();
    const person = actor();
    await db.setMember(a.orgId, 'staff', person.id, 'faculty');
    expect(await db.role(a.orgId, person.id)).toBe('faculty');
    expect(await db.role(b.orgId, person.id)).toBeNull();
    expect((await db.courses(b.orgId)).some((row) => row.id === a.courseId)).toBe(false);
    await expect(db.saveDraft(b.orgId, a.courseId, 'staff', data())).rejects.toMatchObject({ status: 404 });
    await expect(db.courseVersion(b.orgId, a.courseId, 1)).rejects.toMatchObject({ status: 404 });
    await expect(db.recordProgress([{ orgId: b.orgId, courseId: a.courseId, userId: person.id, videoId: video, stage: 'done', seconds: 10 }])).rejects.toMatchObject({ status: 403 });
    await expect(db.createBatch(b.orgId, 'staff', { courseId: a.courseId, name: 'Wrong org', seats: 2 })).rejects.toMatchObject({ status: 404 });
  });

  it('requires institute approval for outside channels and caches imports for a day', async () => {
    const { orgId, courseId } = await course();
    const admin = actor();
    const faculty = actor();
    const outside = `UC${'b'.repeat(22)}`;
    await db.setMember(orgId, 'staff', admin.id, 'admin');
    await db.setMember(orgId, 'staff', faculty.id, 'faculty');
    await db.suggestChannel(orgId, courseId, 'staff', outside);
    const draft = data();
    draft.approvedChannels.push({ id: outside });
    await expect(db.saveDraft(orgId, courseId, 'staff', draft)).rejects.toThrow('approval');
    await expect(db.suggestChannel(orgId, courseId, faculty.id, outside, true)).rejects.toMatchObject({ status: 403 });
    await db.suggestChannel(orgId, courseId, admin.id, outside, true);
    await db.saveDraft(orgId, courseId, 'staff', draft);
    expect((await db.claimImport(orgId, courseId)).cached).toBeNull();
    await expect(db.claimImport(orgId, courseId)).rejects.toMatchObject({ status: 409 });
    await db.finishImport(orgId, courseId, 'staff', data());
    expect((await db.claimImport(orgId, courseId)).cached).toEqual(data());
  });

  it('needs a verified, unique Indian number to join, and gives every member\'s number to the institute', async () => {
    const { orgId, courseId } = await course();
    await expect(join(orgId, courseId, unverified())).rejects.toMatchObject({ status: 409 });
    const a = actor();
    await join(orgId, courseId, a);
    // Someone else can't join with a number that's already registered.
    await expect(db.enroll(orgId, courseId, { ...actor(), phone: a.phone }, { phone: a.phone!, consents: sharing() })).rejects.toMatchObject({ status: 409 });
    const listed = (await db.students(orgId, { limit: 100 })).items;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ phone: a.phone, sharing_progress: false, wants_contact: false, completed_videos: null, quiz_score: null, watch_seconds: null });
    const enrolment = await rows('SELECT terms_version FROM institutes.enrollments WHERE org_id=$1', orgId);
    expect(enrolment[0].terms_version).toBe(CONSENT_VERSION);
  });

  it('puts "contact me" in the institute inbox once, and closes it if the student takes it back', async () => {
    const { orgId, courseId } = await course();
    const eager = actor();
    const later = actor();
    await join(orgId, courseId, eager, sharing(false, true));
    await join(orgId, courseId, later);
    await db.requestContact(orgId, courseId, later.id, 'Can I get a scholarship test?');
    await db.requestContact(orgId, courseId, later.id, 'Any time after 6 pm, please.');
    const inbox = await db.requests(orgId);
    expect(inbox).toHaveLength(2);
    expect(inbox.find((r) => r.user_id === later.id)).toMatchObject({ source: 'button', note: 'Any time after 6 pm, please.', handled_at: null });
    expect(inbox.find((r) => r.user_id === eager.id)).toMatchObject({ source: 'join', phone: eager.phone });
    expect((await db.students(orgId, { limit: 100, priority: true })).items.map((s) => s.user_id).sort()).toEqual([eager.id, later.id].sort());

    await db.handleRequest(orgId, String(inbox.find((r) => r.user_id === eager.id)!.id), 'staff');
    await expect(db.handleRequest(orgId, String(inbox.find((r) => r.user_id === eager.id)!.id), 'staff')).rejects.toMatchObject({ status: 404 });
    await db.changeConsent(orgId, later.id, sharing(false, false));
    expect((await db.requests(orgId)).every((r) => r.handled_at !== null)).toBe(true);
    expect((await db.requests(orgId)).find((r) => r.user_id === later.id)!.handled_by).toBe('withdrawn');
    // Another institute never sees these.
    const other = await course();
    expect(await db.requests(other.orgId)).toHaveLength(0);
    await expect(db.requestContact(other.orgId, other.courseId, later.id, null)).rejects.toMatchObject({ status: 403 });
  });

  it('stores Quiz me scores only with progress consent and deletes them on withdrawal', async () => {
    const { orgId, courseId } = await course();
    const person = actor();
    await join(orgId, courseId, person);
    expect(await db.quizMeScore(orgId, courseId, person.id, video, 3, 5)).toEqual({ stored: false });
    await db.changeConsent(orgId, person.id, sharing(true));
    await db.quizMeScore(orgId, courseId, person.id, video, 3, 5);
    const stored = await rows('SELECT * FROM institutes.quizme_scores WHERE org_id=$1', orgId);
    expect(stored).toHaveLength(1);
    expect(Number(stored[0].at)).toBeGreaterThan(0);
    expect((await db.students(orgId, { courseId, minQuizScore: 50, limit: 100 })).items).toHaveLength(1);
    await db.changeConsent(orgId, person.id, sharing());
    expect(await rows('SELECT * FROM institutes.quizme_scores WHERE org_id=$1', orgId)).toHaveLength(0);
  });

  it('creates immutable published versions and does not expose members-only data or answer fields', async () => {
    const { orgId, courseId } = await course();
    const changed = data();
    changed.subjects[0].title = 'Changed';
    await db.saveDraft(orgId, courseId, 'staff', changed);
    expect((await db.publish(orgId, courseId, 'staff')).version).toBe(2);
    const first = await db.courseVersion(orgId, courseId, 1);
    expect(first.payload.subjects[0].title).toBe('Subject');
    expect(JSON.stringify(first)).not.toContain(privateVideo);
    expect((await db.courseVersion(orgId, courseId, 2)).payload.subjects[0].title).toBe('Changed');
    await expect(driver.query("UPDATE institutes.course_versions SET payload_json='{}' WHERE org_id=$1", [orgId])).rejects.toThrow('immutable');
    const dirty = data() as unknown as Record<string, unknown>;
    dirty.answers = ['secret'];
    expect(JSON.stringify(publicPayload(dirty as unknown as CoursePayload, false))).not.toContain('secret');
  });

  it('enforces seats under simultaneous enrolment, and hides batch content from nonmembers', async () => {
    const { orgId, courseId } = await course('batch');
    const batch = await db.createBatch(orgId, 'staff', { courseId, name: 'Batch', seats: 1 });
    expect(String(batch.join_code).length).toBeGreaterThanOrEqual(10);
    const a = actor();
    const b = actor();
    const results = await Promise.allSettled([a, b].map((person) => join(orgId, courseId, person, sharing(), String(batch.join_code))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const winner = results[0].status === 'fulfilled' ? a : b;
    expect(JSON.stringify(await db.courseVersion(orgId, courseId, 1, winner.id))).toContain(privateVideo);
    await expect(db.courseVersion(orgId, courseId, 1, actor().id)).rejects.toMatchObject({ status: 403 });
    await db.leave(orgId, courseId, winner.id);
    await expect(db.courseVersion(orgId, courseId, 1, winner.id)).rejects.toMatchObject({ status: 403 });
  });

  it('keeps progress anonymous for a learner not sharing it; quizzes still work', async () => {
    const { orgId, courseId } = await course();
    const person = actor();
    await join(orgId, courseId, person);
    const quiz = await db.createQuiz(orgId, courseId, 'staff', video, [{ question: 'Which?', options: ['A', 'B'], answer: 1 }]);
    await db.publishQuiz(orgId, String(quiz.id), 'staff');
    await expect(db.quiz(orgId, String(quiz.id), person.id)).rejects.toMatchObject({ status: 409 });
    await db.recordProgress([{ orgId, courseId, userId: person.id, videoId: video, stage: 'done', seconds: 100 }]);
    expect(JSON.stringify(await db.quiz(orgId, String(quiz.id), person.id))).not.toContain('answer');
    expect(await db.attemptQuiz(orgId, String(quiz.id), person.id, [1])).toEqual({ score: 1, total: 1 });
    expect(await rows('SELECT * FROM institutes.progress WHERE org_id=$1', orgId)).toHaveLength(0);
    expect(await rows('SELECT * FROM institutes.quiz_attempts WHERE org_id=$1', orgId)).toHaveLength(0);
    // Listed by name and number (they agreed to that on joining), with no progress.
    expect((await db.students(orgId, { limit: 100 })).items[0]).toMatchObject({ completed_videos: null, quiz_score: null, last_active: null });
    const report = await db.studentReport(orgId, person.id, 'staff');
    expect(report.lectures).toHaveLength(0);
    expect(report.quizzes).toHaveLength(0);
    expect(report.student).toMatchObject({ sharing_progress: false, phone: person.phone });
    const funnel = await db.funnel(orgId, courseId);
    expect(funnel).toMatchObject({ joined: 1, started: 1, half: 1, done: 1, passed_quiz: 1 });
    expect(funnel.videos[0]).toMatchObject({ started: 1, half: 1, done: 1 });
    const receipts = await rows('SELECT * FROM institutes.total_receipts WHERE org_id=$1', orgId);
    expect(JSON.stringify(receipts)).not.toContain(person.id);
    expect(receipts[0]).not.toHaveProperty('user_id');
  });

  it('removes progress and scores immediately on withdrawal, even for queued milestones', async () => {
    const { orgId, courseId } = await course();
    const person = actor();
    await join(orgId, courseId, person, sharing(true, true));
    await db.recordProgress([{ orgId, courseId, userId: person.id, videoId: video, stage: 'half', seconds: 50 }]);
    const quiz = await db.createQuiz(orgId, courseId, 'staff', video, [{ question: 'Which?', options: ['A', 'B'], answer: 0 }]);
    await db.publishQuiz(orgId, String(quiz.id), 'staff');
    await db.recordProgress([{ orgId, courseId, userId: person.id, videoId: video, stage: 'done', seconds: 90 }]);
    await db.attemptQuiz(orgId, String(quiz.id), person.id, [0]);
    expect((await db.students(orgId, { limit: 100 })).items[0]).toMatchObject({ quiz_score: 100, completed_videos: 1, watch_seconds: 90 });
    const report = await db.studentReport(orgId, person.id, 'staff');
    expect(report.lectures[0]).toMatchObject({ video_id: video, stage: 'done', seconds: 90 });
    expect(report.quizzes[0]).toMatchObject({ kind: 'institute', score: 1, total: 1 });
    expect((await rows("SELECT * FROM institutes.audit_log WHERE org_id=$1 AND action='student.view'", orgId)).length).toBe(1);

    const queue = new ProgressQueue(db, 60000);
    const waiting = queue.enqueue({ orgId, courseId, userId: person.id, videoId: video, stage: 'done', seconds: 100 });
    await db.changeConsent(orgId, person.id, sharing());
    await queue.flush();
    await waiting;
    expect((await db.students(orgId, { limit: 100 })).items[0]).toMatchObject({ completed_videos: null, quiz_score: null, wants_contact: false });
    expect(await rows('SELECT * FROM institutes.progress WHERE org_id=$1', orgId)).toHaveLength(0);
    expect(await rows('SELECT * FROM institutes.quiz_attempts WHERE org_id=$1', orgId)).toHaveLength(0);
    const consents = await rows('SELECT * FROM institutes.consents WHERE org_id=$1', orgId);
    expect(consents.every((row) => row.withdrawn_at !== null)).toBe(true);
    await db.changeConsent(orgId, person.id, sharing(true, false));
    expect((await db.students(orgId, { limit: 100 })).items[0].completed_videos).toBe(0);
  });

  it('coalesces 10,000 posts, never regresses stages and never double-counts totals', async () => {
    const { orgId, courseId } = await course();
    const person = actor();
    await join(orgId, courseId, person, sharing(true));
    const save = vi.spyOn(db, 'recordProgress');
    const queue = new ProgressQueue(db, 60000);
    const pending = Array.from({ length: 10000 }, (_, i) => queue.enqueue({ orgId, courseId, userId: person.id, videoId: video, stage: i === 9999 ? 'done' : 'started', seconds: i }));
    await queue.flush();
    await Promise.all(pending);
    expect(save).toHaveBeenCalledTimes(1);
    save.mockRestore();
    await db.recordProgress([{ orgId, courseId, userId: person.id, videoId: video, stage: 'half', seconds: 2 }]);
    const progress = await rows('SELECT * FROM institutes.progress WHERE org_id=$1', orgId);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ stage: 'done', seconds: 9999 });
    expect((await db.funnel(orgId, courseId)).videos[0]).toMatchObject({ started: 1, half: 1, done: 1 });
    expect((await db.students(orgId, { limit: 100, minCompletion: 100 })).items).toHaveLength(1);
    expect((await db.activity(orgId, courseId)).reduce((n, d) => n + Number(d.started), 0)).toBe(1);
  });

  it('filters and pages exports, scopes them to one institute, and logs each export', async () => {
    const { orgId, courseId } = await course();
    const other = await course();
    for (let i = 0; i < 3; i++) {
      const person = actor();
      await join(orgId, courseId, person, sharing(true, i === 2));
      if (i === 0) await db.recordProgress([{ orgId, courseId, userId: person.id, videoId: video, stage: 'done', seconds: 100 }]);
    }
    const first = await db.leads(orgId, 'staff', { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.next).not.toBeNull();
    const second = await db.leads(orgId, 'staff', { limit: 1, after: first.next! });
    expect(second.items[0].user_id).not.toBe(first.items[0].user_id);
    expect((await db.leads(orgId, 'staff', { limit: 10, minCompletion: 100 })).items).toHaveLength(1);
    expect((await db.leads(orgId, 'staff', { limit: 10, priority: true })).items).toHaveLength(1);
    expect((await db.leads(other.orgId, 'staff', { limit: 10 })).items).toHaveLength(0);
    expect((await rows("SELECT * FROM institutes.audit_log WHERE org_id=$1 AND action='leads.export'", orgId)).length).toBe(4);
  });
});
