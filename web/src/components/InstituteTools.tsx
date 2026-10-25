import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { onLinkClick } from '../router';
import { instituteRequest, type Org, type Course, type Batch, type CoursePayload } from '../institute-api';
import { TOOLS } from '../content/institute-tools';
import { ControlRoom } from './institute-tools/ControlRoom';
import { Studio } from './institute-tools/Studio';
import { formFields } from './institute-tools/shared';
import './institute-tools.css';

type View = 'admin' | 'studio';
type Access = { staff: boolean; orgs: Org[] };

/**
 * `/admin` (Control room, FocusSpace staff) and `/studio` (an institute's own staff). Both pick an
 * institute first; the server decides who may see which, and this page only shows its answer.
 */
export default function InstituteTools({ view }: { view: View }) {
  const auth = useAuth();
  const [access, setAccess] = useState<Access | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<CoursePayload | null>(null);

  const call = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const token = await auth.token();
      if (!token) throw new Error('Sign in to continue.');
      return instituteRequest<T>(token, path, body);
    },
    [auth.token],
  );

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  const reload = useCallback(async () => {
    if (!org) return;
    const coursesPath = `/v1/${view === 'admin' ? `admin/orgs/${org}` : `studio/${org}`}/courses`;
    setCourses((await call<{ courses: Course[] }>(coursesPath)).courses);
    if (view === 'admin') setBatches((await call<{ batches: Batch[] }>(`/v1/admin/orgs/${org}/batches`)).batches);
  }, [org, view, call]);

  // Staff on the Control room see every institute; everyone else sees the institutes they belong to.
  useEffect(() => {
    if (!auth.user) return;
    let active = true;
    void call<Access>('/v1/institutes/access')
      .then(async (result) => {
        if (!active) return;
        setAccess(result);
        const list = view === 'admin' && result.staff ? (await call<{ orgs: Org[] }>('/v1/admin/orgs')).orgs : result.orgs;
        if (!active) return;
        setOrgs(list);
        setOrg(list[0]?.id ?? '');
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [auth.user?.id, view, call]);

  // A different institute starts with no draft open.
  useEffect(() => {
    setDraft(null);
    setSelected('');
    void reload().catch((e) => setError(e.message));
  }, [reload]);

  const createOrg = (e: FormEvent<HTMLFormElement>) => {
    const f = formFields(e);
    void act(async () => {
      const created = await call<{ org: Org }>('/v1/admin/orgs', { name: f.get('name'), slug: f.get('slug') });
      const list = (await call<{ orgs: Org[] }>('/v1/admin/orgs')).orgs;
      setOrgs(list);
      setOrg(created.org.id);
    });
  };

  const body = () => {
    if (!auth.ready) return <p>{TOOLS.loading}</p>;
    if (!auth.user) {
      return (
        <a href={`/signin?next=%2F${view}`} onClick={onLinkClick(`/signin?next=%2F${view}`)}>
          {TOOLS.signin}
        </a>
      );
    }
    if (!access) return <p>{TOOLS.loading}</p>;
    if (view === 'admin' && !access.staff) return <p>{TOOLS.unavailable}</p>;
    return (
      <>
        {view === 'admin' && <AddInstituteForm busy={busy} onSubmit={createOrg} />}
        <OrgPicker orgs={orgs} org={org} onChange={setOrg} />
        {org && view === 'admin' && (
          <ControlRoom
            org={org}
            courses={courses}
            batches={batches}
            busy={busy}
            act={act}
            call={call}
            reload={reload}
            notify={setError}
            selected={selected}
            setSelected={setSelected}
            draft={draft}
            setDraft={setDraft}
          />
        )}
        {org && view === 'studio' && <Studio key={org} org={org} courses={courses} call={call} token={auth.token} role={orgs.find((o) => o.id === org)?.role} />}
      </>
    );
  };

  return (
    <section className="fsw-tools">
      <header>
        <h1>{TOOLS[view]}</h1>
        <p>{TOOLS.intro}</p>
        <nav>
          <a href="/admin" onClick={onLinkClick('/admin')}>
            Control room
          </a>
          <a href="/studio" onClick={onLinkClick('/studio')}>
            Studio
          </a>
          <a href="/account" onClick={onLinkClick('/account')}>
            Account
          </a>
        </nav>
      </header>
      {error && (
        <p role="alert" className="fsw-tool-error">
          {error}
        </p>
      )}
      {body()}
    </section>
  );
}

function AddInstituteForm({ busy, onSubmit }: { busy: boolean; onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form onSubmit={onSubmit}>
      <h2>Add institute</h2>
      <label>
        Name
        <input name="name" required maxLength={200} />
      </label>
      <label>
        Slug
        <input name="slug" required pattern="[a-zA-Z0-9_-]+" />
      </label>
      <button disabled={busy}>Create institute</button>
    </form>
  );
}

function OrgPicker({ orgs, org, onChange }: { orgs: Org[]; org: string; onChange: (id: string) => void }) {
  if (!orgs.length) return <p>No institute memberships yet.</p>;
  return (
    <label>
      Institute
      <select value={org} onChange={(e) => onChange(e.target.value)}>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
