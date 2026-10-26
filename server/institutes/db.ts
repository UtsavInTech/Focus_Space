import {EMPTY_CONTEXT,type StudioContext,type StudentRules,type PlaybookInput,type Outcome} from './studio-types';
import postgres from 'postgres';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../http';
import { CONSENT_VERSION, STAGE_RANK, type Actor, type CoursePayload, type Item, type Milestone, type OrgRole, type PageFilter, type ProgressEvent, type QuizQuestion, type Sharing } from './types';
import { payload as validatePayload } from './validate';

type Row = Record<string, unknown>;

/** The small surface the institutes code needs from Postgres — Postgres.js in production, PGlite in tests. */
export interface Driver {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(work: (tx: Driver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function postgresDriver(sql: postgres.Sql): Driver {
  return {
    query: async <T extends Row>(query: string, params: unknown[] = []) => (await sql.unsafe(query, params as never[])) as unknown as T[],
    exec: async (query) => {
      await sql.unsafe(query, [], { prepare: false });
    },
    transaction: async <T>(work: (tx: Driver) => Promise<T>) => (await sql.begin((tx) => work(postgresDriver(tx as unknown as postgres.Sql)))) as T,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
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

/** Later migrations (2 and 3). Each `CREATE … IF NOT EXISTS` is safe to replay on every start. */
/**
 * Version 4 (26 Oct 2026, owner's decision): joining needs a verified phone and the institute receives
 * every member's number, under the terms version recorded on the enrolment. "Contact me" becomes a
 * priority request the institute sees in its inbox. Quiz me scores get a time, for the student report.
 */
const MIGRATION_4 = `ALTER TABLE institutes.quizme_scores ADD COLUMN IF NOT EXISTS at bigint NOT NULL DEFAULT 0;
      ALTER TABLE institutes.enrollments ADD COLUMN IF NOT EXISTS terms_version text;
      CREATE TABLE IF NOT EXISTS institutes.contact_requests(id text PRIMARY KEY,org_id text NOT NULL REFERENCES institutes.orgs(id),user_id text NOT NULL REFERENCES institutes.students(user_id),course_id text,source text NOT NULL CHECK(source IN ('join','sharing','button')),note text,created_at bigint NOT NULL,handled_at bigint,handled_by text);
      CREATE INDEX IF NOT EXISTS contact_requests_org ON institutes.contact_requests(org_id,handled_at,created_at);
      INSERT INTO institutes.migrations(version,applied_at) VALUES(4,0) ON CONFLICT DO NOTHING;`;

const MIGRATIONS_2_AND_3 = `CREATE TABLE IF NOT EXISTS institutes.import_cache(org_id text NOT NULL,course_id text NOT NULL,claimed_at bigint NOT NULL,payload_json jsonb,PRIMARY KEY(org_id,course_id),FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id));
      CREATE TABLE IF NOT EXISTS institutes.channel_approvals(org_id text NOT NULL,course_id text NOT NULL,channel_id text NOT NULL,approved_by text,created_at bigint NOT NULL,PRIMARY KEY(org_id,course_id,channel_id),FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id));
      INSERT INTO institutes.migrations(version,applied_at) VALUES(2,0) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS institutes.quizme_scores(org_id text NOT NULL,course_id text NOT NULL,user_id text NOT NULL REFERENCES institutes.students(user_id),video_id text NOT NULL,score integer NOT NULL,total integer NOT NULL CHECK(total>0 AND score>=0 AND score<=total),PRIMARY KEY(org_id,course_id,user_id,video_id),FOREIGN KEY(org_id,course_id) REFERENCES institutes.courses(org_id,id));
      INSERT INTO institutes.migrations(version,applied_at) VALUES(3,0) ON CONFLICT DO NOTHING;`;

/** A day's import claim: a failed or running import still holds it, so retries can't burn more quota. */
const IMPORT_CLAIM_MS = 86400000;
/** A passed institute quiz, until the phase-2 quiz editor lets faculty choose. */
const QUIZ_PASS_RATIO = 0.7;

const FUNNEL_NOTE = 'Funnel counts course participants (a learner in two courses counts twice). Milestones are cumulative; sharing counts current consent. A passed quiz means at least 70%.';

const denied = (): never => {
  throw new ApiError(403, 'forbidden', 'You do not have access to this institute resource.');
};
const missing = (): never => {
  throw new ApiError(404, 'invalid_request', 'Resource not found.');
};
const conflict = (message: string): never => {
  throw new ApiError(409, 'conflict', message);
};

const allItems = (data: CoursePayload) => data.subjects.flatMap((subject) => subject.topics.flatMap((topic) => topic.items));
const visible = (item: Item, member: boolean) => member || !item.membersOnly;

export const videoIds = (data: CoursePayload, member = false): string[] =>
  allItems(data)
    .filter((item) => item.type === 'video' && visible(item, member))
    .map((item) => item.videoId!);

/** Members-only items are removed, not hidden: a non-member's copy of the course never contains them. */
export function publicPayload(data: CoursePayload, member: boolean): CoursePayload {
  const clean = validatePayload(data);
  return {
    ...clean,
    subjects: clean.subjects.map((subject) => ({
      ...subject,
      topics: subject.topics.map((topic) => ({ ...topic, items: topic.items.filter((item) => visible(item, member)) })),
    })),
  };
}

const etagFor = (courseId: string, version: number, member: boolean) => `"${courseId}:${version}:${member ? 'member' : 'public'}"`;

/** How many daily totals one milestone moves: each total counts a learner once, however they arrive at it. */
function milestoneDeltas(before: number, rank: number): [started: number, half: number, done: number] {
  return [before < 1 ? 1 : 0, before < 2 && rank >= 2 ? 1 : 0, before < 3 && rank >= 3 ? 1 : 0];
}

function withDropOff(row: Row) {
  const started = Number(row.started);
  const done = Number(row.done);
  return { ...row, drop_off: Math.max(0, started - done), completion_percent: started ? Math.round((done * 100) / started) : 0 };
}

const STUDIO_SCHEMA = `
CREATE TABLE IF NOT EXISTS institutes.studio_study_days(org_id text NOT NULL REFERENCES institutes.orgs(id),user_id text NOT NULL,course_id text NOT NULL,day integer NOT NULL,PRIMARY KEY(org_id,user_id,course_id,day));
CREATE TABLE IF NOT EXISTS institutes.studio_context(org_id text NOT NULL REFERENCES institutes.orgs(id),version integer NOT NULL,data jsonb NOT NULL,actor text NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(org_id,version));
CREATE TABLE IF NOT EXISTS institutes.studio_edits(id text PRIMARY KEY,org_id text NOT NULL REFERENCES institutes.orgs(id),user_id text NOT NULL,before_text text NOT NULL,after_text text NOT NULL,actor text NOT NULL,created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS institutes.studio_threads(id text PRIMARY KEY,org_id text NOT NULL REFERENCES institutes.orgs(id),title text NOT NULL,pinned boolean NOT NULL DEFAULT false,created_at bigint NOT NULL,updated_at bigint NOT NULL,UNIQUE(org_id,id));
CREATE TABLE IF NOT EXISTS institutes.studio_messages(id text PRIMARY KEY,org_id text NOT NULL,thread_id text NOT NULL,question text NOT NULL,plan jsonb NOT NULL,created_at bigint NOT NULL,FOREIGN KEY(org_id,thread_id) REFERENCES institutes.studio_threads(org_id,id));
CREATE TABLE IF NOT EXISTS institutes.studio_lists(id text PRIMARY KEY,org_id text NOT NULL REFERENCES institutes.orgs(id),name text NOT NULL,rules jsonb NOT NULL,created_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS institutes.playbooks(id text PRIMARY KEY,org_id text NOT NULL REFERENCES institutes.orgs(id),name text NOT NULL,rules jsonb NOT NULL,template text NOT NULL,channel text NOT NULL,personalize boolean NOT NULL,reviewed_at bigint,created_at bigint NOT NULL,UNIQUE(org_id,id));
CREATE TABLE IF NOT EXISTS institutes.playbook_sends(id text PRIMARY KEY,org_id text NOT NULL,playbook_id text NOT NULL,user_id text NOT NULL,status text NOT NULL CHECK(status IN ('open','sent','skipped')),draft text NOT NULL DEFAULT '',why jsonb NOT NULL DEFAULT '[]',created_at bigint NOT NULL,sent_at bigint,FOREIGN KEY(org_id,playbook_id) REFERENCES institutes.playbooks(org_id,id),UNIQUE(org_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_open ON institutes.playbook_sends(org_id,user_id) WHERE status='open';
CREATE TABLE IF NOT EXISTS institutes.studio_outcomes(id text PRIMARY KEY,org_id text NOT NULL REFERENCES institutes.orgs(id),user_id text NOT NULL,playbook_id text,kind text NOT NULL,course text,fee integer NOT NULL DEFAULT 0 CHECK(fee>=0),actor text NOT NULL,created_at bigint NOT NULL,FOREIGN KEY(org_id,playbook_id) REFERENCES institutes.playbooks(org_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_enrolment ON institutes.studio_outcomes(org_id,user_id,LOWER(TRIM(course))) WHERE kind='enrolled';
CREATE INDEX IF NOT EXISTS studio_results_period ON institutes.studio_outcomes(org_id,created_at);
CREATE INDEX IF NOT EXISTS studio_send_student ON institutes.playbook_sends(org_id,user_id,playbook_id);
CREATE INDEX IF NOT EXISTS studio_thread_recent ON institutes.studio_threads(org_id,updated_at DESC);
INSERT INTO institutes.migrations(version,applied_at) VALUES(5,0) ON CONFLICT DO NOTHING;
`;

export class InstitutesDb {
  constructor(
    readonly driver: Driver,
    private readonly receiptSecret: string,
  ) {
    if (receiptSecret.length < 32) throw new Error('Institute receipt key must have at least 32 characters.');
  }

  async migrate() {
    await this.driver.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(67261901)');
      await tx.exec('CREATE SCHEMA IF NOT EXISTS institutes; CREATE TABLE IF NOT EXISTS institutes.migrations(version integer PRIMARY KEY,applied_at bigint NOT NULL);');
      const installed = await tx.query('SELECT version FROM institutes.migrations WHERE version=1');
      if (!installed.length) {
        await tx.exec(SCHEMA);
        await tx.query('UPDATE institutes.migrations SET applied_at=$1 WHERE version=1', [Date.now()]);
      }
      await tx.exec(MIGRATIONS_2_AND_3);
      await tx.exec(MIGRATION_4);
      await tx.exec(STUDIO_SCHEMA);
    });
  }

  /** Turns constraint violations into the API's own answers instead of a 500. */
  private async tx<T>(work: (tx: Driver) => Promise<T>): Promise<T> {
    try {
      return await this.driver.transaction(work);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return conflict('This record or phone number is already registered.');
      if (code === '23503' || code === '23514') throw new ApiError(400, 'invalid_request', 'Invalid institute relationship or value.');
      throw err;
    }
  }

  private async audit(tx: Driver, orgId: string, actor: string, action: string, target: string) {
    await tx.query('INSERT INTO institutes.audit_log(id,org_id,actor_id,action,target,at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), orgId, actor, action, target, Date.now()]);
  }

  /* ─── Organisations and staff ─────────────────────────────────────────────── */

  async orgs() {
    return this.driver.query('SELECT * FROM institutes.orgs ORDER BY id');
  }

  async createOrg(actor: string, input: { slug: string; name: string; logo?: string; accent?: string }) {
    return this.tx(async (tx) => {
      const orgId = randomUUID();
      const [org] = await tx.query(
        "INSERT INTO institutes.orgs(id,slug,name,logo_url,accent_color,status,created_at) VALUES($1,$2,$3,$4,$5,'pilot',$6) RETURNING *",
        [orgId, input.slug, input.name, input.logo ?? null, input.accent ?? null, Date.now()],
      );
      await this.audit(tx, orgId, actor, 'org.create', orgId);
      return org;
    });
  }

  async role(orgId: string, userId: string): Promise<OrgRole | null> {
    const [row] = await this.driver.query('SELECT role FROM institutes.org_members WHERE org_id=$1 AND user_id=$2', [orgId, userId]);
    return (row?.role as OrgRole) ?? null;
  }

  async setMember(orgId: string, actor: string, userId: string, role: OrgRole) {
    return this.tx(async (tx) => {
      await tx.query(
        'INSERT INTO institutes.org_members(org_id,user_id,role,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,user_id) DO UPDATE SET role=EXCLUDED.role',
        [orgId, userId, role, Date.now()],
      );
      await this.audit(tx, orgId, actor, 'member.set', userId);
    });
  }

  async myOrgs(userId: string) {
    return this.driver.query('SELECT o.id,o.name,m.role FROM institutes.org_members m JOIN institutes.orgs o ON o.id=m.org_id WHERE m.user_id=$1 ORDER BY o.id', [userId]);
  }

  async orgStatus(orgId: string, actor: string, status: 'pilot' | 'active' | 'paused') {
    return this.tx(async (tx) => {
      const rows = await tx.query('UPDATE institutes.orgs SET status=$2 WHERE id=$1 RETURNING id', [orgId, status]);
      if (!rows.length) return missing();
      await this.audit(tx, orgId, actor, 'org.status', status);
    });
  }

  /* ─── Courses, drafts and versions ────────────────────────────────────────── */

  async draft(orgId: string, courseId: string) {
    const [row] = await this.driver.query('SELECT id,title,kind,exam_id,draft_json FROM institutes.courses WHERE org_id=$1 AND id=$2', [orgId, courseId]);
    return row ?? missing();
  }

  async courses(orgId: string) {
    return this.driver.query('SELECT id,org_id,title,exam_id,kind,source_channel_id,status,created_at FROM institutes.courses WHERE org_id=$1 ORDER BY id', [orgId]);
  }

  async createCourse(orgId: string, actor: string, input: { title: string; examId?: string; kind: 'free' | 'batch'; channelId: string }) {
    return this.tx(async (tx) => {
      const [course] = await tx.query(
        "INSERT INTO institutes.courses(id,org_id,title,exam_id,kind,source_channel_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *",
        [randomUUID(), orgId, input.title, input.examId ?? null, input.kind, input.channelId, Date.now()],
      );
      await this.audit(tx, orgId, actor, 'course.create', String(course.id));
      return course;
    });
  }

  /** The source channel is always allowed; any other channel needs an owner/admin approval on record. */
  async saveDraft(orgId: string, courseId: string, actor: string, raw: unknown) {
    const data = validatePayload(raw);
    return this.tx(async (tx) => {
      const [course] = await tx.query('SELECT source_channel_id FROM institutes.courses WHERE org_id=$1 AND id=$2 FOR UPDATE', [orgId, courseId]);
      if (!course) return missing();
      const approved = await tx.query('SELECT channel_id FROM institutes.channel_approvals WHERE org_id=$1 AND course_id=$2 AND approved_by IS NOT NULL', [orgId, courseId]);
      const isApproved = (channelId: string) => channelId === course.source_channel_id || approved.some((row) => row.channel_id === channelId);
      if (data.approvedChannels.some((c) => !isApproved(c.id))) throw new ApiError(400, 'invalid_request', 'Outside channels require institute admin approval.');
      if (!data.approvedChannels.some((c) => c.id === course.source_channel_id)) throw new ApiError(400, 'invalid_request', 'The institute’s source channel must be approved.');
      await tx.query('UPDATE institutes.courses SET draft_json=$3::jsonb WHERE org_id=$1 AND id=$2', [orgId, courseId, JSON.stringify(data)]);
      await this.audit(tx, orgId, actor, 'course.draft', courseId);
    });
  }

  /** Publishing appends a version; published versions are never edited (a trigger enforces it). */
  async publish(orgId: string, courseId: string, actor: string) {
    return this.tx(async (tx) => {
      const [course] = await tx.query('SELECT draft_json,kind FROM institutes.courses WHERE org_id=$1 AND id=$2 FOR UPDATE', [orgId, courseId]);
      if (!course) return missing();
      if (!course.draft_json) return conflict('Save and review a draft before publishing.');
      const [last] = await tx.query('SELECT COALESCE(MAX(version),0)::int AS v FROM institutes.course_versions WHERE org_id=$1 AND course_id=$2', [orgId, courseId]);
      const version = Number(last.v) + 1;
      await tx.query(
        'INSERT INTO institutes.course_versions(org_id,course_id,version,payload_json,published_at,published_by) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
        [orgId, courseId, version, JSON.stringify(course.draft_json), Date.now(), actor],
      );
      const videoCount = new Set(videoIds(course.draft_json as CoursePayload, course.kind === 'batch')).size;
      await tx.query("UPDATE institutes.courses SET status='published',video_count=$3 WHERE org_id=$1 AND id=$2", [orgId, courseId, videoCount]);
      await this.audit(tx, orgId, actor, 'course.publish', `${courseId}:${version}`);
      return { courseId, version };
    });
  }

  async channelSuggestions(orgId: string, courseId: string) {
    return this.driver.query('SELECT channel_id,approved_by FROM institutes.channel_approvals WHERE org_id=$1 AND course_id=$2 ORDER BY channel_id', [orgId, courseId]);
  }

  /** A suggestion records the channel; only an org owner/admin's approval fills `approved_by`. */
  async suggestChannel(orgId: string, courseId: string, actor: string, channelId: string, approve = false) {
    return this.tx(async (tx) => {
      if (approve) {
        const [member] = await tx.query("SELECT role FROM institutes.org_members WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')", [orgId, actor]);
        if (!member) return denied();
      }
      await tx.query(
        'INSERT INTO institutes.channel_approvals(org_id,course_id,channel_id,approved_by,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id,course_id,channel_id) DO UPDATE SET approved_by=COALESCE(EXCLUDED.approved_by,institutes.channel_approvals.approved_by)',
        [orgId, courseId, channelId, approve ? actor : null, Date.now()],
      );
      await this.audit(tx, orgId, actor, approve ? 'channel.approve' : 'channel.suggest', channelId);
    });
  }

  async claimImport(orgId: string, courseId: string) {
    return this.tx(async (tx) => {
      const [course] = await tx.query(
        'SELECT c.*,o.name AS org_name,o.logo_url,o.accent_color FROM institutes.courses c JOIN institutes.orgs o ON o.id=c.org_id WHERE c.org_id=$1 AND c.id=$2 FOR UPDATE',
        [orgId, courseId],
      );
      if (!course) return missing();
      const [cache] = await tx.query('SELECT claimed_at,payload_json FROM institutes.import_cache WHERE org_id=$1 AND course_id=$2', [orgId, courseId]);
      if (cache && Date.now() - Number(cache.claimed_at) < IMPORT_CLAIM_MS) {
        if (cache.payload_json) return { course, cached: cache.payload_json as CoursePayload };
        return conflict('An import is running or was already attempted today. Retry tomorrow.');
      }
      await tx.query(
        'INSERT INTO institutes.import_cache(org_id,course_id,claimed_at) VALUES($1,$2,$3) ON CONFLICT(org_id,course_id) DO UPDATE SET claimed_at=EXCLUDED.claimed_at,payload_json=NULL',
        [orgId, courseId, Date.now()],
      );
      return { course, cached: null };
    });
  }

  async finishImport(orgId: string, courseId: string, actor: string, data: CoursePayload) {
    await this.saveDraft(orgId, courseId, actor, data);
    await this.tx(async (tx) => {
      await tx.query('UPDATE institutes.import_cache SET payload_json=$3::jsonb WHERE org_id=$1 AND course_id=$2', [orgId, courseId, JSON.stringify(data)]);
      await this.audit(tx, orgId, actor, 'course.import', courseId);
    });
  }

  /* ─── Batches ─────────────────────────────────────────────────────────────── */

  async createBatch(orgId: string, actor: string, input: { courseId: string; name: string; seats: number; startsOn?: number; endsOn?: number }) {
    return this.tx(async (tx) => {
      const [course] = await tx.query("SELECT id FROM institutes.courses WHERE org_id=$1 AND id=$2 AND kind='batch'", [orgId, input.courseId]);
      if (!course) return missing();
      const [batch] = await tx.query(
        "INSERT INTO institutes.batches(id,org_id,course_id,name,join_code,seats,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active') RETURNING *",
        [randomUUID(), orgId, input.courseId, input.name, randomBytes(18).toString('base64url'), input.seats, input.startsOn ?? null, input.endsOn ?? null],
      );
      await this.audit(tx, orgId, actor, 'batch.create', String(batch.id));
      return batch;
    });
  }

  async batches(orgId: string) {
    return this.driver.query('SELECT * FROM institutes.batches WHERE org_id=$1 ORDER BY id', [orgId]);
  }

  async batchSettings(orgId: string, batchId: string, actor: string, status: 'active' | 'paused', seats: number) {
    return this.tx(async (tx) => {
      const [batch] = await tx.query('SELECT id FROM institutes.batches WHERE org_id=$1 AND id=$2 FOR UPDATE', [orgId, batchId]);
      if (!batch) return missing();
      const [count] = await tx.query('SELECT COUNT(*)::int AS n FROM institutes.enrollments WHERE org_id=$1 AND batch_id=$2 AND left_at IS NULL', [orgId, batchId]);
      if (seats < Number(count.n)) return conflict('Seats cannot be reduced below current enrolment.');
      await tx.query('UPDATE institutes.batches SET status=$3,seats=$4 WHERE org_id=$1 AND id=$2', [orgId, batchId, status, seats]);
      await this.audit(tx, orgId, actor, 'batch.settings', batchId);
    });
  }

  async rotateCode(orgId: string, batchId: string, actor: string) {
    return this.tx(async (tx) => {
      const [batch] = await tx.query('UPDATE institutes.batches SET join_code=$3 WHERE org_id=$1 AND id=$2 RETURNING id,join_code', [orgId, batchId, randomBytes(18).toString('base64url')]);
      if (!batch) return missing();
      await this.audit(tx, orgId, actor, 'batch.rotate', batchId);
      return batch;
    });
  }

  /* ─── Public lookups and the student's own view ───────────────────────────── */

  // Deliberately global discovery seams: resolve public identifiers before any tenant-scoped operation.
  async resolveCourse(courseId: string) {
    const [course] = await this.driver.query(
      "SELECT c.org_id,c.id,c.title,c.kind,o.name AS org_name,o.logo_url,o.accent_color FROM institutes.courses c JOIN institutes.orgs o ON o.id=c.org_id WHERE c.id=$1 AND c.status='published' AND o.status<>'paused'",
      [courseId],
    );
    return course ?? missing();
  }

  async resolveJoin(joinCode: string) {
    const [batch] = await this.driver.query(
      "SELECT b.org_id,b.course_id,b.id AS batch_id,c.title,o.name AS org_name FROM institutes.batches b JOIN institutes.courses c ON (c.org_id,c.id)=(b.org_id,b.course_id) JOIN institutes.orgs o ON o.id=b.org_id WHERE b.join_code=$1 AND b.status='active' AND c.status='published' AND o.status<>'paused' AND (b.starts_on IS NULL OR b.starts_on<=$2) AND (b.ends_on IS NULL OR b.ends_on>$2)",
      [joinCode, Date.now()],
    );
    return batch ?? missing();
  }

  /** Enrolled = any live enrolment in a live course; member = at least one of them is through a live batch. */
  private async active(tx: Driver, orgId: string, courseId: string, userId: string) {
    const rows = await tx.query(
      "SELECT e.batch_id FROM institutes.enrollments e JOIN institutes.courses c ON (c.org_id,c.id)=(e.org_id,e.course_id) JOIN institutes.orgs o ON o.id=e.org_id LEFT JOIN institutes.batches b ON (b.org_id,b.id)=(e.org_id,e.batch_id) WHERE e.org_id=$1 AND e.course_id=$2 AND e.user_id=$3 AND e.left_at IS NULL AND c.status='published' AND o.status<>'paused' AND (e.batch_id IS NULL OR (b.status='active' AND (b.starts_on IS NULL OR b.starts_on<=$4) AND (b.ends_on IS NULL OR b.ends_on>$4)))",
      [orgId, courseId, userId, Date.now()],
    );
    return { enrolled: !!rows.length, member: rows.some((row) => row.batch_id !== null) };
  }

  /** The latest published version of an institute's course, for its own Studio. */
  async outline(orgId: string, courseId: string) {
    return this.latest(this.driver, orgId, courseId);
  }

  private async latest(tx: Driver, orgId: string, courseId: string) {
    const [version] = await tx.query('SELECT version,payload_json FROM institutes.course_versions WHERE org_id=$1 AND course_id=$2 ORDER BY version DESC LIMIT 1', [orgId, courseId]);
    if (!version) return missing();
    return { version: Number(version.version), data: version.payload_json as CoursePayload };
  }

  /** Throws unless `videoId` is in the latest version as this learner may see it (members-only included only for members). */
  private async requireCourseVideo(tx: Driver, orgId: string, courseId: string, videoId: string, member: boolean): Promise<void> {
    const latest = await this.latest(tx, orgId, courseId);
    if (!videoIds(latest.data, member).includes(videoId)) denied();
  }

  async courseVersion(orgId: string, courseId: string, version: number, userId?: string) {
    const [row] = await this.driver.query(
      "SELECT v.payload_json,c.kind FROM institutes.course_versions v JOIN institutes.courses c ON (c.org_id,c.id)=(v.org_id,v.course_id) JOIN institutes.orgs o ON o.id=c.org_id WHERE v.org_id=$1 AND v.course_id=$2 AND v.version=$3 AND c.status='published' AND o.status<>'paused'",
      [orgId, courseId, version],
    );
    if (!row) return missing();
    const access = userId ? await this.active(this.driver, orgId, courseId, userId) : { enrolled: false, member: false };
    if (row.kind === 'batch' && !access.member) return denied();
    return { payload: publicPayload(row.payload_json as CoursePayload, access.member), etag: etagFor(courseId, version, access.member) };
  }

  async mine(userId: string) {
    const rows = await this.driver.query(
      "SELECT e.org_id,e.course_id,e.batch_id,c.title,o.name,o.logo_url,o.accent_color FROM institutes.enrollments e JOIN institutes.courses c ON (c.org_id,c.id)=(e.org_id,e.course_id) JOIN institutes.orgs o ON o.id=e.org_id WHERE e.user_id=$1 AND e.left_at IS NULL AND o.status<>'paused' ORDER BY e.org_id,e.course_id",
      [userId],
    );
    const out = [];
    for (const row of rows) {
      const orgId = String(row.org_id);
      const courseId = String(row.course_id);
      const access = await this.active(this.driver, orgId, courseId, userId);
      if (!access.enrolled) continue;
      const latest = await this.latest(this.driver, orgId, courseId);
      const consent = await this.myConsents(orgId, userId);
      out.push({
        orgId,
        courseId,
        title: String(row.title),
        consents: { progress: consent.progress, contact: consent.contact },
        batchId: row.batch_id,
        org: { name: row.name, logo: row.logo_url, accent: row.accent_color },
        courseVersion: latest.version,
        etag: etagFor(courseId, latest.version, access.member),
      });
    }
    return out;
  }

  /* ─── Students, enrolment and consent ─────────────────────────────────────── */

  /** Creates the student once and locks the row; the phone is fixed after the first registration. */
  private async student(tx: Driver, actor: Actor, mobile: string, verified: boolean) {
    await tx.query(
      'INSERT INTO institutes.students(user_id,phone,phone_verified_at,name,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO NOTHING',
      [actor.id, mobile, verified ? Date.now() : null, actor.name, Date.now()],
    );
    const [row] = await tx.query('SELECT * FROM institutes.students WHERE user_id=$1 FOR UPDATE', [actor.id]);
    if (row.phone !== mobile) return conflict('Use the phone number already registered for your institute courses.');
    if (verified) await tx.query('UPDATE institutes.students SET phone_verified_at=$2 WHERE user_id=$1', [actor.id, Date.now()]);
    return { ...row, phone_verified_at: verified ? Date.now() : row.phone_verified_at };
  }

  /**
   * The per-student lock. Progress flushes, quiz attempts, withdrawal and leaving all take it first, so a
   * withdrawal can never interleave with a write that would store data it just deleted.
   */
  private async lockStudent(tx: Driver, userId: string) {
    await tx.query('SELECT user_id FROM institutes.students WHERE user_id=$1 FOR UPDATE', [userId]);
  }

  async verifyPhone(actor: Actor, mobile: string) {
    return this.tx(async (tx) => {
      await this.student(tx, actor, mobile, true);
    });
  }

  private async consent(tx: Driver, orgId: string, userId: string, purpose: string) {
    const rows = await tx.query('SELECT id FROM institutes.consents WHERE org_id=$1 AND user_id=$2 AND purpose=$3 AND withdrawn_at IS NULL', [orgId, userId, purpose]);
    return !!rows.length;
  }

  /** Withdrawing progress sharing deletes the identified rows it covered — progress, quiz attempts and Quiz me scores. */
  /** Records both choices. Returns true when "contact me" was newly switched on, so a request can be raised. */
  private async setSharing(tx: Driver, orgId: string, userId: string, sharing: Sharing): Promise<boolean> {
    let contactAdded = false;
    for (const purpose of ['progress', 'contact'] as const) {
      if (sharing[purpose]) {
        const added = await tx.query(
          'INSERT INTO institutes.consents(id,org_id,user_id,text_version,purpose,given_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,user_id,purpose) WHERE withdrawn_at IS NULL DO NOTHING RETURNING id',
          [randomUUID(), orgId, userId, sharing.textVersion, purpose, Date.now()],
        );
        if (purpose === 'contact' && added.length) contactAdded = true;
        continue;
      }
      await tx.query('UPDATE institutes.consents SET withdrawn_at=$4 WHERE org_id=$1 AND user_id=$2 AND purpose=$3 AND withdrawn_at IS NULL', [orgId, userId, purpose, Date.now()]);
      if (purpose === 'progress') {
        await tx.query('DELETE FROM institutes.studio_study_days WHERE org_id=$1 AND user_id=$2',[orgId,userId]);
        await tx.query('DELETE FROM institutes.studio_edits WHERE org_id=$1 AND user_id=$2',[orgId,userId]);
        await tx.query("UPDATE institutes.playbook_sends SET draft='',why='[]',status=CASE WHEN status='open' THEN 'skipped' ELSE status END WHERE org_id=$1 AND user_id=$2",[orgId,userId]);
        await tx.query('DELETE FROM institutes.progress WHERE org_id=$1 AND user_id=$2', [orgId, userId]);
        await tx.query('DELETE FROM institutes.quiz_attempts WHERE org_id=$1 AND user_id=$2', [orgId, userId]);
        await tx.query('DELETE FROM institutes.quizme_scores WHERE org_id=$1 AND user_id=$2', [orgId, userId]);
      }
      if (purpose === 'contact') {
        // Taking back "contact me" closes any open request, so nobody is called on an old yes.
        await tx.query('UPDATE institutes.contact_requests SET handled_at=$3,handled_by=$4 WHERE org_id=$1 AND user_id=$2 AND handled_at IS NULL', [orgId, userId, Date.now(), 'withdrawn']);
      }
    }
    return contactAdded;
  }

  /** A priority request in the institute's inbox: from joining, from switching "contact me" on, or the student's button. */
  private async raiseRequest(tx: Driver, orgId: string, userId: string, courseId: string | null, source: 'join' | 'sharing' | 'button', note: string | null) {
    const [open] = await tx.query('SELECT id FROM institutes.contact_requests WHERE org_id=$1 AND user_id=$2 AND handled_at IS NULL LIMIT 1', [orgId, userId]);
    if (open) {
      // One open request per student: a second press updates it instead of filling the inbox.
      if (note) await tx.query('UPDATE institutes.contact_requests SET note=$2,created_at=$3 WHERE id=$1', [open.id, note, Date.now()]);
      return;
    }
    await tx.query(
      'INSERT INTO institutes.contact_requests(id,org_id,user_id,course_id,source,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), orgId, userId, courseId, source, note, Date.now()],
    );
  }

  /** A join code takes a seat in that batch (under a row lock, so two joins can't take the last one); without one, only free courses. */
  private async claimSeat(tx: Driver, orgId: string, courseId: string, userId: string, joinCode: string): Promise<string> {
    const [batch] = await tx.query(
      "SELECT * FROM institutes.batches WHERE org_id=$1 AND course_id=$2 AND join_code=$3 AND status='active' AND (starts_on IS NULL OR starts_on<=$4) AND (ends_on IS NULL OR ends_on>$4) FOR UPDATE",
      [orgId, courseId, joinCode, Date.now()],
    );
    if (!batch) return missing();
    const batchId = String(batch.id);
    const [existing] = await tx.query('SELECT id FROM institutes.enrollments WHERE org_id=$1 AND batch_id=$2 AND user_id=$3 AND left_at IS NULL', [orgId, batchId, userId]);
    const [used] = await tx.query('SELECT COUNT(*)::int AS n FROM institutes.enrollments WHERE org_id=$1 AND batch_id=$2 AND left_at IS NULL', [orgId, batchId]);
    if (!existing && Number(used.n) >= Number(batch.seats)) return conflict('This batch has no seats left.');
    return batchId;
  }

  async enroll(orgId: string, courseId: string, actor: Actor, input: { phone: string; consents: Sharing; joinCode?: string }) {
    return this.tx(async (tx) => {
      const student = await this.student(tx, actor, input.phone, actor.phone === input.phone);
      // Owner's decision (26 Oct 2026): the institute receives every member's number, so it must be proven.
      if (!student.phone_verified_at) return conflict('Verify your phone number to join. Your institute receives it when you join.');
      const [course] = await tx.query(
        "SELECT c.kind FROM institutes.courses c JOIN institutes.orgs o ON o.id=c.org_id WHERE c.org_id=$1 AND c.id=$2 AND c.status='published' AND o.status<>'paused'",
        [orgId, courseId],
      );
      if (!course) return missing();

      let batchId: string | null = null;
      if (input.joinCode) batchId = await this.claimSeat(tx, orgId, courseId, actor.id, input.joinCode);
      else if (course.kind !== 'free') return denied();

      const [enrollment] = await tx.query(
        "INSERT INTO institutes.enrollments(id,org_id,user_id,course_id,batch_id,joined_at,terms_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,user_id,course_id,(COALESCE(batch_id,''))) DO UPDATE SET left_at=NULL,terms_version=EXCLUDED.terms_version RETURNING *",
        [randomUUID(), orgId, actor.id, courseId, batchId, Date.now(), input.consents.textVersion],
      );
      if (await this.setSharing(tx, orgId, actor.id, input.consents)) await this.raiseRequest(tx, orgId, actor.id, courseId, 'join', null);
      return { id: enrollment.id, orgId, courseId, batchId };
    });
  }

  async myConsents(orgId: string, userId: string) {
    const rows = await this.driver.query('SELECT purpose,text_version,given_at FROM institutes.consents WHERE org_id=$1 AND user_id=$2 AND withdrawn_at IS NULL', [orgId, userId]);
    return { progress: rows.some((r) => r.purpose === 'progress'), contact: rows.some((r) => r.purpose === 'contact'), records: rows };
  }

  async assignments(orgId: string, courseId: string, userId: string) {
    const access = await this.active(this.driver, orgId, courseId, userId);
    if (!access.enrolled) return denied();
    return this.driver.query(
      'SELECT a.id,a.item_ref,a.kind,a.due_on,a.note FROM institutes.assignments a JOIN institutes.enrollments e ON (e.org_id,e.batch_id)=(a.org_id,a.batch_id) WHERE a.org_id=$1 AND e.course_id=$2 AND e.user_id=$3 AND e.left_at IS NULL ORDER BY a.id',
      [orgId, courseId, userId],
    );
  }

  async changeConsent(orgId: string, userId: string, sharing: Sharing) {
    return this.tx(async (tx) => {
      const [student] = await tx.query('SELECT phone_verified_at FROM institutes.students WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!student) return denied();
      const [enrolled] = await tx.query('SELECT id FROM institutes.enrollments WHERE org_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1', [orgId, userId]);
      if (!enrolled) return denied();
      if (sharing.contact && !student.phone_verified_at) return conflict('Verify your phone before asking to be contacted.');
      if (await this.setSharing(tx, orgId, userId, sharing)) await this.raiseRequest(tx, orgId, userId, null, 'sharing', null);
    });
  }

  /** Leaving one course deletes its identified data; leaving the last course in an org also withdraws both choices. */
  async leave(orgId: string, courseId: string, userId: string) {
    return this.tx(async (tx) => {
      await this.lockStudent(tx, userId);
      await tx.query('UPDATE institutes.enrollments SET left_at=$4 WHERE org_id=$1 AND course_id=$2 AND user_id=$3 AND left_at IS NULL', [orgId, courseId, userId, Date.now()]);
      await tx.query('DELETE FROM institutes.progress WHERE org_id=$1 AND course_id=$2 AND user_id=$3', [orgId, courseId, userId]);
      await tx.query('DELETE FROM institutes.studio_study_days WHERE org_id=$1 AND course_id=$2 AND user_id=$3',[orgId,courseId,userId]);
      await tx.query(
        'DELETE FROM institutes.quiz_attempts a USING institutes.quizzes q WHERE a.org_id=$1 AND a.user_id=$3 AND (q.org_id,q.id)=(a.org_id,a.quiz_id) AND q.course_id=$2',
        [orgId, courseId, userId],
      );
      await tx.query('DELETE FROM institutes.quizme_scores WHERE org_id=$1 AND course_id=$2 AND user_id=$3', [orgId, courseId, userId]);
      await tx.query('DELETE FROM institutes.studio_edits WHERE org_id=$1 AND user_id=$2',[orgId,userId]);
      await tx.query("UPDATE institutes.playbook_sends SET draft='',why='[]',status=CASE WHEN status='open' THEN 'skipped' ELSE status END WHERE org_id=$1 AND user_id=$2",[orgId,userId]);
      const [other] = await tx.query('SELECT id FROM institutes.enrollments WHERE org_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1', [orgId, userId]);
      if (!other) await this.setSharing(tx, orgId, userId, { textVersion: 'leave', progress: false, contact: false });
    });
  }

  /* ─── Progress and pseudonymous totals ────────────────────────────────────── */

  private hmac(parts: string[]) {
    return createHmac('sha256', this.receiptSecret).update(JSON.stringify(parts)).digest('hex');
  }

  private courseReceipt(orgId: string, courseId: string, userId: string) {
    return this.hmac(['course', orgId, courseId, userId]);
  }

  private receipt(event: Pick<ProgressEvent, 'orgId' | 'courseId' | 'videoId' | 'userId'>) {
    return this.hmac([event.orgId, event.courseId, event.videoId, event.userId]);
  }

  /** Whether this learner has completed `videoId` — read from the private receipt, so it works without progress sharing. */
  private async completed(tx: Driver, orgId: string, courseId: string, videoId: string, userId: string): Promise<boolean> {
    const [receipt] = await tx.query(
      'SELECT rank FROM institutes.total_receipts WHERE org_id=$1 AND course_id=$2 AND video_id=$3 AND receipt=$4',
      [orgId, courseId, videoId, this.receipt({ orgId, courseId, videoId, userId })],
    );
    return Number(receipt?.rank) === 3;
  }

  /** Raises the private per-video receipt and, only for a stage not counted before, the day's totals. */
  private async countTotals(tx: Driver, event: ProgressEvent, rank: number) {
    const { orgId, courseId, videoId } = event;
    const receipt = this.receipt(event);
    await tx.query('INSERT INTO institutes.total_receipts(org_id,course_id,video_id,receipt,rank) VALUES($1,$2,$3,$4,0) ON CONFLICT DO NOTHING', [orgId, courseId, videoId, receipt]);
    const [previous] = await tx.query('SELECT rank FROM institutes.total_receipts WHERE org_id=$1 AND course_id=$2 AND video_id=$3 AND receipt=$4 FOR UPDATE', [orgId, courseId, videoId, receipt]);
    const before = Number(previous.rank);
    if (rank <= before) return;
    await tx.query('UPDATE institutes.total_receipts SET rank=$5 WHERE org_id=$1 AND course_id=$2 AND video_id=$3 AND receipt=$4', [orgId, courseId, videoId, receipt, rank]);
    const [started, half, done] = milestoneDeltas(before, rank);
    await tx.query(
      'INSERT INTO institutes.course_stats(org_id,course_id,video_id,day,started,half,done) VALUES($1,$2,$3,$4::date,$5,$6,$7) ON CONFLICT(org_id,course_id,video_id,day) DO UPDATE SET started=institutes.course_stats.started+EXCLUDED.started, half=institutes.course_stats.half+EXCLUDED.half, done=institutes.course_stats.done+EXCLUDED.done',
      [orgId, courseId, videoId, new Date().toISOString().slice(0, 10), started, half, done],
    );
  }

  private async recordOne(tx: Driver, event: ProgressEvent) {
    const { orgId, userId, courseId, videoId, seconds, stage } = event;
    await this.lockStudent(tx, userId);
    const access = await this.active(tx, orgId, courseId, userId);
    if (!access.enrolled) return denied();
    await this.requireCourseVideo(tx, orgId, courseId, videoId, access.member);

    const rank = STAGE_RANK[stage];
    await this.countTotals(tx, event, rank);
    await tx.query(
      'INSERT INTO institutes.funnel_receipts(org_id,course_id,receipt,rank) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,course_id,receipt) DO UPDATE SET rank=GREATEST(institutes.funnel_receipts.rank,EXCLUDED.rank)',
      [orgId, courseId, this.courseReceipt(orgId, courseId, userId), rank],
    );

    if (!(await this.consent(tx, orgId, userId, 'progress'))) return;
    await tx.query('INSERT INTO institutes.studio_study_days VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[orgId,userId,courseId,Math.floor(Date.now()/86400000)]);
    // Max rank and seconds are monotonic, including late/out-of-order events.
    const [prior] = await tx.query('SELECT stage FROM institutes.progress WHERE org_id=$1 AND user_id=$2 AND course_id=$3 AND video_id=$4', [orgId, userId, courseId, videoId]);
    const chosen = prior && STAGE_RANK[prior.stage as Milestone] > rank ? prior.stage : stage;
    await tx.query(
      'INSERT INTO institutes.progress(org_id,user_id,course_id,video_id,stage,seconds,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,user_id,course_id,video_id) DO UPDATE SET stage=EXCLUDED.stage,seconds=GREATEST(institutes.progress.seconds,EXCLUDED.seconds),updated_at=EXCLUDED.updated_at',
      [orgId, userId, courseId, videoId, chosen, seconds, Date.now()],
    );
  }

  /** One transaction per batch. Events are taken in user order so concurrent batches lock students in the same order. */
  async recordProgress(events: ProgressEvent[]) {
    return this.tx(async (tx) => {
      const ordered = [...events].sort((a, b) => a.userId.localeCompare(b.userId));
      for (const event of ordered) await this.recordOne(tx, event);
    });
  }

  /** A self-reported "Quiz me" score. Stored only while progress sharing is on; otherwise acknowledged and dropped. */
  async quizMeScore(orgId: string, courseId: string, userId: string, videoId: string, score: number, total: number) {
    return this.tx(async (tx) => {
      await this.lockStudent(tx, userId);
      const access = await this.active(tx, orgId, courseId, userId);
      if (!access.enrolled) return denied();
      if (!(await this.consent(tx, orgId, userId, 'progress'))) return { stored: false };
      await this.requireCourseVideo(tx, orgId, courseId, videoId, access.member);
      await tx.query(
        'INSERT INTO institutes.quizme_scores(org_id,course_id,user_id,video_id,score,total,at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,course_id,user_id,video_id) DO UPDATE SET score=EXCLUDED.score,total=EXCLUDED.total,at=EXCLUDED.at',
        [orgId, courseId, userId, videoId, score, total, Date.now()],
      );
      return { stored: true };
    });
  }

  /* ─── Institute quizzes and assignments ───────────────────────────────────── */

  async createQuiz(orgId: string, courseId: string, actor: string, videoId: string, questions: QuizQuestion[]) {
    return this.tx(async (tx) => {
      const course = await this.latest(tx, orgId, courseId);
      if (!videoIds(course.data, true).includes(videoId)) return missing();
      const [quiz] = await tx.query(
        "INSERT INTO institutes.quizzes(id,org_id,course_id,video_id,questions_json,status,created_by) VALUES($1,$2,$3,$4,$5::jsonb,'draft',$6) RETURNING id",
        [randomUUID(), orgId, courseId, videoId, JSON.stringify(questions), actor],
      );
      await this.audit(tx, orgId, actor, 'quiz.create', String(quiz.id));
      return quiz;
    });
  }

  async publishQuiz(orgId: string, quizId: string, actor: string) {
    return this.tx(async (tx) => {
      const rows = await tx.query("UPDATE institutes.quizzes SET status='published' WHERE org_id=$1 AND id=$2 RETURNING id", [orgId, quizId]);
      if (!rows.length) return missing();
      await this.audit(tx, orgId, actor, 'quiz.publish', quizId);
    });
  }

  /** The questions and options only — answer indices never leave the server. */
  async quiz(orgId: string, quizId: string, userId: string) {
    const [quiz] = await this.driver.query("SELECT course_id,video_id,questions_json FROM institutes.quizzes WHERE org_id=$1 AND id=$2 AND status='published'", [orgId, quizId]);
    if (!quiz) return missing();
    const courseId = String(quiz.course_id);
    const videoId = String(quiz.video_id);
    const access = await this.active(this.driver, orgId, courseId, userId);
    if (!access.enrolled) return denied();
    await this.requireCourseVideo(this.driver, orgId, courseId, videoId, access.member);
    if (!(await this.completed(this.driver, orgId, courseId, videoId, userId))) return conflict('Finish the video before opening this institute quiz.');
    const questions = (quiz.questions_json as QuizQuestion[]).map(({ question, options }) => ({ question, options }));
    return { courseId, questions };
  }

  async attemptQuiz(orgId: string, quizId: string, userId: string, answers: number[]) {
    return this.tx(async (tx) => {
      await this.lockStudent(tx, userId);
      // Recheck membership/completion while holding the same student lock as withdrawal/leave.
      const [quiz] = await tx.query("SELECT course_id,video_id,questions_json FROM institutes.quizzes WHERE org_id=$1 AND id=$2 AND status='published'", [orgId, quizId]);
      if (!quiz) return missing();
      const courseId = String(quiz.course_id);
      const videoId = String(quiz.video_id);
      const questions = quiz.questions_json as QuizQuestion[];
      const access = await this.active(tx, orgId, courseId, userId);
      if (!access.enrolled) return denied();
      await this.requireCourseVideo(tx, orgId, courseId, videoId, access.member);
      if (!(await this.completed(tx, orgId, courseId, videoId, userId))) return conflict('Finish the video first.');

      const malformed = (answer: number, i: number) => !Number.isInteger(answer) || answer < 0 || answer >= questions[i].options.length;
      if (answers.length !== questions.length || answers.some(malformed)) throw new ApiError(400, 'invalid_request', 'Answer each question once.');

      const score = questions.filter((q, i) => q.answer === answers[i]).length;
      const total = questions.length;
      if (score / total >= QUIZ_PASS_RATIO) {
        await tx.query('UPDATE institutes.funnel_receipts SET passed_quiz=true WHERE org_id=$1 AND course_id=$2 AND receipt=$3', [orgId, courseId, this.courseReceipt(orgId, courseId, userId)]);
      }
      if (await this.consent(tx, orgId, userId, 'progress')) {
        await tx.query(
          'INSERT INTO institutes.quiz_attempts(org_id,user_id,quiz_id,score,total,attempted_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,user_id,quiz_id) DO UPDATE SET score=EXCLUDED.score,total=EXCLUDED.total,attempted_at=EXCLUDED.attempted_at',
          [orgId, userId, quizId, score, total, Date.now()],
        );
      }
      return { score, total };
    });
  }

  async assignment(orgId: string, batchId: string, actor: string, input: { itemRef: string; kind: 'today' | 'homework'; dueOn?: number; note?: string }) {
    return this.tx(async (tx) => {
      const [batch] = await tx.query('SELECT course_id FROM institutes.batches WHERE org_id=$1 AND id=$2', [orgId, batchId]);
      if (!batch) return missing();
      const course = await this.latest(tx, orgId, String(batch.course_id));
      const refs = allItems(course.data).map((item) => item.videoId ?? item.playlistId);
      if (!refs.includes(input.itemRef)) return conflict('Choose an item in this batch’s course.');
      const [row] = await tx.query(
        'INSERT INTO institutes.assignments(id,org_id,batch_id,item_ref,kind,due_on,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [randomUUID(), orgId, batchId, input.itemRef, input.kind, input.dueOn ?? null, input.note ?? null, actor],
      );
      await this.audit(tx, orgId, actor, 'assignment.create', String(row.id));
      return row;
    });
  }

  /* ─── Studio reads ─────────────────────────────────────────────────────────── */

  async studioContext(orgId:string){const [row]=await this.driver.query('SELECT version,data FROM institutes.studio_context WHERE org_id=$1 ORDER BY version DESC LIMIT 1',[orgId]);return {version:Number(row?.version??0),data:(row?.data??structuredClone(EMPTY_CONTEXT)) as StudioContext};}
  async saveStudioContext(orgId:string,actor:string,data:StudioContext,expectedVersion:number){return this.tx(async tx=>{
    await tx.query('SELECT id FROM institutes.orgs WHERE id=$1 FOR UPDATE',[orgId]);
    const [last]=await tx.query('SELECT COALESCE(MAX(version),0)::int AS version FROM institutes.studio_context WHERE org_id=$1',[orgId]);
    if(Number(last.version)!==expectedVersion)return conflict('Context changed. Reload before saving your edits.');
    const version=expectedVersion+1;await tx.query('INSERT INTO institutes.studio_context VALUES($1,$2,$3::jsonb,$4,$5)',[orgId,version,JSON.stringify(data),actor,Date.now()]);await this.audit(tx,orgId,actor,'studio.context',String(version));return {version,data};
  });}
  async studioEdits(orgId:string){return this.driver.query('SELECT e.id,e.before_text,e.after_text,s.name FROM institutes.studio_edits e JOIN institutes.students s ON s.user_id=e.user_id WHERE e.org_id=$1 ORDER BY e.created_at DESC LIMIT 30',[orgId]);}


  async studioQuestionIdentities(orgId:string,question:string){return this.driver.query("SELECT s.user_id,s.name,s.phone FROM institutes.students s WHERE EXISTS(SELECT 1 FROM institutes.enrollments e WHERE e.org_id=$1 AND e.user_id=s.user_id AND e.left_at IS NULL) AND (POSITION(LOWER(s.name) IN LOWER($2))>0 OR POSITION(LOWER(SPLIT_PART(s.name,' ',1)) IN LOWER($2))>0 OR POSITION(s.phone IN $2)>0) ORDER BY s.user_id LIMIT 50",[orgId,question]);}
  async studioStudents(orgId:string,rules:StudentRules & {after?:string;onlyUserId?:string;playbookId?:string;search?:string}){return this.students(orgId,{...rules,minQuizScore:rules.minQuiz,limit:rules.limit??100});}
  async studioThreads(orgId:string){return this.driver.query('SELECT id,title,pinned,updated_at FROM institutes.studio_threads WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 50',[orgId]);}
  async studioThread(orgId:string,id:string){const [thread]=await this.driver.query('SELECT * FROM institutes.studio_threads WHERE org_id=$1 AND id=$2',[orgId,id]);if(!thread)return missing();const messages=await this.driver.query('SELECT question,plan,created_at FROM institutes.studio_messages WHERE org_id=$1 AND thread_id=$2 ORDER BY created_at LIMIT 100',[orgId,id]);return {thread,messages};}
  async saveStudioQuestion(orgId:string,actor:string,question:string,plan:unknown,threadId?:string){return this.tx(async tx=>{const id=threadId??randomUUID(),at=Date.now();if(threadId){const [row]=await tx.query('SELECT id FROM institutes.studio_threads WHERE org_id=$1 AND id=$2',[orgId,id]);if(!row)return missing();}else await tx.query('INSERT INTO institutes.studio_threads(id,org_id,title,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',[id,orgId,question.slice(0,120),at]);await tx.query('INSERT INTO institutes.studio_messages VALUES($1,$2,$3,$4,$5::jsonb,$6)',[randomUUID(),orgId,id,question,JSON.stringify(plan),at]);await tx.query('UPDATE institutes.studio_threads SET updated_at=$3 WHERE org_id=$1 AND id=$2',[orgId,id,at]);await this.audit(tx,orgId,actor,'studio.ask',id);return id;});}
  async pinStudioThread(orgId:string,id:string,pinned:boolean,actor='staff'){const rows=await this.driver.query('UPDATE institutes.studio_threads SET pinned=$3 WHERE org_id=$1 AND id=$2 RETURNING id',[orgId,id,pinned]);if(!rows.length)return missing();await this.audit(this.driver,orgId,actor,'studio.pin',id);}
  async studioLists(orgId:string){return this.driver.query('SELECT id,name,rules FROM institutes.studio_lists WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100',[orgId]);}
  async saveStudioList(orgId:string,actor:string,name:string,rules:StudentRules){return this.tx(async tx=>{const id=randomUUID();await tx.query('INSERT INTO institutes.studio_lists VALUES($1,$2,$3,$4::jsonb,$5)',[id,orgId,name,JSON.stringify(rules),Date.now()]);await this.audit(tx,orgId,actor,'studio.list',id);return {id};});}
  async playbooks(orgId:string){return this.driver.query('SELECT * FROM institutes.playbooks WHERE org_id=$1 ORDER BY created_at,id',[orgId]);}
  async savePlaybook(orgId:string,actor:string,input:PlaybookInput,id?:string){return this.tx(async tx=>{const key=id??randomUUID();if(id){const rows=await tx.query('UPDATE institutes.playbooks SET name=$3,rules=$4::jsonb,template=$5,channel=$6,personalize=$7,reviewed_at=$8 WHERE org_id=$1 AND id=$2 RETURNING id',[orgId,id,input.name,JSON.stringify(input.rules),input.template,input.channel,input.personalize,Date.now()]);if(!rows.length)return missing();await tx.query("UPDATE institutes.playbook_sends SET status='skipped',draft='',why='[]' WHERE org_id=$1 AND playbook_id=$2 AND status='open'",[orgId,id]);}else await tx.query('INSERT INTO institutes.playbooks VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$8)',[key,orgId,input.name,JSON.stringify(input.rules),input.template,input.channel,input.personalize,Date.now()]);await this.audit(tx,orgId,actor,'studio.playbook',key);return {id:key};});}
  async playbookMatches(orgId:string,id:string,options:{after?:string;userId?:string}={}){const [p]=await this.driver.query('SELECT * FROM institutes.playbooks WHERE org_id=$1 AND id=$2',[orgId,id]);if(!p)return missing();const result=await this.studioStudents(orgId,{...p.rules as StudentRules,after:options.after,onlyUserId:options.userId,playbookId:id});return {playbook:p,...result};}
  async claimPlaybook(orgId:string,id:string,userId:string,actor='queue'){const matches=await this.playbookMatches(orgId,id,{userId});if(!matches.items.some(row=>row.user_id===userId))return denied();return this.tx(async tx=>{await this.lockStudent(tx,userId);if(Object.keys(matches.playbook.rules as object).some(k=>['minLessons','minQuiz','maxQuiz','quietDays','returnedDays'].includes(k))&&!await this.consent(tx,orgId,userId,'progress'))return denied();await tx.query("INSERT INTO institutes.playbook_sends(id,org_id,playbook_id,user_id,status,created_at) VALUES($1,$2,$3,$4,'open',$5) ON CONFLICT DO NOTHING",[randomUUID(),orgId,id,userId,Date.now()]);const [row]=await tx.query("SELECT * FROM institutes.playbook_sends WHERE org_id=$1 AND playbook_id=$2 AND user_id=$3 AND status='open'",[orgId,id,userId]);if(!row)return conflict('This student is already waiting in another playbook.');await this.audit(tx,orgId,actor,'studio.queue',String(row.id));return row;});}
  async savePlaybookDraft(orgId:string,id:string,actor:string,draft:string,why:unknown){const rows=await this.driver.query("UPDATE institutes.playbook_sends SET draft=$3,why=$4::jsonb WHERE org_id=$1 AND id=$2 AND status='open' RETURNING id",[orgId,id,draft,JSON.stringify(why)]);if(!rows.length)return conflict('This draft is no longer open.');await this.audit(this.driver,orgId,actor,'studio.draft',id);}
  async finishPlaybookSend(orgId:string,id:string,actor:string,state:'sent'|'skipped',draft:string){const [send]=await this.driver.query("SELECT * FROM institutes.playbook_sends WHERE org_id=$1 AND id=$2 AND status='open'",[orgId,id]);if(!send)return missing();const matches=await this.playbookMatches(orgId,String(send.playbook_id),{userId:String(send.user_id)});if(!matches.items.some(row=>row.user_id===send.user_id))return denied();return this.tx(async tx=>{await this.lockStudent(tx,String(send.user_id));const progressRules=Object.keys(matches.playbook.rules as object).some(k=>['minLessons','minQuiz','maxQuiz','quietDays','returnedDays'].includes(k));if(progressRules&&!await this.consent(tx,orgId,String(send.user_id),'progress'))return denied();const rows=await tx.query("UPDATE institutes.playbook_sends SET status=$3,draft=$4,sent_at=$5 WHERE org_id=$1 AND id=$2 AND status='open' RETURNING id",[orgId,id,state,draft,state==='sent'?Date.now():null]);if(!rows.length)return conflict('This message was already reviewed.');if(state==='sent'&&matches.playbook.personalize&&draft!==send.draft)await tx.query('INSERT INTO institutes.studio_edits VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),orgId,send.user_id,send.draft,draft,actor,Date.now()]);await this.audit(tx,orgId,actor,'studio.'+state,id);return {id};});}
  async recordOutcome(orgId:string,actor:string,input:{userId:string;kind:Outcome;course?:string;fee?:number;playbookId?:string}){await this.studentReport(orgId,input.userId,actor);return this.tx(async tx=>{if(input.playbookId){const [sent]=await tx.query("SELECT id FROM institutes.playbook_sends WHERE org_id=$1 AND playbook_id=$2 AND user_id=$3 AND status='sent' LIMIT 1",[orgId,input.playbookId,input.userId]);if(!sent)return denied();}const id=randomUUID();await tx.query('INSERT INTO institutes.studio_outcomes VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,orgId,input.userId,input.playbookId??null,input.kind,input.kind==='enrolled'?input.course:null,input.kind==='enrolled'?input.fee:0,actor,Date.now()]);await this.audit(tx,orgId,actor,'studio.outcome',id);return {id};});}
  async studioResults(orgId:string,from:number,to:number,playbookId?:string){const rows=await this.driver.query(`SELECT o.id,o.user_id,CASE WHEN EXISTS(SELECT 1 FROM institutes.enrollments e WHERE e.org_id=o.org_id AND e.user_id=o.user_id AND e.left_at IS NULL) THEN s.name ELSE 'Former student' END AS name,o.playbook_id,p.name AS playbook,o.kind,o.course,o.fee,o.created_at FROM institutes.studio_outcomes o JOIN institutes.students s ON s.user_id=o.user_id LEFT JOIN institutes.playbooks p ON (p.org_id,p.id)=(o.org_id,o.playbook_id) WHERE o.org_id=$1 AND o.created_at>=$2 AND o.created_at<$3 AND ($4::text IS NULL OR o.playbook_id=$4) ORDER BY o.created_at DESC`,[orgId,from,to,playbookId??null]);const sends=await this.driver.query("SELECT playbook_id,COUNT(*)::int AS matched,COUNT(*) FILTER(WHERE status='sent')::int AS contacted FROM institutes.playbook_sends WHERE org_id=$1 AND created_at>=$2 AND created_at<$3 AND ($4::text IS NULL OR playbook_id=$4) GROUP BY playbook_id",[orgId,from,to,playbookId??null]);const bestMessages=await this.driver.query(`SELECT * FROM (SELECT ps.playbook_id,ps.draft,COUNT(DISTINCT o.user_id)::int AS enrolled,SUM(o.fee)::bigint AS fees,ROW_NUMBER() OVER(PARTITION BY ps.playbook_id ORDER BY COUNT(DISTINCT o.user_id) DESC,SUM(o.fee) DESC,ps.draft) AS rank FROM institutes.playbook_sends ps JOIN institutes.studio_outcomes o ON (o.org_id,o.playbook_id,o.user_id)=(ps.org_id,ps.playbook_id,ps.user_id) WHERE ps.org_id=$1 AND ps.status='sent' AND ps.draft<>'' AND o.kind='enrolled' AND o.created_at>=$2 AND o.created_at<$3 AND ($4::text IS NULL OR ps.playbook_id=$4) GROUP BY ps.playbook_id,ps.draft) ranked WHERE rank=1`,[orgId,from,to,playbookId??null]);return {rows,sends,bestMessages,enrolled:rows.filter(r=>r.kind==='enrolled').length,fees:rows.filter(r=>r.kind==='enrolled').reduce((sum,r)=>sum+Number(r.fee),0)};}

  async setupChecklist(orgId: string) {
    const [state] = await this.driver.query(`SELECT
      EXISTS(SELECT 1 FROM institutes.courses c JOIN institutes.import_cache i ON (i.org_id,i.course_id)=(c.org_id,c.id) WHERE c.org_id=$1 AND c.status='published' AND i.payload_json IS NOT NULL) AS course,
      EXISTS(SELECT 1 FROM institutes.enrollments WHERE org_id=$1 AND batch_id IS NOT NULL AND left_at IS NULL) AS batch,
      EXISTS(SELECT 1 FROM institutes.quizzes WHERE org_id=$1 AND status='published') AS quiz,
      EXISTS(SELECT 1 FROM institutes.assignments WHERE org_id=$1 AND kind='today') AS today,
      EXISTS(SELECT 1 FROM institutes.org_members WHERE org_id=$1 AND role='faculty') AS faculty`, [orgId]);
    const context=await this.studioContext(orgId);
    const [review]=await this.driver.query('SELECT COUNT(*)::int AS n FROM institutes.playbooks WHERE org_id=$1 AND reviewed_at IS NOT NULL',[orgId]);
    const items = [
      {id:'course',label:'Publish your first imported course',done:!!state.course,href:'/admin'},
      {id:'batch',label:'Share a batch code and welcome its first student',done:!!state.batch,href:'/admin'},
      {id:'quiz',label:'Publish an institute quiz',done:!!state.quiz,href:'/admin'},
      {id:'today',label:'Choose today’s class',done:!!state.today,href:'/admin'},
      {id:'context',label:'Tell the assistant about your institute',done:!!context.data.about&&context.data.examples.filter(e=>e.trim()).length>=3&&context.data.products.some(p=>p.name.trim()),href:'#/context'},
      {id:'faculty',label:'Give a faculty member access',done:!!state.faculty,href:'/admin'},
      {id:'playbook',label:'Review your first playbook',done:Number(review.n)>0,href:'#/playbooks'},
    ];
    return {items,completed:items.filter(item=>item.done).length,total:items.length};
  }

  async funnel(orgId: string, courseId?: string) {
    const [totals] = await this.driver.query(`SELECT
      (SELECT COUNT(DISTINCT (user_id,course_id))::int FROM institutes.enrollments WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2)) AS joined,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND rank>=1) AS started,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND rank>=2) AS half,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND rank>=3) AS done,
      (SELECT COUNT(*)::int FROM institutes.funnel_receipts WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND passed_quiz) AS passed_quiz,
      (SELECT COUNT(DISTINCT (c.user_id,e.course_id))::int FROM institutes.consents c JOIN institutes.enrollments e ON e.org_id=c.org_id AND e.user_id=c.user_id WHERE c.org_id=$1 AND c.purpose='progress' AND c.withdrawn_at IS NULL AND e.left_at IS NULL AND ($2::text IS NULL OR e.course_id=$2)) AS shared_progress,
      (SELECT COUNT(DISTINCT (c.user_id,e.course_id))::int FROM institutes.consents c JOIN institutes.students s ON s.user_id=c.user_id JOIN institutes.enrollments e ON e.org_id=c.org_id AND e.user_id=c.user_id WHERE c.org_id=$1 AND c.purpose='contact' AND c.withdrawn_at IS NULL AND s.phone_verified_at IS NOT NULL AND e.left_at IS NULL AND ($2::text IS NULL OR e.course_id=$2)) AS shared_contact`, [orgId, courseId ?? null]);
    const videos = await this.driver.query(
      'SELECT course_id,video_id,SUM(started)::int AS started,SUM(half)::int AS half,SUM(done)::int AS done FROM institutes.course_stats WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) GROUP BY course_id,video_id ORDER BY course_id,video_id',
      [orgId, courseId ?? null],
    );
    return { ...totals, videos: videos.map(withDropOff), note: FUNNEL_NOTE };
  }

  /**
   * Everyone enrolled with this institute. Name and verified number for every member (they agreed to that
   * when joining); progress, quiz, watch time and activity only for students who share progress.
   */
  async students(orgId: string, filter: PageFilter & StudentRules & {onlyUserId?:string;playbookId?:string;search?:string}) {
    const rows = await this.driver.query(`WITH members AS (
      SELECT s.user_id,s.name,s.phone,MIN(e.joined_at)::bigint AS joined_at,COUNT(*)::int AS courses
      FROM institutes.students s JOIN institutes.enrollments e ON e.user_id=s.user_id
      WHERE e.org_id=$1 AND e.left_at IS NULL AND ($2::text IS NULL OR e.course_id=$2) AND ($3::text IS NULL OR s.user_id>$3) AND ($18::text IS NULL OR s.user_id=$18) AND ($20::text IS NULL OR POSITION(LOWER($20) IN LOWER(COALESCE(s.name,'')))>0 OR POSITION($20 IN s.phone)>0)
      GROUP BY s.user_id,s.name,s.phone
    ), flagged AS (
      SELECT m.*,
        EXISTS(SELECT 1 FROM institutes.consents c WHERE c.org_id=$1 AND c.user_id=m.user_id AND c.purpose='progress' AND c.withdrawn_at IS NULL) AS sharing_progress,
        EXISTS(SELECT 1 FROM institutes.consents c WHERE c.org_id=$1 AND c.user_id=m.user_id AND c.purpose='contact' AND c.withdrawn_at IS NULL) AS wants_contact,
        EXISTS(SELECT 1 FROM institutes.contact_requests r WHERE r.org_id=$1 AND r.user_id=m.user_id AND r.handled_at IS NULL) AS open_request
      FROM members m
    ), measured AS (
      SELECT f.*,
        CASE WHEN sharing_progress THEN (SELECT COUNT(*)::int FROM institutes.progress p WHERE p.org_id=$1 AND p.user_id=f.user_id AND p.stage='done' AND ($2::text IS NULL OR p.course_id=$2) AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.courses fc WHERE fc.org_id=$1 AND fc.id=p.course_id AND fc.kind='free'))) END AS completed_videos,
        CASE WHEN sharing_progress THEN (SELECT COALESCE(SUM(p.seconds),0)::int FROM institutes.progress p WHERE p.org_id=$1 AND p.user_id=f.user_id AND ($2::text IS NULL OR p.course_id=$2) AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.courses fc WHERE fc.org_id=$1 AND fc.id=p.course_id AND fc.kind='free'))) END AS watch_seconds,
        CASE WHEN sharing_progress THEN (SELECT MAX(p.updated_at)::bigint FROM institutes.progress p WHERE p.org_id=$1 AND p.user_id=f.user_id AND ($2::text IS NULL OR p.course_id=$2) AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.courses fc WHERE fc.org_id=$1 AND fc.id=p.course_id AND fc.kind='free'))) END AS last_active,
        CASE WHEN sharing_progress THEN (SELECT COUNT(DISTINCT p.updated_at/86400000)::int FROM institutes.progress p WHERE p.org_id=$1 AND p.user_id=f.user_id AND ($2::text IS NULL OR p.course_id=$2) AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.courses fc WHERE fc.org_id=$1 AND fc.id=p.course_id AND fc.kind='free'))) END AS active_days,
        CASE WHEN sharing_progress THEN (SELECT ROUND(AVG(s.score*100.0/s.total))::int FROM (SELECT a.score,a.total FROM institutes.quiz_attempts a JOIN institutes.quizzes q ON (q.org_id,q.id)=(a.org_id,a.quiz_id) WHERE a.org_id=$1 AND a.user_id=f.user_id AND ($2::text IS NULL OR q.course_id=$2) AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.courses fc WHERE fc.org_id=$1 AND fc.id=q.course_id AND fc.kind='free')) UNION ALL SELECT z.score,z.total FROM institutes.quizme_scores z WHERE z.org_id=$1 AND z.user_id=f.user_id AND ($2::text IS NULL OR z.course_id=$2) AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.courses fc WHERE fc.org_id=$1 AND fc.id=z.course_id AND fc.kind='free'))) s) END AS quiz_score
      FROM flagged f
    ), completed AS (
      SELECT m.*,CASE WHEN sharing_progress THEN LEAST(100,COALESCE(ROUND(completed_videos*100.0/NULLIF((SELECT SUM(c.video_count) FROM institutes.courses c WHERE c.org_id=$1 AND (NOT $15::boolean OR c.kind='free') AND ($2::text IS NULL OR c.id=$2) AND EXISTS(SELECT 1 FROM institutes.enrollments e WHERE e.org_id=$1 AND e.course_id=c.id AND e.user_id=m.user_id AND e.left_at IS NULL)),0)),0))::int END AS completion_percent
      FROM measured m
    )
    SELECT * FROM completed WHERE ($4::int IS NULL OR completion_percent>=$4) AND ($5::int IS NULL OR quiz_score>=$5) AND (NOT $6::boolean OR wants_contact)
      AND ($8::int IS NULL OR (sharing_progress AND completed_videos>=$8))
      AND ($9::int IS NULL OR (sharing_progress AND quiz_score<=$9))
      AND ($10::bigint IS NULL OR (sharing_progress AND last_active<=$10))
      AND ($11::bigint IS NULL OR joined_at>=$11)
      AND ($12::boolean IS NULL OR sharing_progress=$12)
      AND ($13::boolean IS NULL OR wants_contact=$13)
      AND ($14::bigint IS NULL OR (NOT EXISTS(SELECT 1 FROM institutes.playbook_sends ps WHERE ps.org_id=$1 AND ps.user_id=completed.user_id AND ps.status='sent' AND ps.sent_at>=$14) AND NOT EXISTS(SELECT 1 FROM institutes.studio_outcomes so WHERE so.org_id=$1 AND so.user_id=completed.user_id AND so.created_at>=$14)))
      AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.enrollments e JOIN institutes.courses c ON (c.org_id,c.id)=(e.org_id,e.course_id) WHERE e.org_id=$1 AND e.user_id=completed.user_id AND e.left_at IS NULL AND c.kind='free' AND ($2::text IS NULL OR c.id=$2)))
      AND ($16::int IS NULL OR (sharing_progress AND EXISTS(SELECT 1 FROM (SELECT day,day-LAG(day) OVER(ORDER BY day) AS gap FROM (SELECT DISTINCT day FROM institutes.studio_study_days sd WHERE org_id=$1 AND user_id=completed.user_id AND ($2::text IS NULL OR course_id=$2) AND (NOT $15::boolean OR EXISTS(SELECT 1 FROM institutes.courses fc WHERE fc.org_id=$1 AND fc.id=sd.course_id AND fc.kind='free'))) d) g WHERE g.day>=$17 AND g.gap>=$16)))
      AND ($19::text IS NULL OR NOT EXISTS(SELECT 1 FROM institutes.playbook_sends ps WHERE ps.org_id=$1 AND ps.user_id=completed.user_id AND ((ps.status='open' AND ps.playbook_id<>$19) OR (ps.playbook_id=$19 AND ps.status IN ('sent','skipped')))))
      ORDER BY user_id LIMIT $7`,
      [orgId, filter.courseId ?? null, filter.after ?? null, filter.minCompletion ?? null, filter.minQuizScore ?? null, !!filter.priority, filter.limit + 1,
       filter.minLessons??null,filter.maxQuiz??null,filter.quietDays===undefined?null:Date.now()-filter.quietDays*86400000,
       filter.joinedWithinDays===undefined?null:Date.now()-filter.joinedWithinDays*86400000,filter.sharing??null,filter.wantsContact??null,
       filter.notContactedDays===undefined?null:Date.now()-filter.notContactedDays*86400000,!!filter.freeOnly,filter.returnedDays??null,Math.floor(Date.now()/86400000)-7,filter.onlyUserId??null,filter.playbookId??null,filter.search??null]);
    // One extra row is fetched only to know whether there is a next page.
    const items = rows.slice(0, filter.limit);
    return { items, next: rows.length > filter.limit ? String(items.at(-1)!.user_id) : null };
  }

  /**
   * One student's report for the institute: who they are and what they asked for, and, only while they
   * share progress, every lecture's stage and watch time and every quiz score with its time. Logged.
   */
  async studentReport(orgId: string, userId: string, actor: string) {
    return this.tx(async (tx) => {
      const courses = await tx.query(
        'SELECT e.course_id,c.title,e.batch_id,e.joined_at::bigint AS joined_at FROM institutes.enrollments e JOIN institutes.courses c ON (c.org_id,c.id)=(e.org_id,e.course_id) WHERE e.org_id=$1 AND e.user_id=$2 AND e.left_at IS NULL ORDER BY e.joined_at',
        [orgId, userId],
      );
      if (!courses.length) return missing();
      const [student] = await tx.query('SELECT user_id,name,phone FROM institutes.students WHERE user_id=$1', [userId]);
      const sharing = await this.consent(tx, orgId, userId, 'progress');
      const wantsContact = await this.consent(tx, orgId, userId, 'contact');
      const requests = await tx.query('SELECT id,course_id,source,note,created_at::bigint AS created_at,handled_at::bigint AS handled_at FROM institutes.contact_requests WHERE org_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 20', [orgId, userId]);
      let lectures: Row[] = [];
      let quizzes: Row[] = [];
      if (sharing) {
        lectures = await tx.query('SELECT course_id,video_id,stage,seconds,updated_at::bigint AS updated_at FROM institutes.progress WHERE org_id=$1 AND user_id=$2 ORDER BY updated_at', [orgId, userId]);
        quizzes = await tx.query(
          `SELECT q.course_id,q.video_id,a.score,a.total,a.attempted_at::bigint AS at,'institute' AS kind FROM institutes.quiz_attempts a JOIN institutes.quizzes q ON (q.org_id,q.id)=(a.org_id,a.quiz_id) WHERE a.org_id=$1 AND a.user_id=$2
           UNION ALL SELECT z.course_id,z.video_id,z.score,z.total,z.at::bigint AS at,'quizme' AS kind FROM institutes.quizme_scores z WHERE z.org_id=$1 AND z.user_id=$2 ORDER BY at`,
          [orgId, userId],
        );
      }
      await this.audit(tx, orgId, actor, 'student.view', userId);
      return { student: { ...student, sharing_progress: sharing, wants_contact: wantsContact }, courses, requests, lectures, quizzes };
    });
  }

  /** Lecture plays and completions per day for the last eight weeks, from the anonymous daily totals. */
  async activity(orgId: string, courseId?: string) {
    const since = new Date(Date.now() - 56 * 86400000).toISOString().slice(0, 10);
    return this.driver.query(
      'SELECT course_id,day::text AS day,SUM(started)::int AS started,SUM(done)::int AS done FROM institutes.course_stats WHERE org_id=$1 AND ($2::text IS NULL OR course_id=$2) AND day>=$3::date GROUP BY course_id,day ORDER BY day',
      [orgId, courseId ?? null, since],
    );
  }

  /** The institute's inbox: open "contact me" requests first, then the most recently handled. */
  async requests(orgId: string) {
    return this.driver.query(
      `SELECT r.id,r.user_id,s.name,s.phone,r.course_id,c.title AS course_title,r.source,r.note,r.created_at::bigint AS created_at,r.handled_at::bigint AS handled_at,r.handled_by
       FROM institutes.contact_requests r JOIN institutes.students s ON s.user_id=r.user_id LEFT JOIN institutes.courses c ON (c.org_id,c.id)=(r.org_id,r.course_id)
       WHERE r.org_id=$1 AND EXISTS(SELECT 1 FROM institutes.enrollments e WHERE e.org_id=r.org_id AND e.user_id=r.user_id AND e.left_at IS NULL) ORDER BY (r.handled_at IS NOT NULL), COALESCE(r.handled_at,r.created_at) DESC LIMIT 300`,
      [orgId],
    );
  }

  async handleRequest(orgId: string, requestId: string, actor: string) {
    return this.tx(async (tx) => {
      const done = await tx.query('UPDATE institutes.contact_requests SET handled_at=$3,handled_by=$4 WHERE org_id=$1 AND id=$2 AND handled_at IS NULL RETURNING id', [orgId, requestId, Date.now(), actor]);
      if (!done.length) return missing();
      await this.audit(tx, orgId, actor, 'request.handled', requestId);
    });
  }

  /** The student's "Talk to your faculty" button: switches "contact me" on and puts a request in the inbox. */
  async requestContact(orgId: string, courseId: string, userId: string, note: string | null) {
    return this.tx(async (tx) => {
      await this.lockStudent(tx, userId);
      const access = await this.active(tx, orgId, courseId, userId);
      if (!access.enrolled) return denied();
      await tx.query(
        'INSERT INTO institutes.consents(id,org_id,user_id,text_version,purpose,given_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,user_id,purpose) WHERE withdrawn_at IS NULL DO NOTHING',
        [randomUUID(), orgId, userId, CONSENT_VERSION, 'contact', Date.now()],
      );
      await this.raiseRequest(tx, orgId, userId, courseId, 'button', note);
      return { requested: true };
    });
  }

  async leads(orgId: string, actor: string, filter: PageFilter) {
    // Export and audit share one transaction; fail closed if audit cannot be recorded.
    return this.tx(async (tx) => {
      // The SELECT statement snapshot is the export's linearisation point; already-committed withdrawals are excluded.
      const result = await new InstitutesDb(tx, this.receiptSecret).students(orgId, filter);
      await this.audit(tx, orgId, actor, 'leads.export', JSON.stringify({ ...filter, rows: result.items.length }));
      return result;
    });
  }
}

let configured: Promise<InstitutesDb> | undefined;

/** One pool per process. A failed connection is forgotten, so a later request tries again. */
export function configuredInstitutes(secret: string): Promise<InstitutesDb> {
  if (!process.env.DATABASE_URL) return Promise.reject(new ApiError(503, 'internal_error', 'Institute services are not configured.'));
  if (!configured) {
    const driver = postgresDriver(postgres(process.env.DATABASE_URL, { max: 10, connect_timeout: 10, idle_timeout: 20 }));
    const db = new InstitutesDb(driver, secret);
    configured = db
      .migrate()
      .then(() => db)
      .catch(async () => {
        configured = undefined;
        await driver.close();
        throw new ApiError(503, 'internal_error', 'Institute database is unavailable.');
      });
  }
  return configured;
}
