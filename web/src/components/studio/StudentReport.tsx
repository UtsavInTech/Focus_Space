import { OutcomeButton } from './ResultsPage';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, MessageCircle, Phone, PlayCircle } from 'lucide-react';
import type { Call } from '../institute-tools/shared';
import { CountUp, HourBlocks, QuizChart, StudyCalendar } from './charts';
import { percent, placeHash, type Place, type Section } from './model';
import { ago, hoursAndMinutes, pattern, progressIn, quizSeries, quizTrend, subjectScores, summary, type ReportInput } from './report';
import { initials, phoneText, telLink, whatsappLink } from './pages';

const rise = { hidden: { opacity: 0, y: 24 }, shown: { opacity: 1, y: 0 } };
const stagger = { hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } };

interface ReportData extends ReportInput {
  student: { user_id: string; name: string | null; phone: string; sharing_progress: boolean; wants_contact: boolean };
  courses: { course_id: string; title: string; batch_id: string | null; joined_at: number }[];
  requests: { id: string; source: string; note: string | null; created_at: number; handled_at: number | null }[];
}

/**
 * One student, the way a faculty member would want to read them before a call: a written summary first,
 * then where they are in each course, their quiz report and their study pattern. Progress parts appear
 * only while the student shares progress; their name and number are always here (shared on joining).
 */
export function StudentReport({ org, id, sections, call, go, now }: { org: string; id: string; sections: Section[]; call: Call; go: (p: Place) => void; now: number }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    call<ReportData>(`/v1/studio/${org}/students/${id}`)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [org, id, call]);

  if (error) return <p className="fss-error">{error}</p>;
  if (!data) return <div className="fss-loading" role="status"><span className="fss-loading-door" aria-hidden="true" /><p>Opening the report…</p></div>;

  const name = data.student.name ?? 'Student';
  const first = name.split(' ')[0];
  const enrolled = sections.filter((s) => data.courses.some((c) => c.course_id === s.id));
  const progress = progressIn(enrolled, data);
  const seconds = data.lectures.reduce((n, l) => n + Number(l.seconds), 0);
  const points = quizSeries(enrolled, data);
  const subjects = subjectScores(enrolled, points);
  const study = pattern(data, now);
  const average = points.length ? Math.round(points.reduce((n, p) => n + p.percent, 0) / points.length) : null;
  const trend = quizTrend(points);
  const done = progress.reduce((n, p) => n + p.done, 0);
  const total = progress.reduce((n, p) => n + p.total, 0);
  const openRequest = data.requests.find((r) => r.handled_at === null);

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-person">
        <span className="fss-avatar is-huge" aria-hidden="true">{initials(name)}</span>
        <div>
          <p className="fss-eyebrow">Student report · joined {new Date(data.courses[0].joined_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <h1>{name}</h1>
          <div className="fss-chips">
            <span className="fss-mono">{phoneText(data.student.phone)}</span>
            {data.courses.map((c) => <span key={c.course_id}>{c.title}{c.batch_id ? ' · batch' : ''}</span>)}
            {(data.student.wants_contact || openRequest) && <span className="fss-badge is-priority">{openRequest ? 'Waiting for a call' : 'Asked to talk'}</span>}
          </div>
          {openRequest?.note && <p className="fss-note">“{openRequest.note}”</p>}
        </div>
        <div className="fss-person-actions"><OutcomeButton org={org} call={call} userId={id}/>
          <a className="fss-cta" href={telLink(data.student.phone)}><Phone size={16} aria-hidden="true" /> Call {first}</a>
          <a className="fss-ghost" href={whatsappLink(data.student.phone, `Hello ${first}, this is your institute.`)} target="_blank" rel="noreferrer"><MessageCircle size={15} aria-hidden="true" /> WhatsApp</a>
        </div>
      </motion.header>

      {!data.student.sharing_progress ? (
        <motion.section variants={rise} className="fss-panel fss-private-panel">
          <Lock size={22} aria-hidden="true" />
          <div>
            <h2>{first} keeps progress private</h2>
            <p>{first} shared a name and verified number when joining, so you can call. Lectures, quiz scores and study time appear here only if {first} chooses to share progress. {first} is still counted in your course totals.</p>
          </div>
        </motion.section>
      ) : (
        <>
          <motion.p variants={rise} className="fss-story is-report">{summary(name, progress, seconds, points, subjects, study, now)}</motion.p>

          <motion.section variants={rise} className="fss-kpis is-cards">
            <div><span className="fss-eyebrow">Lectures finished</span><strong><CountUp value={done} /><small> / {total}</small></strong><em>{percent(total ? done / total : 0)} of the course</em></div>
            <div><span className="fss-eyebrow">Time in lectures</span><strong>{hoursAndMinutes(seconds)}</strong><em>across {data.lectures.length} lectures opened</em></div>
            <div><span className="fss-eyebrow">Quiz average</span><strong>{average === null ? '—' : <><CountUp value={average} />%</>}</strong><em>{trend ? `${trend} · ` : ''}{points.length} quiz{points.length === 1 ? '' : 'zes'}</em></div>
            <div><span className="fss-eyebrow">Last active</span><strong className="is-text">{ago(study.lastActive, now)}</strong><em>{study.streak > 1 ? `${study.streak}-day streak` : `${study.daysPerWeek} days a week`}</em></div>
          </motion.section>

          {progress.map((p) => (
            <motion.section key={p.course.id} variants={rise} className="fss-panel">
              <div className="fss-panel-head">
                <p className="fss-eyebrow">{p.course.title}</p>
                <h2>{p.current ? `Now at lecture ${p.current.number} of ${p.total}, ${p.place}` : 'Has not started yet'}</h2>
              </div>
              <div className="fss-course-progress">
                <div className="fss-lectures" aria-label={`${p.done} of ${p.total} lectures finished`}>
                  {p.course.lessons.map((l) => {
                    const row = data.lectures.find((x) => x.course_id === p.course.id && x.video_id === l.id);
                    return <span key={l.id} className={row ? `is-${row.stage}` : undefined} title={`Lecture ${l.number}: ${row ? row.stage : 'not opened'}`} />;
                  })}
                </div>
                <p className="fss-legend"><i className="is-done" /> finished <i className="is-half" /> halfway <i className="is-started" /> opened <i /> not opened</p>
                {p.next && (
                  <a className="fss-next" href={placeHash({ room: 'course', path: [p.course.id] })} onClick={(e) => { e.preventDefault(); go({ room: 'course', path: [p.course.id] }); }}>
                    <img src={`https://i.ytimg.com/vi/${p.next.id}/mqdefault.jpg`} alt="" loading="lazy" />
                    <span><small>Next unfinished lecture</small><b>{p.next.number}. {p.next.title ?? `Lecture ${p.next.number}`}</b></span>
                    <PlayCircle size={18} aria-hidden="true" />
                  </a>
                )}
              </div>
            </motion.section>
          ))}

          <motion.section variants={rise} className="fss-split is-even">
            <div className="fss-panel">
              <div className="fss-panel-head">
                <p className="fss-eyebrow">Quiz report</p>
                <h2>{average === null ? 'No quizzes yet' : `Averages ${average}%${trend === 'rising' ? ' and improving' : trend === 'falling' ? ' and slipping' : ''}`}</h2>
                <p>Every quiz in the order taken. Filled dots are institute quizzes, rings are Quiz me.</p>
              </div>
              <QuizChart points={points.map((p) => ({ at: p.at, percent: p.percent, kind: p.kind, label: p.lesson ? `Lecture ${p.lesson.number}${p.lesson.title ? `: ${p.lesson.title}` : ''}` : 'A lecture' }))} />
            </div>
            <div className="fss-panel">
              <div className="fss-panel-head">
                <p className="fss-eyebrow">By subject</p>
                <h2>{subjects.length >= 2 ? `Strongest in ${subjects[0].subject}` : 'Not enough quizzes per subject yet'}</h2>
                <p>Average quiz score in each subject with at least two quizzes.</p>
              </div>
              <div className="fss-subjects">
                {subjects.map((s) => (
                  <div key={s.subject}>
                    <span>{s.subject}<small>{s.quizzes} quizzes</small></span>
                    <span className="fss-meter is-thick"><motion.i initial={{ width: 0 }} whileInView={{ width: `${s.average}%` }} viewport={{ once: true }} transition={{ duration: 1 }} /></span>
                    <b>{s.average}%</b>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>

          <motion.section variants={rise} className="fss-panel">
            <div className="fss-panel-head">
              <p className="fss-eyebrow">Study pattern</p>
              <h2>
                {study.activeDays
                  ? `Studies about ${study.daysPerWeek} days a week${study.usualTime ? `, mostly ${study.usualTime}` : ''}`
                  : 'No study days recorded yet'}
              </h2>
              <p>{study.pace === 'not enough data' ? 'Not enough lectures yet to tell whether the pace is changing.' : `Over the last two weeks ${first} is ${study.pace}.`} Each square is a day; darker means more lectures.</p>
            </div>
            <div className="fss-pattern">
              <StudyCalendar days={study.calendar} />
              <HourBlocks hours={study.hours} />
            </div>
          </motion.section>
        </>
      )}

      {data.requests.length > 0 && (
        <motion.section variants={rise} className="fss-panel">
          <div className="fss-panel-head"><h2>Requests from {first}</h2></div>
          <ul className="fss-list">
            {data.requests.map((r) => (
              <li key={r.id}><span>{r.note ? `“${r.note}”` : 'Asked to be contacted'}</span><em>{ago(r.created_at, now)}{r.handled_at ? ` · done ${ago(r.handled_at, now)}` : ' · waiting'}</em></li>
            ))}
          </ul>
        </motion.section>
      )}
    </motion.div>
  );
}
