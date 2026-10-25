import type { FormEvent } from 'react';
import { moveTopic, reorder, type CoursePayload } from '../../institute-api';
import { watchOrPlaylistUrl } from './shared';

type Subject = CoursePayload['subjects'][number];
type Topic = Subject['topics'][number];
/** Edits a copy of the draft; the caller hands the edited copy back up. */
type Change = (fn: (copy: CoursePayload) => void) => void;

/**
 * Staff review of an imported or saved draft: subject and topic names, order, and members-only lessons.
 * Nothing here is sent until "Save draft"; the server validates and checks channel approval on save.
 */
export function CourseDraftEditor({ value, onChange }: { value: CoursePayload; onChange: (value: CoursePayload) => void }) {
  const change: Change = (fn) => {
    const copy = structuredClone(value);
    fn(copy);
    onChange(copy);
  };

  const addSubject = () => {
    change((copy) => {
      copy.subjects.push({ id: crypto.randomUUID(), title: 'New subject', topics: [] });
    });
  };

  return (
    <section>
      <h2>Review course structure</h2>
      <p>YouTube titles are not cached. Name unmatched playlists before publishing. Changes remain a draft until you save and publish.</p>
      <button onClick={addSubject}>Add subject</button>
      {value.subjects.map((subject, si) => (
        <SubjectEditor key={subject.id} value={value} subject={subject} si={si} change={change} onChange={onChange} />
      ))}
      <ApprovedChannels value={value} change={change} />
      <p>Approved source channels: {value.approvedChannels.map((c) => c.id).join(', ')}</p>
    </section>
  );
}

interface SubjectProps {
  value: CoursePayload;
  subject: Subject;
  si: number;
  change: Change;
  onChange: (value: CoursePayload) => void;
}

function SubjectEditor({ value, subject, si, change, onChange }: SubjectProps) {
  const rename = (title: string) => {
    change((c) => {
      c.subjects[si].title = title;
    });
  };
  const move = (delta: number) => {
    change((c) => {
      c.subjects = reorder(c.subjects, si, delta);
    });
  };

  return (
    <section className="fsw-tool-subject">
      <label>
        Subject
        <input value={subject.title} onChange={(e) => rename(e.target.value)} />
      </label>
      <button aria-label={`Move ${subject.title} up`} disabled={!si} onClick={() => move(-1)}>
        ↑
      </button>
      <button aria-label={`Move ${subject.title} down`} disabled={si === value.subjects.length - 1} onClick={() => move(1)}>
        ↓
      </button>
      {subject.topics.map((topic, ti) => (
        <TopicEditor key={topic.id} value={value} subject={subject} topic={topic} si={si} ti={ti} change={change} onChange={onChange} />
      ))}
    </section>
  );
}

function TopicEditor({ value, subject, topic, si, ti, change, onChange }: SubjectProps & { topic: Topic; ti: number }) {
  const rename = (title: string) => {
    change((c) => {
      c.subjects[si].topics[ti].title = title;
    });
  };
  const move = (delta: number) => {
    change((c) => {
      c.subjects[si].topics = reorder(c.subjects[si].topics, ti, delta);
    });
  };
  const remove = () => {
    change((c) => {
      c.subjects[si].topics.splice(ti, 1);
    });
  };

  return (
    <details>
      <summary>
        {topic.title} · {topic.items.length} items
      </summary>
      <label>
        Topic
        <input value={topic.title} onChange={(e) => rename(e.target.value)} />
      </label>
      <label>
        Move to subject
        <select value={si} onChange={(e) => onChange(moveTopic(value, si, ti, Number(e.target.value)))}>
          {value.subjects.map((s, i) => (
            <option key={s.id} value={i}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <div className="fsw-tool-actions">
        <button disabled={!ti} onClick={() => move(-1)}>
          Move topic up
        </button>
        <button disabled={ti === subject.topics.length - 1} onClick={() => move(1)}>
          Move topic down
        </button>
        <button onClick={remove}>Remove topic</button>
      </div>
      <ol className="fsw-tool-items">
        {topic.items.map((item, ii) => (
          <ItemRow key={`${item.videoId ?? item.playlistId}-${ii}`} topic={topic} si={si} ti={ti} ii={ii} change={change} />
        ))}
      </ol>
    </details>
  );
}

function ItemRow({ topic, si, ti, ii, change }: { topic: Topic; si: number; ti: number; ii: number; change: Change }) {
  const item = topic.items[ii];
  const setMembersOnly = (membersOnly: boolean) => {
    change((c) => {
      c.subjects[si].topics[ti].items[ii].membersOnly = membersOnly;
    });
  };
  const move = (delta: number) => {
    change((c) => {
      c.subjects[si].topics[ti].items = reorder(c.subjects[si].topics[ti].items, ii, delta);
    });
  };
  const remove = () => {
    change((c) => {
      c.subjects[si].topics[ti].items.splice(ii, 1);
    });
  };

  return (
    <li>
      <a href={watchOrPlaylistUrl(item)} target="_blank" rel="noreferrer">
        {item.videoId ?? item.playlistId}
      </a>
      <label>
        <input type="checkbox" checked={!!item.membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
        Batch members only
      </label>
      <button disabled={!ii} aria-label="Move video up" onClick={() => move(-1)}>
        ↑
      </button>
      <button disabled={ii === topic.items.length - 1} aria-label="Move video down" onClick={() => move(1)}>
        ↓
      </button>
      <button onClick={remove}>Remove</button>
    </li>
  );
}

/** Adding a channel id here only lists it in the draft; the server refuses it on save unless an institute admin approved it. */
function ApprovedChannels({ value, change }: { value: CoursePayload; change: Change }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const id = String(new FormData(e.currentTarget).get('channel'));
    if (value.approvedChannels.some((c) => c.id === id)) return;
    change((c) => {
      c.approvedChannels.push({ id });
    });
  };

  return (
    <form onSubmit={submit}>
      <label>
        Include an institute-approved channel id
        <input name="channel" required pattern="UC[\w-]{22}" />
      </label>
      <button>Add approved channel</button>
      <p>The server rejects channels without institute approval.</p>
    </form>
  );
}
