import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, BookOpen, ChevronRight, Inbox, LayoutDashboard, LogOut, Moon, Newspaper, Sun, Users } from 'lucide-react';
import { useAuth } from '../../auth';
import { onLinkClick } from '../../router';
import type { Appearance } from '../../appearance';
import { downloadLeads, type Course, type CoursePayload, type Org, type Row } from '../../institute-api';
import type { Call } from '../institute-tools/shared';
import { buildCourse, depth, parsePlace, placeHash, walk, type Place } from './model';
import { actions as rank, brief, dailySeries, quiet, story as tell, toMembers, toRequests, week as weekOf, type Member, type Request } from './insights';
import { CoursesPage, LessonRoom, SectionRoom, type CourseView, type Totals } from './rooms';
import { BriefPage, initials, Overview, RequestsPage, StudentsPage } from './pages';
import { StudentReport } from './StudentReport';
import { useSmoothScroll } from './useSmoothScroll';
import './studio.css';

type Funnel = Totals & { videos: Row[] };
type Outline = { version: number; data: CoursePayload; titles: Record<string, string> };

/**
 * The institute dashboard. Signed-in institute staff get their own app here, not the marketing site: a
 * sidebar, an overview that reads like a morning edition, and doors into every course, subject, topic,
 * lecture and student. Where you are lives in the URL hash, so Back walks you out and any room can be
 * shared as a link. The server decides what each person may see; this only shows its answer.
 */
export function StudioApp({ orgs, org, onOrg, courses, call, token, appearance, onAppearance }: {
  orgs: Org[];
  org: string;
  onOrg: (id: string) => void;
  courses: Course[];
  call: Call;
  token: () => Promise<string | null>;
  appearance: Appearance;
  onAppearance: (a: Appearance) => void;
}) {
  const auth = useAuth();
  const reduced = useReducedMotion();
  const toTop = useSmoothScroll();
  const [place, setPlace] = useState<Place>(() => parsePlace(location.hash));
  const [direction, setDirection] = useState(1);
  const [views, setViews] = useState<CourseView[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [activity, setActivity] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const now = useMemo(() => Date.now(), [refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = orgs.find((o) => o.id === org);
  const orgName = current?.name ?? 'Your institute';
  const canApprove = ['owner', 'admin'].includes(current?.role ?? '');

  // Walking: the hash is the source of truth, so Back and Forward work like doors too.
  useEffect(() => {
    const onHash = () => {
      const next = parsePlace(location.hash);
      setPlace((was) => {
        setDirection(depth(next) >= depth(was) ? 1 : -1);
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
    setLoading((was) => was || refresh === 0);
    setError('');
    (async () => {
      const [funnel, inbox, days] = await Promise.all([
        call<Funnel>(`/v1/studio/${org}/funnel`),
        call<{ requests: Row[] }>(`/v1/studio/${org}/requests`),
        call<{ days: Row[] }>(`/v1/studio/${org}/activity`),
      ]);
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
      // Everyone enrolled, a few pages at most: this is for reading; exports go page by page.
      const rows: Row[] = [];
      let after: string | null = null;
      for (let page = 0; page < 6; page += 1) {
        const result: { items: Row[]; next: string | null } = await call(`/v1/studio/${org}/students?limit=500${after ? `&after=${after}` : ''}`);
        rows.push(...result.items);
        after = result.next;
        if (!after) break;
      }
      if (!live) return;
      setViews(perCourse);
      setMembers(toMembers(rows));
      setRequests(toRequests(inbox.requests));
      setActivity(days.days);
    })()
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [org, courses, call, refresh]);

  const sections = views.flatMap((v) => (v.section ? [v.section] : []));
  const series = useMemo(() => dailySeries(activity, now), [activity, now]);
  const thisWeek = useMemo(() => weekOf(series), [series]);
  const todo = useMemo(() => rank({ members, requests, courses: sections, week: thisWeek, now }), [members, requests, sections, thisWeek, now]);
  const open = requests.filter((r) => r.handledAt === null).length;

  const markHandled = (id: string) => {
    void call(`/v1/studio/${org}/requests/${id}/handled`, {})
      .then(() => setRefresh((n) => n + 1))
      .catch((e: Error) => setError(e.message));
  };
  const approve = (courseId: string) => (channelId: string) => {
    void call(`/v1/studio/${org}/channels`, { courseId, channelId })
      .then(() => setRefresh((n) => n + 1))
      .catch((e: Error) => setError(e.message));
  };
  const exportList = async (priorityOnly: boolean) => {
    const key = await token();
    if (!key) throw new Error('Sign in to export.');
    return downloadLeads(key, `/v1/studio/${org}/leads.csv?limit=500${priorityOnly ? '&priority=1' : ''}`);
  };

  const corridor = useMemo(() => {
    if (place.room !== 'course' && place.room !== 'student') return [];
    if (place.room === 'student') {
      const m = members.find((x) => x.id === place.id);
      return [{ label: 'Students', place: { room: 'students' } as Place }, { label: m?.name ?? 'Student', place }];
    }
    const steps: { label: string; place: Place }[] = [{ label: 'Courses', place: { room: 'courses' } }];
    const view = views.find((v) => v.id === place.path[0]);
    if (view?.section) {
      const trail = walk(view.section, place.path);
      trail.forEach((room, i) => steps.push({ label: room.kind === 'lesson' ? `Lecture ${room.number}` : room.title, place: { room: 'course', path: trail.slice(0, i + 1).map((r) => r.id) } }));
    }
    return steps;
  }, [place, views, members]);

  const room = () => {
    if (loading) return <Loading />;
    switch (place.room) {
      case 'courses':
        return <CoursesPage courses={views} go={go} />;
      case 'students':
        return <StudentsPage members={members} filter={place.filter ?? 'all'} go={go} onExport={exportList} now={now} />;
      case 'student':
        return <StudentReport org={org} id={place.id} sections={sections} call={call} go={go} now={now} />;
      case 'requests':
        return <RequestsPage requests={requests} members={members} onHandled={markHandled} go={go} now={now} />;
      case 'brief':
        return <BriefPage text={brief({ orgName, week: thisWeek, yesterday: series.at(-2), actions: todo, quietNames: members.filter((m) => quiet(m, now)).map((m) => m.name), link: `${location.origin}/studio` })} />;
      case 'course': {
        const view = views.find((v) => v.id === place.path[0]);
        if (!view?.section) return <CoursesPage courses={views} go={go} />;
        const trail = walk(view.section, place.path);
        const ids = trail.map((r) => r.id);
        if (trail.at(-1)?.kind === 'lesson') return <LessonRoom course={view} trail={ids} go={go} />;
        return <SectionRoom course={view} trail={ids} go={go} onApprove={canApprove ? approve(view.id) : undefined} />;
      }
      default:
        return <Overview orgName={orgName} story={tell({ orgName, members, week: thisWeek, open, actions: todo.length, now })} actions={todo} series={series} week={thisWeek} members={members} open={open} go={go} now={now} />;
    }
  };

  // Going in: the next room comes forward out of a soft blur while this one grows past you. Coming back:
  // the reverse. Reduced motion: a plain cross-fade.
  const variants = {
    enter: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, scale: dir > 0 ? 0.96 : 1.03, filter: 'blur(12px)' }),
    center: { opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, scale: dir > 0 ? 1.04 : 0.97, filter: 'blur(8px)' }),
  };
  const section = place.room === 'course' ? 'courses' : place.room === 'student' ? 'students' : place.room;
  const nav: { room: Place['room']; label: string; icon: typeof Users; badge?: number }[] = [
    { room: 'lobby', label: 'Overview', icon: LayoutDashboard },
    { room: 'requests', label: 'Requests', icon: Inbox, badge: open },
    { room: 'students', label: 'Students', icon: Users },
    { room: 'courses', label: 'Courses', icon: BookOpen },
    { room: 'brief', label: 'Morning brief', icon: Newspaper },
  ];
  const userName = auth.user?.name ?? auth.user?.email ?? auth.user?.phone ?? 'Signed in';

  return (
    <div className="fss fss-app">
      <div className="fss-light" aria-hidden="true" />
      <aside className="fss-side">
        <div className="fss-org">
          <span className="fss-org-badge" aria-hidden="true">{initials(orgName)}</span>
          <span>
            <b>{orgName}</b>
            {orgs.length > 1 ? (
              <select value={org} onChange={(e) => onOrg(e.target.value)} aria-label="Switch institute">
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <small>on FocusSpace</small>
            )}
          </span>
        </div>
        <nav className="fss-nav" aria-label="Dashboard">
          {nav.map(({ room: r, label, icon: Icon, badge }) => (
            <a key={r} href={placeHash({ room: r } as Place)} aria-current={section === r ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go({ room: r } as Place); }}>
              {section === r && <motion.span layoutId="fss-nav-on" className="fss-nav-on" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
              {!!badge && <em>{badge}</em>}
            </a>
          ))}
        </nav>
        <div className="fss-me">
          <div className="fss-me-row">
            <span className="fss-avatar" aria-hidden="true">{initials(userName)}</span>
            <span><b>{userName}</b><small>{current?.role ? `${current.role[0].toUpperCase()}${current.role.slice(1)}` : 'Staff'}</small></span>
          </div>
          <div className="fss-me-actions">
            <button type="button" onClick={() => onAppearance(appearance === 'deep' ? 'light' : 'deep')} aria-label={appearance === 'deep' ? 'Switch to Light' : 'Switch to Deep'}>
              {appearance === 'deep' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            </button>
            <a href="/" onClick={onLinkClick('/')} aria-label="Back to the website"><ArrowLeft size={15} aria-hidden="true" /></a>
            <button type="button" onClick={() => void auth.signOut().then(() => location.assign('/'))} aria-label="Sign out"><LogOut size={15} aria-hidden="true" /></button>
          </div>
        </div>
      </aside>

      <div className="fss-main">
        {corridor.length > 0 && (
          <nav className="fss-corridor" aria-label="Where you are">
            {corridor.map((step, i) => (
              <span key={i}>
                {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
                {i < corridor.length - 1 ? <a href={placeHash(step.place)}>{step.label}</a> : <span aria-current="page">{step.label}</span>}
              </span>
            ))}
          </nav>
        )}
        {error && <p role="alert" className="fss-error">{error}</p>}
        <main className="fss-stage">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div key={`${org}:${placeHash(place)}:${loading}`} custom={direction} variants={variants} initial="enter" animate="center" exit="exit"
              transition={{ duration: reduced ? 0.15 : 0.5, ease: [0.22, 1, 0.36, 1] }}>
              {room()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
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
