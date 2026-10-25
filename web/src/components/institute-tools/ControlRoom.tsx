import type { FormEvent } from 'react';
import { onLinkClick } from '../../router';
import type { Batch, Course, CoursePayload } from '../../institute-api';
import { BatchList } from './BatchList';
import { CourseDraftEditor } from './CourseDraftEditor';
import { formFields, type Act, type Call } from './shared';

/** One institute's admin page for FocusSpace staff: access, courses and their drafts, batches. */
export interface ControlRoomProps {
  org: string;
  courses: Course[];
  batches: Batch[];
  busy: boolean;
  act: Act;
  call: Call;
  reload: () => Promise<void>;
  notify: (message: string) => void;
  /** The course whose draft is open for review, if any. */
  selected: string;
  setSelected: (id: string) => void;
  draft: CoursePayload | null;
  setDraft: (draft: CoursePayload | null) => void;
}

export function ControlRoom(props: ControlRoomProps) {
  const { org, courses, batches, busy, act, call, reload, notify, selected, draft, setDraft } = props;
  const prefix = `/v1/admin/orgs/${org}`;
  return (
    <>
      <MembershipForm prefix={prefix} busy={busy} act={act} call={call} />
      <CreateCourseForm prefix={prefix} busy={busy} act={act} call={call} reload={reload} />
      <CourseList {...props} prefix={prefix} />
      {selected && draft && (
        <>
          <CourseDraftEditor value={draft} onChange={setDraft} />
          <DraftActions prefix={prefix} selected={selected} draft={draft} busy={busy} act={act} call={call} reload={reload} notify={notify} />
          <SuggestChannelForm prefix={prefix} selected={selected} busy={busy} act={act} call={call} notify={notify} />
        </>
      )}
      <CreateBatchForm prefix={prefix} courses={courses} busy={busy} act={act} call={call} reload={reload} />
      <BatchList batches={batches} prefix={prefix} busy={busy} act={act} call={call} reload={reload} notify={notify} />
    </>
  );
}

interface FormProps {
  prefix: string;
  busy: boolean;
  act: Act;
  call: Call;
}

function MembershipForm({ prefix, busy, act, call }: FormProps) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    const f = formFields(e);
    void act(async () => {
      await call(`${prefix}/members`, { userId: f.get('user'), role: f.get('role') });
    });
  };
  return (
    <form onSubmit={submit}>
      <h2>Institute access</h2>
      <label>
        FocusSpace user id
        <input name="user" required />
      </label>
      <label>
        Role
        <select name="role">
          <option>faculty</option>
          <option>admin</option>
          <option>owner</option>
        </select>
      </label>
      <button disabled={busy}>Save membership</button>
    </form>
  );
}

function CreateCourseForm({ prefix, busy, act, call, reload }: FormProps & { reload: () => Promise<void> }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    const f = formFields(e);
    void act(async () => {
      await call(`${prefix}/courses`, { title: f.get('title'), channelId: f.get('channel'), kind: f.get('kind'), ...(f.get('exam') ? { examId: f.get('exam') } : {}) });
      await reload();
    });
  };
  return (
    <form onSubmit={submit}>
      <h2>Create course</h2>
      <label>
        Course title
        <input name="title" required />
      </label>
      <label>
        YouTube channel id or URL
        <input name="channel" required placeholder="UC… or https://www.youtube.com/@handle" />
      </label>
      <label>
        Exam id (optional)
        <input name="exam" placeholder="upsc" />
      </label>
      <label>
        Access
        <select name="kind">
          <option value="free">Free course</option>
          <option value="batch">Private batch</option>
        </select>
      </label>
      <button disabled={busy}>Create draft course</button>
    </form>
  );
}

function CourseList({ courses, prefix, busy, act, call, setSelected, setDraft }: ControlRoomProps & { prefix: string }) {
  const review = (id: string) =>
    void act(async () => {
      setSelected(id);
      setDraft((await call<{ draft: { draft_json: CoursePayload | null } }>(`${prefix}/courses/${id}/draft`)).draft.draft_json);
    });

  // Imports run on the server with its own key, once a day per course; a repeat returns the day's result.
  const importChannel = (id: string) =>
    void act(async () => {
      setDraft((await call<{ payload: CoursePayload }>(`${prefix}/courses/${id}/import`, {})).payload);
      setSelected(id);
    });

  return (
    <section>
      <h2>Courses</h2>
      <ul className="fsw-tool-list">
        {courses.map((c) => (
          <li key={c.id}>
            <strong>{c.title}</strong>
            <span>
              {c.kind} · {c.status}
            </span>
            <button disabled={busy} onClick={() => review(c.id)}>
              Review
            </button>
            <button disabled={busy} onClick={() => importChannel(c.id)}>
              Import channel
            </button>
            <a href={`/learn/${c.id}`} onClick={onLinkClick(`/learn/${c.id}`)}>
              Student link
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Publishing always saves first, so what is published is exactly what was reviewed. */
function DraftActions({ prefix, selected, draft, busy, act, call, reload, notify }: FormProps & { selected: string; draft: CoursePayload; reload: () => Promise<void>; notify: (message: string) => void }) {
  const save = () =>
    void act(async () => {
      await call(`${prefix}/courses/${selected}/draft`, { payload: draft });
      notify('Draft saved.');
    });

  const publish = () =>
    void act(async () => {
      await call(`${prefix}/courses/${selected}/draft`, { payload: draft });
      await call(`${prefix}/courses/${selected}/publish`, {});
      await reload();
      notify('Version published.');
    });

  return (
    <div className="fsw-tool-actions">
      <button disabled={busy} onClick={save}>
        Save draft
      </button>
      <button disabled={busy} onClick={publish}>
        Publish reviewed version
      </button>
    </div>
  );
}

function SuggestChannelForm({ prefix, selected, busy, act, call, notify }: FormProps & { selected: string; notify: (message: string) => void }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    const f = formFields(e);
    void act(async () => {
      await call(`${prefix}/courses/${selected}/suggestions`, { channelId: f.get('channel') });
      notify('Suggestion saved. An institute owner or admin must approve it.');
    });
  };
  return (
    <form onSubmit={submit}>
      <label>
        Suggest outside channel
        <input name="channel" required placeholder="UC…" />
      </label>
      <button disabled={busy}>Request institute approval</button>
    </form>
  );
}

function CreateBatchForm({ prefix, courses, busy, act, call, reload }: FormProps & { courses: Course[]; reload: () => Promise<void> }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    const f = formFields(e);
    void act(async () => {
      await call(`${prefix}/batches`, { courseId: f.get('course'), name: f.get('name'), seats: Number(f.get('seats')) });
      await reload();
    });
  };
  return (
    <form onSubmit={submit}>
      <h2>Create batch</h2>
      <label>
        Course
        <select name="course" required>
          {courses
            .filter((c) => c.kind === 'batch')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        Batch name
        <input name="name" required />
      </label>
      <label>
        Seats
        <input name="seats" type="number" min={1} defaultValue={30} required />
      </label>
      <button disabled={busy}>Create batch</button>
    </form>
  );
}
