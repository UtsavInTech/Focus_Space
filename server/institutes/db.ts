import postgres from 'postgres';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../http';
import { STAGE_RANK, type Actor, type CoursePayload, type Milestone, type OrgRole, type PageFilter, type ProgressEvent, type QuizQuestion, type Sharing } from './types';
import { payload as validatePayload } from './validate';

type Row = Record<string, unknown>;
export interface Driver {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(work: (tx: Driver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgresDriver(sql: postgres.Sql): Driver {
  return {
    query: async <T extends Row>(query: string, params: unknown[] = []) => await sql.unsafe(query, params as never[]) as unknown as T[],
    exec: async query => { await sql.unsafe(query, [], { prepare: false }); },
    transaction: async <T>(work: (tx: Driver) => Promise<T>) => await sql.begin(tx => work(postgresDriver(tx as unknown as postgres.Sql))) as T,
    close: async () => { await sql.end({ timeout: 5 }); },
  };
}

// PostgreSQL only, in its own schema. No SQLite identity/usage table is moved or copied.
const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS institutes;
CREATE TABLE IF NOT EXISTS institutes.migrations (version integer PRIMARY KEY, applied_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS institutes.orgs (
 id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, logo_url text, accent_color text,
 status text NOT NULL CHECK(status IN ('pilot','active','paused')), created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS institutes.org_members (
 org_id text NOT NULL REFERENCES institutes.orgs(id), user_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','admin','faculty')), created_at bigint NOT NULL, PRIMARY KEY(org_id,user_id)
);
CREATE TABLE IF NOT EXISTS institutes.courses (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES institutes.orgs(id), title text NOT NULL, exam_id text,
 kind text NOT NULL CHECK(kind IN ('free','batch')), source_channel_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','published')), draft_json jsonb, video_count integer NOT NULL DEFAULT 0, created_at bigint NOT NULL, UNIQUE(org_id,id)
);
CREATE TABLE IF NOT EXISTS institutes.course_versions (
 org_id text NOT NULL, course_id text NOT NULL, version integer NOT NULL CHECK(version>0), payload_json jsonb NOT NULL,
 published_at bigint NOT NULL, published_by text NOT NULL, PRIMARY KEY(org_id,course_id,version),
 FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id)
);
CREATE OR REPLACE FUNCTION institutes.immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Published course versions are immutable'; END; $$;
DROP TRIGGER IF EXISTS immutable_version ON institutes.course_versions;
CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON institutes.course_versions FOR EACH ROW EXECUTE FUNCTION institutes.immutable_version();
CREATE TABLE IF NOT EXISTS institutes.batches (
 id text PRIMARY KEY, org_id text NOT NULL, course_id text NOT NULL, name text NOT NULL, join_code text NOT NULL UNIQUE,
 seats integer NOT NULL CHECK(seats>0), starts_on bigint, ends_on bigint, status text NOT NULL CHECK(status IN ('active','paused')),
 FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id), UNIQUE(org_id,course_id,id), UNIQUE(org_id,id),
 CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on>starts_on)
);
CREATE TABLE IF NOT EXISTS institutes.students (
 user_id text PRIMARY KEY, phone text NOT NULL UNIQUE CHECK(phone ~ '^\\+91[6-9][0-9]{9}$'),
 phone_verified_at bigint, name text, created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS institutes.enrollments (
 id text PRIMARY KEY, org_id text NOT NULL, user_id text NOT NULL REFERENCES institutes.students(user_id),
 course_id text NOT NULL, batch_id text, joined_at bigint NOT NULL, left_at bigint,
 FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id),
 FOREIGN KEY(org_id,course_id,batch_id) REFERENCES institutes.batches(org_id,course_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollment_unique ON institutes.enrollments(org_id,user_id,course_id,COALESCE(batch_id,''));
CREATE INDEX IF NOT EXISTS enrollments_active ON institutes.enrollments(org_id,course_id,user_id) WHERE left_at IS NULL;
CREATE TABLE IF NOT EXISTS institutes.consents (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES institutes.orgs(id), user_id text NOT NULL REFERENCES institutes.students(user_id),
 text_version text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('progress','contact')), given_at bigint NOT NULL, withdrawn_at bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS current_consent ON institutes.consents(org_id,user_id,purpose) WHERE withdrawn_at IS NULL;
CREATE TABLE IF NOT EXISTS institutes.quizzes (
 id text PRIMARY KEY, org_id text NOT NULL, course_id text NOT NULL, video_id text NOT NULL, questions_json jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','published')), created_by text NOT NULL,
 FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id), UNIQUE(org_id,id)
);
CREATE TABLE IF NOT EXISTS institutes.quiz_attempts (
 org_id text NOT NULL, user_id text NOT NULL REFERENCES institutes.students(user_id), quiz_id text NOT NULL,
 score integer NOT NULL CHECK(score>=0), total integer NOT NULL CHECK(total>0 AND score<=total), attempted_at bigint NOT NULL,
 PRIMARY KEY(org_id,user_id,quiz_id), FOREIGN KEY(org_id,quiz_id) REFERENCES institutes.quizzes(org_id,id)
);
CREATE TABLE IF NOT EXISTS institutes.assignments (
 id text PRIMARY KEY, org_id text NOT NULL, batch_id text NOT NULL, item_ref text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('today','homework')), due_on bigint, note text, created_by text NOT NULL,
 FOREIGN KEY(org_id,batch_id) REFERENCES institutes.batches(org_id,id)
);
CREATE TABLE IF NOT EXISTS institutes.progress (
 org_id text NOT NULL, user_id text NOT NULL REFERENCES institutes.students(user_id), course_id text NOT NULL, video_id text NOT NULL,
 stage text NOT NULL CHECK(stage IN ('started','half','done')), seconds integer NOT NULL CHECK(seconds>=0), updated_at bigint NOT NULL,
 PRIMARY KEY(org_id,user_id,course_id,video_id), FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id)
);
CREATE INDEX IF NOT EXISTS progress_course ON institutes.progress(org_id,course_id,user_id);
CREATE TABLE IF NOT EXISTS institutes.course_stats (
 org_id text NOT NULL, course_id text NOT NULL, video_id text NOT NULL, day date NOT NULL,
 started integer NOT NULL DEFAULT 0, half integer NOT NULL DEFAULT 0, done integer NOT NULL DEFAULT 0,
 PRIMARY KEY(org_id,course_id,video_id,day), FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id)
);
-- Private, keyed receipts deduplicate anonymous totals. No user ids, names, phones, seconds or answers.
-- These are pseudonymous server counters, not an identity-bearing progress history or Studio output.
CREATE TABLE IF NOT EXISTS institutes.total_receipts (
 org_id text NOT NULL, course_id text NOT NULL, video_id text NOT NULL, receipt text NOT NULL, rank integer NOT NULL CHECK(rank BETWEEN 0 AND 3),
 PRIMARY KEY(org_id,course_id,video_id,receipt), FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id)
);
CREATE TABLE IF NOT EXISTS institutes.funnel_receipts (
 org_id text NOT NULL, course_id text NOT NULL, receipt text NOT NULL, rank integer NOT NULL CHECK(rank BETWEEN 0 AND 3), passed_quiz boolean NOT NULL DEFAULT false,
 PRIMARY KEY(org_id,course_id,receipt), FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id)
);
CREATE TABLE IF NOT EXISTS institutes.audit_log (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES institutes.orgs(id), actor_id text NOT NULL,
 action text NOT NULL, target text NOT NULL, at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_org ON institutes.audit_log(org_id,at);
INSERT INTO institutes.migrations(version,applied_at) VALUES(1,0) ON CONFLICT DO NOTHING;
`;
const denied = (): never => { throw new ApiError(403, 'forbidden', 'You do not have access to this institute resource.'); };
const missing = (): never => { throw new ApiError(404, 'invalid_request', 'Resource not found.'); };
const conflict = (message: string): never => { throw new ApiError(409, 'conflict', message); };
export const videoIds = (data: CoursePayload, member = false): string[] => data.subjects.flatMap(s => s.topics.flatMap(t => t.items.filter(i => i.type === 'video' && (member || !i.membersOnly)).map(i => i.videoId!)));
export function publicPayload(data: CoursePayload, member: boolean): CoursePayload {
  const clean = validatePayload(data);
  return { ...clean, subjects: clean.subjects.map(s => ({ ...s, topics: s.topics.map(t => ({ ...t, items: t.items.filter(i => member || !i.membersOnly) })) })) };
}

export class InstitutesDb {
  constructor(readonly driver: Driver, private readonly receiptSecret: string) { if (receiptSecret.length < 32) throw new Error('Institute receipt key must have at least 32 characters.'); }
  async migrate() {
    await this.driver.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(67261901)');
      await tx.exec('CREATE SCHEMA IF NOT EXISTS institutes; CREATE TABLE IF NOT EXISTS institutes.migrations(version integer PRIMARY KEY,applied_at bigint NOT NULL);');
      const installed=await tx.query('SELECT version FROM institutes.migrations WHERE version=1');
      if (!installed.length) { await tx.exec(SCHEMA); await tx.query('UPDATE institutes.migrations SET applied_at=$1 WHERE version=1',[Date.now()]); }
    });
  }
  private async tx<T>(work: (tx: Driver) => Promise<T>): Promise<T> {
    try { return await this.driver.transaction(work); }
    catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return conflict('This record or phone number is already registered.');
      if (code === '23503' || code === '23514') throw new ApiError(400, 'invalid_request', 'Invalid institute relationship or value.');
      throw err;
    }
  }
  private async audit(tx: Driver, orgId: string, actor: string, action: string, target: string) {
    await tx.query('INSERT INTO institutes.audit_log(id,org_id,actor_id,action,target,at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), orgId, actor, action, target, Date.now()]);
  }
  async orgs() { return this.driver.query('SELECT * FROM institutes.orgs ORDER BY id'); }
  async createOrg(actor: string, input: { slug: string; name: string; logo?: string; accent?: string }) {
    return this.tx(async tx => {
      const orgId = randomUUID();
      const [org] = await tx.query("INSERT INTO institutes.orgs(id,slug,name,logo_url,accent_color,status,created_at) VALUES($1,$2,$3,$4,$5,'pilot',$6) RETURNING *", [orgId, input.slug, input.name, input.logo ?? null, input.accent ?? null, Date.now()]);
      await this.audit(tx, orgId, actor, 'org.create', orgId); return org;
    });
  }
  async role(orgId: string, userId: string): Promise<OrgRole | null> {
    const [row] = await this.driver.query('SELECT role FROM institutes.org_members WHERE org_id=$1 AND user_id=$2', [orgId,userId]);
    return row?.role as OrgRole ?? null;
  }
  async setMember(orgId: string, actor: string, userId: string, role: OrgRole) {
    return this.tx(async tx => { await tx.query('INSERT INTO institutes.org_members(org_id,user_id,role,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,user_id) DO UPDATE SET role=EXCLUDED.role', [orgId,userId,role,Date.now()]); await this.audit(tx,orgId,actor,'member.set',userId); });
  }
  async myOrgs(userId: string) { return this.driver.query('SELECT o.id,o.name,m.role FROM institutes.org_members m JOIN institutes.orgs o ON o.id=m.org_id WHERE m.user_id=$1 ORDER BY o.id',[userId]); }
  async orgStatus(orgId: string, actor: string, status: 'pilot'|'active'|'paused') {
    return this.tx(async tx=>{ const rows=await tx.query('UPDATE institutes.orgs SET status=$2 WHERE id=$1 RETURNING id',[orgId,status]);if (!rows.length) return missing();await this.audit(tx,orgId,actor,'org.status',status); });
  }
  async batchSettings(orgId: string, batchId: string, actor: string, status: 'active'|'paused', seats: number) {
    return this.tx(async tx=>{
      const [batch]=await tx.query('SELECT id FROM institutes.batches WHERE org_id=$1 AND id=$2 FOR UPDATE',[orgId,batchId]);if (!batch) return missing();
      const [count]=await tx.query('SELECT COUNT(*)::int AS n FROM institutes.enrollments WHERE org_id=$1 AND batch_id=$2 AND left_at IS NULL',[orgId,batchId]);
      if (seats<Number(count.n)) return conflict('Seats cannot be reduced below current enrolment.');
      await tx.query('UPDATE institutes.batches SET status=$3,seats=$4 WHERE org_id=$1 AND id=$2',[orgId,batchId,status,seats]);await this.audit(tx,orgId,actor,'batch.settings',batchId);
    });
  }
  async draft(orgId: string, courseId: string) {
    const [row]=await this.driver.query('SELECT id,title,kind,exam_id,draft_json FROM institutes.courses WHERE org_id=$1 AND id=$2',[orgId,courseId]);return row??missing();
  }
  async courses(orgId: string) { return this.driver.query('SELECT id,org_id,title,exam_id,kind,source_channel_id,status,created_at FROM institutes.courses WHERE org_id=$1 ORDER BY id',[orgId]); }
  async createCourse(orgId: string, actor: string, input: { title: string; examId?: string; kind: 'free'|'batch'; channelId: string }) {
    return this.tx(async tx => {
      const [course] = await tx.query("INSERT INTO institutes.courses(id,org_id,title,exam_id,kind,source_channel_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *", [randomUUID(),orgId,input.title,input.examId ?? null,input.kind,input.channelId,Date.now()]);
      await this.audit(tx,orgId,actor,'course.create',String(course.id)); return course;
    });
  }
  async saveDraft(orgId: string, courseId: string, actor: string, raw: unknown) {
    const data = validatePayload(raw);
    return this.tx(async tx => {
      const [course] = await tx.query('SELECT source_channel_id FROM institutes.courses WHERE org_id=$1 AND id=$2 FOR UPDATE',[orgId,courseId]);
      if (!course) return missing();
      if (data.approvedChannels.some(c=>c.id!==course.source_channel_id)) throw new ApiError(400,'invalid_request','Outside channels require an institute approval workflow; this step supports the source channel only.');
      if (!data.approvedChannels.some(c=>c.id===course.source_channel_id)) throw new ApiError(400,'invalid_request','The institute’s source channel must be approved.');
      await tx.query('UPDATE institutes.courses SET draft_json=$3::jsonb WHERE org_id=$1 AND id=$2',[orgId,courseId,JSON.stringify(data)]);
      await this.audit(tx,orgId,actor,'course.draft',courseId);
    });
  }
  async publish(orgId: string, courseId: string, actor: string) {
    return this.tx(async tx => {
      const [course] = await tx.query('SELECT draft_json,kind FROM institutes.courses WHERE org_id=$1 AND id=$2 FOR UPDATE',[orgId,courseId]);
      if (!course) return missing(); if (!course.draft_json) return conflict('Save and review a draft before publishing.');
      const [last] = await tx.query('SELECT COALESCE(MAX(version),0)::int AS v FROM institutes.course_versions WHERE org_id=$1 AND course_id=$2',[orgId,courseId]);
      const version = Number(last.v)+1;
      await tx.query('INSERT INTO institutes.course_versions(org_id,course_id,version,payload_json,published_at,published_by) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[orgId,courseId,version,JSON.stringify(course.draft_json),Date.now(),actor]);
      await tx.query("UPDATE institutes.courses SET status='published',video_count=$3 WHERE org_id=$1 AND id=$2",[orgId,courseId,new Set(videoIds(course.draft_json as CoursePayload,course.kind==='batch')).size]);
      await this.audit(tx,orgId,actor,'course.publish',`${courseId}:${version}`); return { courseId,version };
    });
  }
  async createBatch(orgId: string, actor: string, input: { courseId: string; name: string; seats: number; startsOn?: number; endsOn?: number }) {
    return this.tx(async tx => {
      const [course] = await tx.query("SELECT id FROM institutes.courses WHERE org_id=$1 AND id=$2 AND kind='batch'",[orgId,input.courseId]); if (!course) return missing();
      const [batch] = await tx.query("INSERT INTO institutes.batches(id,org_id,course_id,name,join_code,seats,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active') RETURNING *",[randomUUID(),orgId,input.courseId,input.name,randomBytes(18).toString('base64url'),input.seats,input.startsOn ?? null,input.endsOn ?? null]);
      await this.audit(tx,orgId,actor,'batch.create',String(batch.id)); return batch;
    });
  }
  async batches(orgId: string) { return this.driver.query('SELECT * FROM institutes.batches WHERE org_id=$1 ORDER BY id',[orgId]); }
  async rotateCode(orgId: string, batchId: string, actor: string) {
    return this.tx(async tx => {
      const [batch] = await tx.query('UPDATE institutes.batches SET join_code=$3 WHERE org_id=$1 AND id=$2 RETURNING id,join_code',[orgId,batchId,randomBytes(18).toString('base64url')]);
      if (!batch) return missing(); await this.audit(tx,orgId,actor,'batch.rotate',batchId); return batch;
    });
  }
  // Deliberately global discovery seams: resolve public identifiers before any tenant-scoped operation.
  async resolveCourse(courseId: string) {
    const [course] = await this.driver.query("SELECT c.org_id,c.id,c.title,c.kind,o.name AS org_name,o.logo_url,o.accent_color FROM institutes.courses c JOIN institutes.orgs o ON o.id=c.org_id WHERE c.id=$1 AND c.status='published' AND o.status<>'paused'",[courseId]);
    return course ?? missing();
  }
  async resolveJoin(joinCode: string) {
    const [batch] = await this.driver.query("SELECT b.org_id,b.course_id,b.id AS batch_id,c.title,o.name AS org_name FROM institutes.batches b JOIN institutes.courses c ON (c.org_id,c.id)=(b.org_id,b.course_id) JOIN institutes.orgs o ON o.id=b.org_id WHERE b.join_code=$1 AND b.status='active' AND c.status='published' AND o.status<>'paused' AND (b.starts_on IS NULL OR b.starts_on<=$2) AND (b.ends_on IS NULL OR b.ends_on>$2)",[joinCode,Date.now()]);
    return batch ?? missing();
  }
  private async active(tx: Driver, orgId: string, courseId: string, userId: string) {
    const rows = await tx.query("SELECT e.batch_id FROM institutes.enrollments e JOIN institutes.courses c ON (c.org_id,c.id)=(e.org_id,e.course_id) JOIN institutes.orgs o ON o.id=e.org_id LEFT JOIN institutes.batches b ON (b.org_id,b.id)=(e.org_id,e.batch_id) WHERE e.org_id=$1 AND e.course_id=$2 AND e.user_id=$3 AND e.left_at IS NULL AND c.status='published' AND o.status<>'paused' AND (e.batch_id IS NULL OR (b.status='active' AND (b.starts_on IS NULL OR b.starts_on<=$4) AND (b.ends_on IS NULL OR b.ends_on>$4)))",[orgId,courseId,userId,Date.now()]);
    return { enrolled: !!rows.length, member: rows.some(row=>row.batch_id!==null) };
  }
  private async latest(tx: Driver, orgId: string, courseId: string) {
    const [version] = await tx.query('SELECT version,payload_json FROM institutes.course_versions WHERE org_id=$1 AND course_id=$2 ORDER BY version DESC LIMIT 1',[orgId,courseId]);
    if (!version) return missing(); return { version: Number(version.version), data: version.payload_json as CoursePayload };
  }
  async courseVersion(orgId: string, courseId: string, version: number, userId?: string) {
    const [row] = await this.driver.query("SELECT v.payload_json,c.kind FROM institutes.course_versions v JOIN institutes.courses c ON (c.org_id,c.id)=(v.org_id,v.course_id) JOIN institutes.orgs o ON o.id=c.org_id WHERE v.org_id=$1 AND v.course_id=$2 AND v.version=$3 AND c.status='published' AND o.status<>'paused'",[orgId,courseId,version]);
    if (!row) return missing();
    const access = userId ? await this.active(this.driver,orgId,courseId,userId) : { enrolled:false,member:false };
    if (row.kind==='batch' && !access.member) return denied();
    return { payload: publicPayload(row.payload_json as CoursePayload, access.member), etag: `"${courseId}:${version}:${access.member?'member':'public'}"` };
  }
  async mine(userId: string) {
    const rows = await this.driver.query("SELECT e.org_id,e.course_id,e.batch_id,o.name,o.logo_url,o.accent_color FROM institutes.enrollments e JOIN institutes.orgs o ON o.id=e.org_id WHERE e.user_id=$1 AND e.left_at IS NULL AND o.status<>'paused' ORDER BY e.org_id,e.course_id",[userId]);
    const out = [];
    for (const row of rows) {
      const orgId=String(row.org_id),courseId=String(row.course_id);
      const access=await this.active(this.driver,orgId,courseId,userId); if (!access.enrolled) continue;
      const latest=await this.latest(this.driver,orgId,courseId);
      out.push({ orgId,courseId,batchId: row.batch_id,org:{name:row.name,logo:row.logo_url,accent:row.accent_color},courseVersion:latest.version,etag:`"${courseId}:${latest.version}:${access.member?'member':'public'}"` });
    }
    return out;
  }
  private async student(tx: Driver, actor: Actor, mobile: string, verified: boolean) {
    await tx.query('INSERT INTO institutes.students(user_id,phone,phone_verified_at,name,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO NOTHING',[actor.id,mobile,verified?Date.now():null,actor.name,Date.now()]);
    const [row]=await tx.query('SELECT * FROM institutes.students WHERE user_id=$1 FOR UPDATE',[actor.id]);
    if (row.phone!==mobile) return conflict('Use the phone number already registered for your institute courses.');
    if (verified) await tx.query('UPDATE institutes.students SET phone_verified_at=$2 WHERE user_id=$1',[actor.id,Date.now()]);
    return { ...row, phone_verified_at: verified?Date.now():row.phone_verified_at };
  }
  async verifyPhone(actor: Actor, mobile: string) { return this.tx(async tx=>{ await this.student(tx,actor,mobile,true); }); }
  private async consent(tx: Driver, orgId: string, userId: string, purpose: string) {
    return !!(await tx.query('SELECT id FROM institutes.consents WHERE org_id=$1 AND user_id=$2 AND purpose=$3 AND withdrawn_at IS NULL',[orgId,userId,purpose])).length;
  }
  private async setSharing(tx: Driver, orgId: string, userId: string, sharing: Sharing) {
    for (const purpose of ['progress','contact'] as const) {
      if (sharing[purpose]) {
        await tx.query('INSERT INTO institutes.consents(id,org_id,user_id,text_version,purpose,given_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,user_id,purpose) WHERE withdrawn_at IS NULL DO NOTHING',[randomUUID(),orgId,userId,sharing.textVersion,purpose,Date.now()]);
      } else {
        await tx.query('UPDATE institutes.consents SET withdrawn_at=$4 WHERE org_id=$1 AND user_id=$2 AND purpose=$3 AND withdrawn_at IS NULL',[orgId,userId,purpose,Date.now()]);
        if (purpose==='progress') {
          await tx.query('DELETE FROM institutes.progress WHERE org_id=$1 AND user_id=$2',[orgId,userId]);
          await tx.query('DELETE FROM institutes.quiz_attempts WHERE org_id=$1 AND user_id=$2',[orgId,userId]);
        }
      }
    }
  }
  async enroll(orgId: string, courseId: string, actor: Actor, input: { phone: string; consents: Sharing; joinCode?: string }) {
    return this.tx(async tx => {
      const student=await this.student(tx,actor,input.phone,actor.phone===input.phone);
      if (input.consents.contact && !student.phone_verified_at) return conflict('Verify this phone by OTP before sharing contact details.');
      const [course]=await tx.query("SELECT c.kind FROM institutes.courses c JOIN institutes.orgs o ON o.id=c.org_id WHERE c.org_id=$1 AND c.id=$2 AND c.status='published' AND o.status<>'paused'",[orgId,courseId]); if (!course) return missing();
      let batchId: string|null=null;
      if (input.joinCode) {
        const [batch]=await tx.query("SELECT * FROM institutes.batches WHERE org_id=$1 AND course_id=$2 AND join_code=$3 AND status='active' AND (starts_on IS NULL OR starts_on<=$4) AND (ends_on IS NULL OR ends_on>$4) FOR UPDATE",[orgId,courseId,input.joinCode,Date.now()]); if (!batch) return missing();
        batchId=String(batch.id);
        const [existing]=await tx.query('SELECT id FROM institutes.enrollments WHERE org_id=$1 AND batch_id=$2 AND user_id=$3 AND left_at IS NULL',[orgId,batchId,actor.id]);
        const [used]=await tx.query('SELECT COUNT(*)::int AS n FROM institutes.enrollments WHERE org_id=$1 AND batch_id=$2 AND left_at IS NULL',[orgId,batchId]);
        if (!existing && Number(used.n)>=Number(batch.seats)) return conflict('This batch has no seats left.');
      } else if (course.kind!=='free') return denied();
      const [enrollment]=await tx.query("INSERT INTO institutes.enrollments(id,org_id,user_id,course_id,batch_id,joined_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,user_id,course_id,(COALESCE(batch_id,''))) DO UPDATE SET left_at=NULL RETURNING *",[randomUUID(),orgId,actor.id,courseId,batchId,Date.now()]);
      await this.setSharing(tx,orgId,actor.id,input.consents); return { id:enrollment.id,orgId,courseId,batchId };
    });
  }
  async myConsents(orgId: string, userId: string) {
    const rows=await this.driver.query('SELECT purpose,text_version,given_at FROM institutes.consents WHERE org_id=$1 AND user_id=$2 AND withdrawn_at IS NULL',[orgId,userId]);
    return {progress:rows.some(r=>r.purpose==='progress'),contact:rows.some(r=>r.purpose==='contact'),records:rows};
  }
  async assignments(orgId: string, courseId: string, userId: string) {
    const access=await this.active(this.driver,orgId,courseId,userId);if (!access.enrolled) return denied();
    return this.driver.query('SELECT a.id,a.item_ref,a.kind,a.due_on,a.note FROM institutes.assignments a JOIN institutes.enrollments e ON (e.org_id,e.batch_id)=(a.org_id,a.batch_id) WHERE a.org_id=$1 AND e.course_id=$2 AND e.user_id=$3 AND e.left_at IS NULL ORDER BY a.id',[orgId,courseId,userId]);
  }
  async changeConsent(orgId: string, userId: string, sharing: Sharing) {
    return this.tx(async tx=>{
      const [student]=await tx.query('SELECT phone_verified_at FROM institutes.students WHERE user_id=$1 FOR UPDATE',[userId]); if (!student) return denied();
      const [enrolled]=await tx.query('SELECT id FROM institutes.enrollments WHERE org_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1',[orgId,userId]); if (!enrolled) return denied();
      if (sharing.contact && !student.phone_verified_at) return conflict('Verify your phone before sharing contact details.');
      await this.setSharing(tx,orgId,userId,sharing);
    });
  }
  async leave(orgId: string, courseId: string, userId: string) {
    return this.tx(async tx=>{
      await tx.query('SELECT user_id FROM institutes.students WHERE user_id=$1 FOR UPDATE',[userId]);
      await tx.query('UPDATE institutes.enrollments SET left_at=$4 WHERE org_id=$1 AND course_id=$2 AND user_id=$3 AND left_at IS NULL',[orgId,courseId,userId,Date.now()]);
      await tx.query('DELETE FROM institutes.progress WHERE org_id=$1 AND course_id=$2 AND user_id=$3',[orgId,courseId,userId]);
      await tx.query('DELETE FROM institutes.quiz_attempts a USING institutes.quizzes q WHERE a.org_id=$1 AND a.user_id=$3 AND (q.org_id,q.id)=(a.org_id,a.quiz_id) AND q.course_id=$2',[orgId,courseId,userId]);
      const [other]=await tx.query('SELECT id FROM institutes.enrollments WHERE org_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1',[orgId,userId]);
      if (!other) await this.setSharing(tx,orgId,userId,{ textVersion:'leave',progress:false,contact:false });
    });
  }
  private courseReceipt(orgId: string, courseId: string, userId: string) { return createHmac('sha256',this.receiptSecret).update(JSON.stringify(['course',orgId,courseId,userId])).digest('hex'); }
  private receipt(event: ProgressEvent) { return createHmac('sha256',this.receiptSecret).update(JSON.stringify([event.orgId,event.courseId,event.videoId,event.userId])).digest('hex'); }
  async recordProgress(events: ProgressEvent[]) {
    return this.tx(async tx=>{
      for (const event of [...events].sort((a,b)=>a.userId.localeCompare(b.userId))) {
        const {orgId,userId,courseId,videoId,seconds,stage}=event;
        await tx.query('SELECT user_id FROM institutes.students WHERE user_id=$1 FOR UPDATE',[userId]);
        const access=await this.active(tx,orgId,courseId,userId); if (!access.enrolled) return denied();
        const latest=await this.latest(tx,orgId,courseId);
        if (!videoIds(latest.data,access.member).includes(videoId)) return denied();
        const receipt=this.receipt(event), rank=STAGE_RANK[stage];
        await tx.query('INSERT INTO institutes.total_receipts(org_id,course_id,video_id,receipt,rank) VALUES($1,$2,$3,$4,0) ON CONFLICT DO NOTHING',[orgId,courseId,videoId,receipt]);
        const [previous]=await tx.query('SELECT rank FROM institutes.total_receipts WHERE org_id=$1 AND course_id=$2 AND video_id=$3 AND receipt=$4 FOR UPDATE',[orgId,courseId,videoId,receipt]);
        const before=Number(previous.rank);
        if (rank>before) {
          await tx.query('UPDATE institutes.total_receipts SET rank=$5 WHERE org_id=$1 AND course_id=$2 AND video_id=$3 AND receipt=$4',[orgId,courseId,videoId,receipt,rank]);
          await tx.query('INSERT INTO institutes.course_stats(org_id,course_id,video_id,day,started,half,done) VALUES($1,$2,$3,$4::date,$5,$6,$7) ON CONFLICT(org_id,course_id,video_id,day) DO UPDATE SET started=institutes.course_stats.started+EXCLUDED.started, half=institutes.course_stats.half+EXCLUDED.half, done=institutes.course_stats.done+EXCLUDED.done',[orgId,courseId,videoId,new Date().toISOString().slice(0,10),before<1?1:0,before<2&&rank>=2?1:0,before<3&&rank>=3?1:0]);
        }
        await tx.query('INSERT INTO institutes.funnel_receipts(org_id,course_id,receipt,rank) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,course_id,receipt) DO UPDATE SET rank=GREATEST(institutes.funnel_receipts.rank,EXCLUDED.rank)',[orgId,courseId,this.courseReceipt(orgId,courseId,userId),rank]);
        if (await this.consent(tx,orgId,userId,'progress')) {
          // Max rank and seconds are monotonic, including late/out-of-order events.
          const [prior]=await tx.query('SELECT stage FROM institutes.progress WHERE org_id=$1 AND user_id=$2 AND course_id=$3 AND video_id=$4',[orgId,userId,courseId,videoId]);
          const chosen=prior && STAGE_RANK[prior.stage as Milestone]>rank?prior.stage:stage;
          await tx.query('INSERT INTO institutes.progress(org_id,user_id,course_id,video_id,stage,seconds,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,user_id,course_id,video_id) DO UPDATE SET stage=EXCLUDED.stage,seconds=GREATEST(institutes.progress.seconds,EXCLUDED.seconds),updated_at=EXCLUDED.updated_at',[orgId,userId,courseId,videoId,chosen,seconds,Date.now()]);
        }
      }
    });
  }
  async createQuiz(orgId: string, courseId: string, actor: string, videoId: string, questions: QuizQuestion[]) {
    return this.tx(async tx=>{
      const course=await this.latest(tx,orgId,courseId);
      if (!videoIds(course.data,true).includes(videoId)) return missing();
      const [quiz]=await tx.query("INSERT INTO institutes.quizzes(id,org_id,course_id,video_id,questions_json,status,created_by) VALUES($1,$2,$3,$4,$5::jsonb,'draft',$6) RETURNING id",[randomUUID(),orgId,courseId,videoId,JSON.stringify(questions),actor]);
      await this.audit(tx,orgId,actor,'quiz.create',String(quiz.id)); return quiz;
    });
  }
  async publishQuiz(orgId: string, quizId: string, actor: string) {
    return this.tx(async tx=>{ const rows=await tx.query("UPDATE institutes.quizzes SET status='published' WHERE org_id=$1 AND id=$2 RETURNING id",[orgId,quizId]); if (!rows.length) return missing(); await this.audit(tx,orgId,actor,'quiz.publish',quizId); });
  }
  async quiz(orgId: string, quizId: string, userId: string) {
    const [quiz]=await this.driver.query("SELECT course_id,video_id,questions_json FROM institutes.quizzes WHERE org_id=$1 AND id=$2 AND status='published'",[orgId,quizId]); if (!quiz) return missing();
    const courseId=String(quiz.course_id),videoId=String(quiz.video_id);
    const access=await this.active(this.driver,orgId,courseId,userId); if (!access.enrolled) return denied();
    const latest=await this.latest(this.driver,orgId,courseId);
    if (!videoIds(latest.data,access.member).includes(videoId)) return denied();
    const [receipt]=await this.driver.query('SELECT rank FROM institutes.total_receipts WHERE org_id=$1 AND course_id=$2 AND video_id=$3 AND receipt=$4',[orgId,courseId,videoId,this.receipt({orgId,courseId,videoId,userId,stage:'done',seconds:0})]);
    if (Number(receipt?.rank)!==3) return conflict('Finish the video before opening this institute quiz.');
    return { courseId, questions: (quiz.questions_json as QuizQuestion[]).map(({question,options})=>({question,options})) };
  }
  async attemptQuiz(orgId: string, quizId: string, userId: string, answers: number[]) {
    return this.tx(async tx=>{
      await tx.query('SELECT user_id FROM institutes.students WHERE user_id=$1 FOR UPDATE',[userId]);
      // Recheck membership/completion while holding the same student lock as withdrawal/leave.
      const [quiz]=await tx.query("SELECT course_id,video_id,questions_json FROM institutes.quizzes WHERE org_id=$1 AND id=$2 AND status='published'",[orgId,quizId]); if (!quiz) return missing();
      const courseId=String(quiz.course_id),videoId=String(quiz.video_id),questions=quiz.questions_json as QuizQuestion[];
      const access=await this.active(tx,orgId,courseId,userId); if (!access.enrolled) return denied();
      const latest=await this.latest(tx,orgId,courseId); if (!videoIds(latest.data,access.member).includes(videoId)) return denied();
      const [receipt]=await tx.query('SELECT rank FROM institutes.total_receipts WHERE org_id=$1 AND course_id=$2 AND video_id=$3 AND receipt=$4',[orgId,courseId,videoId,this.receipt({orgId,courseId,videoId,userId,stage:'done',seconds:0})]); if (Number(receipt?.rank)!==3) return conflict('Finish the video first.');
      if (answers.length!==questions.length || answers.some((a,i)=>!Number.isInteger(a)||a<0||a>=questions[i].options.length)) throw new ApiError(400,'invalid_request','Answer each question once.');
      const score=questions.filter((q,i)=>q.answer===answers[i]).length,total=questions.length;
      if (score/total>=.7) await tx.query('UPDATE institutes.funnel_receipts SET passed_quiz=true WHERE org_id=$1 AND course_id=$2 AND receipt=$3',[orgId,courseId,this.courseReceipt(orgId,courseId,userId)]);
      if (await this.consent(tx,orgId,userId,'progress')) await tx.query('INSERT INTO institutes.quiz_attempts(org_id,user_id,quiz_id,score,total,attempted_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,user_id,quiz_id) DO UPDATE SET score=EXCLUDED.score,total=EXCLUDED.total,attempted_at=EXCLUDED.attempted_at',[orgId,userId,quizId,score,total,Date.now()]);
      return {score,total};
    });
  }
  async assignment(orgId: string, batchId: string, actor: string, input: { itemRef: string; kind: 'today'|'homework'; dueOn?: number; note?: string }) {
    return this.tx(async tx=>{
      const [batch]=await tx.query('SELECT course_id FROM institutes.batches WHERE org_id=$1 AND id=$2',[orgId,batchId]);if (!batch) return missing();
      const course=await this.latest(tx,orgId,String(batch.course_id));
      const refs=course.data.subjects.flatMap(s=>s.topics.flatMap(t=>t.items.map(i=>i.videoId??i.playlistId)));
      if (!refs.includes(input.itemRef)) return conflict('Choose an item in this batch’s course.');
      const [row]=await tx.query('INSERT INTO institutes.assignments(id,org_id,batch_id,item_ref,kind,due_on,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[randomUUID(),orgId,batchId,input.itemRef,input.kind,input.dueOn??null,input.note??null,actor]);
      await this.audit(tx,orgId,actor,'assignment.create',String(row.id)); return row;
    });
  }
  async funnel(orgId: string, courseId?: string) {
    const [totals]=await this.driver.query(`SELECT
      (SELECT COUNT(DISTINCT (user_id,course_id))::int FROM institutes.enrollments WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2)) AS joined,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND rank>=1) AS started,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND rank>=2) AS half,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND rank>=3) AS done,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND passed_quiz) AS passed_quiz,
      (SELECT COUNT(DISTINCT (c.user_id,e.course_id))::int FROM institutes.consents c JOIN institutes.enrollments e ON e.org_id=c.org_id AND e.user_id=c.user_id WHERE c.org_id=$1 AND c.purpose='progress' AND c.withdrawn_at IS NULL AND e.left_at IS NULL AND ($2::text IS NULL OR e.course_id=$2)) AS shared_progress,
      (SELECT COUNT(DISTINCT (c.user_id,e.course_id))::int FROM institutes.consents c JOIN institutes.students s ON s.user_id=c.user_id JOIN institutes.enrollments e ON e.org_id=c.org_id AND e.user_id=c.user_id WHERE c.org_id=$1 AND c.purpose='contact' AND c.withdrawn_at IS NULL AND s.phone_verified_at IS NOT NULL AND e.left_at IS NULL AND ($2::text IS NULL OR e.course_id=$2)) AS shared_contact`,[orgId,courseId??null]);
    const videos=await this.driver.query('SELECT course_id,video_id,SUM(started)::int AS started,SUM(half)::int AS half,SUM(done)::int AS done FROM institutes.course_stats WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) GROUP BY course_id,video_id ORDER BY course_id,video_id',[orgId,courseId??null]);
    return { ...totals, videos:videos.map(row=>({...row,drop_off:Math.max(0,Number(row.started)-Number(row.done)),completion_percent:Number(row.started)?Math.round(Number(row.done)*100/Number(row.started)):0})), note:'Funnel counts course participants (a learner in two courses counts twice). Milestones are cumulative; sharing counts current consent. A passed quiz means at least 70%.' };
  }
  async students(orgId: string, filter: PageFilter, leads = false) {
    // Names/metrics require progress consent. Contact-only leads can expose name/phone, never scores.
    const rows=await this.driver.query(`WITH candidate AS (
      SELECT DISTINCT s.user_id,s.name,CASE WHEN $2::boolean THEN s.phone ELSE NULL END AS phone,
        EXISTS(SELECT 1 FROM institutes.consents c WHERE c.org_id=$1 AND c.user_id=s.user_id AND c.purpose='progress' AND c.withdrawn_at IS NULL) AS sharing_progress
      FROM institutes.students s JOIN institutes.enrollments e ON e.user_id=s.user_id
      WHERE e.org_id=$1 AND e.left_at IS NULL AND ($3::text IS NULL OR e.course_id=$3) AND ($4::text IS NULL OR s.user_id>$4)
      AND EXISTS(SELECT 1 FROM institutes.consents c WHERE c.org_id=$1 AND c.user_id=s.user_id AND c.purpose=CASE WHEN $2::boolean THEN 'contact' ELSE 'progress' END AND c.withdrawn_at IS NULL)
      AND (NOT $2::boolean OR s.phone_verified_at IS NOT NULL)
    ), measured AS (
      SELECT c.*,CASE WHEN sharing_progress THEN (SELECT COUNT(*)::int FROM institutes.progress p WHERE p.org_id=$1 AND p.user_id=c.user_id AND p.stage='done' AND ($3::text IS NULL OR p.course_id=$3)) ELSE NULL END AS completed_videos,
      CASE WHEN sharing_progress THEN (SELECT ROUND(AVG(a.score*100.0/a.total))::int FROM institutes.quiz_attempts a JOIN institutes.quizzes q ON (q.org_id,q.id)=(a.org_id,a.quiz_id) WHERE a.org_id=$1 AND a.user_id=c.user_id AND ($3::text IS NULL OR q.course_id=$3)) ELSE NULL END AS quiz_score
      FROM candidate c
    ), completed AS (SELECT m.*,CASE WHEN sharing_progress THEN LEAST(100,COALESCE(ROUND(completed_videos*100.0/NULLIF((SELECT SUM(c.video_count) FROM institutes.courses c WHERE c.org_id=$1 AND ($3::text IS NULL OR c.id=$3) AND EXISTS(SELECT 1 FROM institutes.enrollments e WHERE e.org_id=$1 AND e.course_id=c.id AND e.user_id=m.user_id AND e.left_at IS NULL)),0)),0))::int ELSE NULL END AS completion_percent FROM measured m)
    SELECT * FROM completed WHERE ($5::int IS NULL OR completion_percent>=$5) AND ($6::int IS NULL OR quiz_score>=$6) ORDER BY user_id LIMIT $7`,[orgId,leads,filter.courseId??null,filter.after??null,filter.minCompletion??null,filter.minQuizScore??null,filter.limit+1]);
    const items=rows.slice(0,filter.limit); return { items, next: rows.length>filter.limit?String(items.at(-1)!.user_id):null };
  }
  async leads(orgId: string, actor: string, filter: PageFilter) {
    // Export and audit share one transaction; fail closed if audit cannot be recorded.
    return this.tx(async tx=>{
      // The SELECT statement snapshot is the export's linearisation point; already-committed withdrawals are excluded.
      const result=await new InstitutesDb(tx,this.receiptSecret).students(orgId,filter,true);
      await this.audit(tx,orgId,actor,'leads.export',JSON.stringify({ ...filter,rows:result.items.length })); return result;
    });
  }
}

let configured: Promise<InstitutesDb> | undefined;
export function configuredInstitutes(secret: string): Promise<InstitutesDb> {
  if (!process.env.DATABASE_URL) return Promise.reject(new ApiError(503,'internal_error','Institute services are not configured.'));
  if (!configured) {
    const driver=postgresDriver(postgres(process.env.DATABASE_URL,{max:10,connect_timeout:10,idle_timeout:20}));
    const db=new InstitutesDb(driver,secret);
    configured=db.migrate().then(()=>db).catch(async ()=>{ configured=undefined; await driver.close(); throw new ApiError(503,'internal_error','Institute database is unavailable.'); });
  }
  return configured;
}
