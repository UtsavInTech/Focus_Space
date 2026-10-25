import { useEffect, useState, type FormEvent } from 'react';
import { downloadLeads, type Course, type Row } from '../../institute-api';
import { TOOLS } from '../../content/institute-tools';
import { DataTable } from './DataTable';
import type { Call } from './shared';

type FunnelData = { videos: Row[] } & Record<string, unknown>;
type ChannelRequest = { channel_id: string; approved_by: string | null };

/**
 * An institute's own staff view: aggregate course progress, students who chose to share progress, leads who
 * chose to share contact details, and outside-channel approvals. Read-only apart from that one approval.
 */
export function Studio({ org, courses, call, token, role }: { org: string; courses: Course[]; call: Call; token: () => Promise<string | null>; role?: string }) {
  const [course, setCourse] = useState('');
  const [minimum, setMinimum] = useState('');
  const [score, setScore] = useState('');
  const [data, setData] = useState<FunnelData | null>(null);
  const [students, setStudents] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [exportNext, setExportNext] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelRequest[]>([]);
  const [error, setError] = useState('');

  const query = () =>
    new URLSearchParams({
      ...(course ? { courseId: course } : {}),
      ...(minimum ? { minCompletion: minimum } : {}),
      ...(score ? { minQuizScore: score } : {}),
      limit: '100',
    });

  const load = async (after?: string) => {
    try {
      setError('');
      const q = query();
      if (after) q.set('after', after);
      const [funnel, list] = await Promise.all([call<FunnelData>(`/v1/studio/${org}/funnel?${q}`), call<{ items: Row[]; next: string | null }>(`/v1/studio/${org}/students?${q}`)]);
      setData(funnel);
      setStudents(list.items);
      setNext(list.next);
      if (course) setChannels((await call<{ channels: ChannelRequest[] }>(`/v1/studio/${org}/channels?courseId=${course}`)).channels);
      else setChannels([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    setData(null);
    setStudents([]);
    setNext(null);
    setExportNext(null);
    void load();
  }, [org]); // filters are applied explicitly

  const exportPage = async (after?: string) => {
    try {
      const key = await token();
      if (!key) throw new Error('Sign in to export.');
      const q = query();
      if (after) q.set('after', after);
      setExportNext(await downloadLeads(key, `/v1/studio/${org}/leads.csv?${q}`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const applyFilters = (e: FormEvent) => {
    e.preventDefault();
    setExportNext(null);
    void load();
  };

  const approve = (channelId: string) => {
    void call(`/v1/studio/${org}/channels`, { courseId: course, channelId })
      .then(() => load())
      .catch((e) => setError(e.message));
  };

  return (
    <section>
      <h2>Course progress</h2>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={applyFilters}>
        <label>
          Course
          <select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">All courses</option>
            {courses.map((c) => (
              <option value={c.id} key={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minimum completion %
          <input type="number" min={0} max={100} value={minimum} onChange={(e) => setMinimum(e.target.value)} />
        </label>
        <label>
          Minimum quiz score %
          <input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
        </label>
        <button>Apply filters</button>
      </form>
      {data && <Funnel data={data} />}

      <h2>Students sharing progress</h2>
      <DataTable rows={students} />
      <button disabled={!next} onClick={() => void load(next!)}>
        Next students page
      </button>
      <LeadsExport exportNext={exportNext} onExport={(after) => void exportPage(after)} />
      <ChannelApprovals channels={channels} canApprove={['owner', 'admin'].includes(role ?? '')} onApprove={approve} />
    </section>
  );
}

/** Course totals (everyone enrolled is counted, sharing or not) and per-video completion and drop-off. */
function Funnel({ data }: { data: FunnelData }) {
  return (
    <>
      <dl className="fsw-tool-metrics">
        {Object.entries(TOOLS.metrics).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{String(data[key] ?? '—')}</dd>
          </div>
        ))}
      </dl>
      <p>{String(data.note ?? '')}</p>
      <DataTable rows={data.videos} />
    </>
  );
}

/** Exports go one page at a time, each logged by the server; only students who chose contact sharing appear. */
function LeadsExport({ exportNext, onExport }: { exportNext: string | null; onExport: (after?: string) => void }) {
  return (
    <div className="fsw-tool-actions">
      <button onClick={() => onExport()}>Export consenting leads</button>
      {exportNext && <button onClick={() => onExport(exportNext)}>Export next leads page</button>}
    </div>
  );
}

/** Only an institute owner or admin can approve an outside channel; faculty see it waiting. */
function ChannelApprovals({ channels, canApprove, onApprove }: { channels: ChannelRequest[]; canApprove: boolean; onApprove: (channelId: string) => void }) {
  if (!channels.length) return null;
  const pending = (channelId: string) => (canApprove ? <button onClick={() => onApprove(channelId)}>Approve for institute</button> : 'Awaiting an institute admin');
  return (
    <section>
      <h2>Channel approval requests</h2>
      {channels.map((c) => (
        <p key={c.channel_id}>
          {c.channel_id} · {c.approved_by ? 'Approved' : pending(c.channel_id)}
        </p>
      ))}
    </section>
  );
}
