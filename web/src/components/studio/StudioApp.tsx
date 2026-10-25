import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronRight, DoorOpen, PhoneCall, Users } from 'lucide-react';
import { downloadLeads, type Course, type CoursePayload, type Org, type Row } from '../../institute-api';
import type { Call } from '../institute-tools/shared';
import { buildCourse, depth, parsePlace, placeHash, toStudents, walk, type Place, type Student } from './model';
import { LeadsRoom, LessonRoom, Lobby, SectionRoom, StudentsRoom, type CourseView, type Totals } from './rooms';
import { useSmoothScroll } from './useSmoothScroll';
import './studio.css';

type Funnel = Totals & { videos: Row[] };
type Outline = { version: number; data: CoursePayload; titles: Record<string, string> };

/**
 * The institute Studio as a building: the lobby shows the whole institute, and every course, subject, topic
 * and lecture is a door into its own room. Where you are lives in the URL hash, so Back walks you out and a
 * room can be shared as a link. Read-only: the server decides what each person may see.
 */
export function StudioApp({ orgs, org, onOrg, courses, call, token }: {
  orgs: Org[];
  org: string;
  onOrg: (id: string) => void;
  courses: Course[];
  call: Call;
  token: () => Promise<string | null>;
}) {
  const reduced = useReducedMotion();
  const toTop = useSmoothScroll();
  const [place, setPlace] = useState<Place>(() => parsePlace(location.hash));
  const [direction, setDirection] = useState(1);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [views, setViews] = useState<CourseView[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const orgName = orgs.find((o) => o.id === org)?.name ?? 'Your institute';
  const canApprove = ['owner', 'admin'].includes(orgs.find((o) => o.id === org)?.role ?? '');
  const [refresh, setRefresh] = useState(0);

  // Walking: the hash is the source of truth, so Back and Forward work like doors too.
  useEffect(() => {
    const onHash = () => {
      const next = parsePlace(location.hash);
      setPlace((current) => {
        setDirection(depth(next) >= depth(current) ? 1 : -1);
        return next;
      });
      toTop();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = useCallback((next: Place) => {
    location.hash = placeHash(next);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    (async () => {
      const funnel = await call<Funnel>(`/v1/studio/${org}/funnel`);
      const perCourse = await Promise.all(
        courses.map(async (course): Promise<CourseView> => {
          const [courseFunnel, outline, channels] = await Promise.all([
            call<Funnel>(`/v1/studio/${org}/funnel?courseId=${course.id}`),
            call<Outline>(`/v1/studio/${org}/outline?courseId=${course.id}`).catch(() => null),
            call<{ channels: CourseView['channels'] }>(`/v1/studio/${org}/channels?courseId=${course.id}`).catch(() => ({ channels: [] })),
          ]);
          const videos = funnel.videos.filter((v) => String(v.course_id) === course.id);
          return {
            id: course.id,
            title: course.title,
            kind: course.kind,
            section: outline ? buildCourse(course.id, course.title, outline.data, videos, outline.titles) : null,
            totals: courseFunnel,
            channels: channels.channels,
          };
        }),
      );
      // Consenting students, a few pages at most: the talent board is for reading, exports go page by page.
      const rows: Row[] = [];
      let after: string | null = null;
      for (let page = 0; page < 4; page += 1) {
        const result: { items: Row[]; next: string | null } = await call(`/v1/studio/${org}/students?limit=500${after ? `&after=${after}` : ''}`);
        rows.push(...result.items);
        after = result.next;
        if (!after) break;
      }
      if (!live) return;
      setTotals(funnel);
      setViews(perCourse);
      setStudents(toStudents(rows));
    })()
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [org, courses, call, refresh]);

  // The Studio's one write: an owner or admin lets students see an outside channel in this course.
  const approve = (courseId: string) => (channelId: string) => {
    void call(`/v1/studio/${org}/channels`, { courseId, channelId })
      .then(() => setRefresh((n) => n + 1))
      .catch((e: Error) => setError(e.message));
  };

  const exportLeads = async (filters: { courseId: string; minCompletion: number; minQuizScore: number }) => {
    const key = await token();
    if (!key) throw new Error('Sign in to export.');
    const q = new URLSearchParams({ limit: '500' });
    if (filters.courseId) q.set('courseId', filters.courseId);
    if (filters.minCompletion) q.set('minCompletion', String(filters.minCompletion));
    if (filters.minQuizScore) q.set('minQuizScore', String(filters.minQuizScore));
    return downloadLeads(key, `/v1/studio/${org}/leads.csv?${q}`);
  };

  const corridor = useMemo(() => {
    const steps: { label: string; place: Place }[] = [{ label: orgName, place: { room: 'lobby' } }];
    if (place.room === 'students') steps.push({ label: 'Talent board', place });
    if (place.room === 'leads') steps.push({ label: 'Leads', place });
    if (place.room === 'course') {
      const view = views.find((v) => v.id === place.path[0]);
      if (view?.section) {
        const trail = walk(view.section, place.path);
        trail.forEach((room, i) => {
          const label = room.kind === 'lesson' ? `Lecture ${room.number}` : room.title;
          steps.push({ label, place: { room: 'course', path: trail.slice(0, i + 1).map((r) => r.id) } });
        });
      }
    }
    return steps;
  }, [place, views, orgName]);

  const room = () => {
    if (loading) return <Loading />;
    if (place.room === 'students') return <StudentsRoom students={students} />;
    if (place.room === 'leads') return <LeadsRoom contactable={totals?.shared_contact ?? 0} courses={views} onExport={exportLeads} />;
    if (place.room === 'course') {
      const view = views.find((v) => v.id === place.path[0]);
      if (!view?.section) return <Lobby orgName={orgName} totals={totals} courses={views} students={students} go={go} />;
      const trail = walk(view.section, place.path);
      const ids = trail.map((r) => r.id);
      if (trail.at(-1)?.kind === 'lesson') return <LessonRoom course={view} trail={ids} go={go} />;
      return <SectionRoom course={view} trail={ids} go={go} onApprove={canApprove ? approve(view.id) : undefined} />;
    }
    return <Lobby orgName={orgName} totals={totals} courses={views} students={students} go={go} />;
  };

  // Going in: the next room comes forward out of a soft blur while this one grows past you.
  // Coming back: the reverse. Reduced motion: a plain cross-fade.
  const variants = {
    enter: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, scale: dir > 0 ? 0.94 : 1.05, filter: 'blur(14px)' }),
    center: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, scale: dir > 0 ? 1.06 : 0.95, filter: 'blur(10px)' }),
  };

  return (
    <div className="fss">
      <div className="fss-light" aria-hidden="true" />
      <header className="fss-bar">
        <nav className="fss-corridor" aria-label="Where you are">
          {corridor.map((step, i) => (
            <span key={i}>
              {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
              {i < corridor.length - 1 ? (
                <a href={placeHash(step.place)}>{step.label}</a>
              ) : (
                <span aria-current="page">{step.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="fss-bar-doors">
          <a href={placeHash({ room: 'lobby' })} aria-current={place.room === 'lobby' || place.room === 'course' ? 'page' : undefined}><DoorOpen size={15} aria-hidden="true" /> Courses</a>
          <a href={placeHash({ room: 'students' })} aria-current={place.room === 'students' ? 'page' : undefined}><Users size={15} aria-hidden="true" /> Talent</a>
          <a href={placeHash({ room: 'leads' })} aria-current={place.room === 'leads' ? 'page' : undefined}><PhoneCall size={15} aria-hidden="true" /> Leads</a>
          {orgs.length > 1 && (
            <select value={org} onChange={(e) => onOrg(e.target.value)} aria-label="Institute">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>
      </header>
      {error && <p role="alert" className="fss-error">{error}</p>}
      <main className="fss-stage">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div key={`${org}:${placeHash(place)}:${loading}`} custom={direction} variants={variants} initial="enter" animate="center" exit="exit"
            transition={{ duration: reduced ? 0.15 : 0.55, ease: [0.22, 1, 0.36, 1] }}>
            {room()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Loading() {
  return (
    <div className="fss-loading" role="status">
      <span className="fss-loading-door" aria-hidden="true" />
      <p>Opening the doors…</p>
    </div>
  );
}
