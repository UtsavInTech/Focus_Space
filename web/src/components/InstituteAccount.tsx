import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { instituteRequest } from '../institute-api';
import { CONSENT_VERSION } from '../../../server/institutes/types';
import { TOOLS } from '../content/institute-tools';
import { onLinkClick } from '../router';

type EnrolledCourse = { orgId: string; courseId: string; org: { name: string } };

/** The account page's institute card: each course, a link to its sharing choices, and withdraw-all. */
export function InstituteAccount() {
  const auth = useAuth();
  const [courses, setCourses] = useState<EnrolledCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth.user) return;
    let live = true;
    void auth
      .token()
      .then((token) => (token ? instituteRequest<{ courses: EnrolledCourse[] }>(token, '/v1/me/institutes') : null))
      .then((data) => {
        if (live && data) setCourses(data.courses);
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Withdrawing keeps the course; only what is shared changes. */
  const withdraw = async (orgId: string) => {
    try {
      const token = await auth.token();
      if (!token) return;
      await instituteRequest(token, '/v1/consents', { orgId, consents: { textVersion: CONSENT_VERSION, progress: false, contact: false } });
      setError('Sharing withdrawn. Your course remains available.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="fsw-account-card">
      <h2>Institute courses and sharing</h2>
      <p>{TOOLS.notice}</p>
      {error && <p role="status">{error}</p>}
      {courses.map((c) => (
        <p key={`${c.orgId}:${c.courseId}`}>
          {c.org.name}{' '}
          <a href={`/learn/${c.courseId}`} onClick={onLinkClick(`/learn/${c.courseId}`)}>
            Course and sharing choices
          </a>{' '}
          <button type="button" onClick={() => void withdraw(c.orgId)}>
            Withdraw all sharing with this institute
          </button>
        </p>
      ))}
      {loading ? <p>Loading institute courses…</p> : !error && !courses.length && <p>No institute courses on this account.</p>}
    </section>
  );
}
