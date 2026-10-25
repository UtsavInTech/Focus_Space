import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, BookOpen, Download, Layers, ListChecks, PhoneCall, PlayCircle, Sparkles, Users } from 'lucide-react';
import { CountUp, Door, FunnelRibbon, RetentionCurve, Ring, Spark, TalentMap } from './charts';
import { count, GROUPS, groupOf, percent, summarise, type Group, type Lesson, type Place, type Section, type Student } from './model';

export type Totals = Record<string, number>;
export interface CourseView {
  id: string;
  title: string;
  kind: 'free' | 'batch';
  section: Section | null;
  totals: Totals | null;
  channels: { channel_id: string; approved_by: string | null }[];
}

const thumb = (id: string, size: 'mq' | 'hq' | 'maxres' = 'mq') => `https://i.ytimg.com/vi/${id}/${size}default.jpg`;
const KIND_LABEL = { course: 'Course', subject: 'Subject', topic: 'Topic' } as const;
const rise = { hidden: { opacity: 0, y: 24 }, shown: { opacity: 1, y: 0 } };
const stagger = { hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } } };

function funnelStages(t: Totals, joinedNote: string) {
  return [
    { label: 'Joined', value: t.joined ?? 0, note: joinedNote },
    { label: 'Started', value: t.started ?? 0 },
    { label: 'Half way', value: t.half ?? 0 },
    { label: 'Finished a lecture', value: t.done ?? 0 },
    { label: 'Share progress', value: t.shared_progress ?? 0 },
    { label: 'Share contact', value: t.shared_contact ?? 0 },
  ];
}

/* ─── Lobby: the whole institute ─────────────────────────────────────────── */

export function Lobby({ orgName, totals, courses, students, go }: { orgName: string; totals: Totals | null; courses: CourseView[]; students: Student[]; go: (p: Place) => void }) {
  const groups = useMemo(() => {
    const tally: Record<Group, number> = { toppers: 0, talent: 0, help: 0, drifting: 0 };
    for (const s of students) if (s.completion !== null) tally[groupOf(s)] += 1;
    return tally;
  }, [students]);

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero">
        <p className="fss-eyebrow">Studio · {orgName}</p>
        <h1>
          <CountUp value={totals?.joined ?? 0} /> learners
          <br />
          <span>are in your courses.</span>
        </h1>
        <p className="fss-lede">Walk through any course, subject or lecture to see where students stay, where they leave, and who is ready for a call.</p>
      </motion.header>

      {totals && (
        <motion.section variants={rise} className="fss-panel">
          <div className="fss-panel-head">
            <h2>From joining to sharing</h2>
            <p>Every enrolled student is counted here, whether they share or not.</p>
          </div>
          <FunnelRibbon stages={funnelStages(totals, 'Across all courses')} />
        </motion.section>
      )}

      <motion.section variants={rise} className="fss-section">
        <div className="fss-section-head">
          <p className="fss-eyebrow">Courses</p>
          <h2>Choose a door.</h2>
        </div>
        <div className="fss-doors is-wide">
          {courses.map((course) => {
            const summary = course.section ? summarise(course.section.lessons) : null;
            const cover = course.section?.lessons[0]?.id;
            return (
              <Door key={course.id} className="is-course" onOpen={() => go({ room: 'course', path: [course.id] })}>
                {cover && <img className="fss-door-cover" src={thumb(cover, 'hq')} alt="" loading="lazy" />}
                <span className="fss-door-kind">{course.kind === 'batch' ? 'Batch course' : 'Free course'}</span>
                <h3>{course.title}</h3>
                <div className="fss-door-stats">
                  <span><b>{count(course.totals?.joined ?? 0)}</b> learners</span>
                  <span><b>{summary?.lessons ?? 0}</b> lectures</span>
                  {summary && <span><b>{percent(summary.completionRate)}</b> watched to the end</span>}
                </div>
                {course.section && <Spark lessons={course.section.lessons} />}
                <ArrowUpRight className="fss-door-arrow" size={20} aria-hidden="true" />
              </Door>
            );
          })}
        </div>
      </motion.section>

      <motion.section variants={rise} className="fss-section">
        <div className="fss-section-head">
          <p className="fss-eyebrow">People</p>
          <h2>The students behind the numbers.</h2>
        </div>
        <div className="fss-doors">
          <Door className="is-side" onOpen={() => go({ room: 'students' })}>
            <Users size={22} aria-hidden="true" />
            <h3>Talent board</h3>
            <p>{count(students.length)} students share their progress with you.</p>
            <div className="fss-chips">
              <span><b>{groups.toppers}</b> toppers</span>
              <span><b>{groups.talent}</b> hidden talent</span>
              <span><b>{groups.help}</b> need help</span>
            </div>
            <ArrowUpRight className="fss-door-arrow" size={20} aria-hidden="true" />
          </Door>
          <Door className="is-side" onOpen={() => go({ room: 'leads' })}>
            <PhoneCall size={22} aria-hidden="true" />
            <h3>Leads</h3>
            <p><b>{count(totals?.shared_contact ?? 0)}</b> students agreed to be contacted about your courses.</p>
            <div className="fss-chips"><span>Verified numbers only</span><span>Every export logged</span></div>
            <ArrowUpRight className="fss-door-arrow" size={20} aria-hidden="true" />
          </Door>
        </div>
      </motion.section>
    </motion.div>
  );
}

/* ─── A course, subject or topic ─────────────────────────────────────────── */

export function SectionRoom({ course, trail, go, onApprove }: { course: CourseView; trail: string[]; go: (p: Place) => void; onApprove?: (channelId: string) => void }) {
  const section = course.section!;
  const here = walkSection(section, trail);
  const summary = summarise(here.lessons);
  // Judge attention only on lectures enough students reached; a lecture three people opened says little.
  const enough = Math.max(5, Math.round(Math.max(0, ...here.lessons.map((l) => l.stats.started)) * 0.25));
  const strongest = [...here.lessons].filter((l) => l.stats.started >= enough).sort((a, b) => b.stats.done / b.stats.started - a.stats.done / a.stats.started)[0];
  const weakest = [...here.lessons].filter((l) => l.stats.started >= enough).sort((a, b) => a.stats.done / a.stats.started - b.stats.done / b.stats.started)[0];
  const open = (id: string) => go({ room: 'course', path: [...trail, id] });
  const openLesson = (lesson: Lesson) => go({ room: 'course', path: lessonPath(section, lesson) });
  const lessonsHere = here.children.every((c) => c.kind === 'lesson');

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero is-room">
        <p className="fss-eyebrow">{KIND_LABEL[here.kind]}{here.kind !== 'course' ? ` · ${course.title}` : course.kind === 'batch' ? ' · Batch' : ' · Free'}</p>
        <h1>{here.title}</h1>
        <div className="fss-kpis">
          <div><span className="fss-eyebrow">Lectures</span><strong><CountUp value={summary.lessons} /></strong></div>
          <div><span className="fss-eyebrow">Lecture plays</span><strong><CountUp value={summary.starts} /></strong></div>
          <div><span className="fss-eyebrow">Watched to the end</span><strong><CountUp value={summary.completionRate} format={percent} /></strong></div>
          <div><span className="fss-eyebrow">Reached the last lecture</span><strong><CountUp value={summary.carryThrough} format={percent} /></strong></div>
        </div>
      </motion.header>

      {here.kind === 'course' && course.totals && (
        <motion.section variants={rise} className="fss-panel">
          <div className="fss-panel-head">
            <h2>From joining to sharing</h2>
            <p>Everyone enrolled in this course.</p>
          </div>
          <FunnelRibbon stages={funnelStages(course.totals, 'Enrolled in this course')} />
        </motion.section>
      )}

      {here.lessons.length > 1 && (
        <motion.section variants={rise} className="fss-panel">
          <div className="fss-panel-head">
            <h2>Lecture by lecture</h2>
            <p><i className="fss-key is-start" /> began the lecture <i className="fss-key is-done" /> watched it to the end. Point at a lecture to see it; click to open it.</p>
          </div>
          <RetentionCurve lessons={here.lessons} onPick={openLesson} mark={summary.biggestDrop?.lesson} />
        </motion.section>
      )}

      {(summary.biggestDrop || strongest || weakest) && (
        <motion.section variants={rise} className="fss-insights">
          {summary.biggestDrop && (
            <button type="button" onClick={() => openLesson(summary.biggestDrop!.lesson)}>
              <span className="fss-eyebrow">Where students leave</span>
              <p><b>{count(summary.biggestDrop.lost)}</b> fewer students began the lecture after <em>lesson {summary.biggestDrop.lesson.number}</em>.</p>
              <small>{summary.biggestDrop.lesson.title ?? 'Open the lecture'}</small>
            </button>
          )}
          {strongest && (
            <button type="button" onClick={() => openLesson(strongest)}>
              <span className="fss-eyebrow">Holds attention best</span>
              <p><b>{percent(strongest.stats.done / strongest.stats.started)}</b> of viewers finish <em>lesson {strongest.number}</em>.</p>
              <small>{strongest.title ?? 'Open the lecture'}</small>
            </button>
          )}
          {weakest && weakest !== strongest && (
            <button type="button" onClick={() => openLesson(weakest)}>
              <span className="fss-eyebrow">Loses attention most</span>
              <p>Only <b>{percent(weakest.stats.done / weakest.stats.started)}</b> finish <em>lesson {weakest.number}</em>.</p>
              <small>{weakest.title ?? 'Open the lecture'}</small>
            </button>
          )}
        </motion.section>
      )}

      <motion.section variants={rise} className="fss-section">
        <div className="fss-section-head">
          <p className="fss-eyebrow">{lessonsHere ? 'Lectures' : here.kind === 'course' ? 'Subjects' : 'Topics'}</p>
          <h2>{lessonsHere ? 'Every lecture, in your order.' : 'Go a room deeper.'}</h2>
        </div>
        {lessonsHere ? (
          <div className="fss-film">
            {here.lessons.map((lesson) => (
              <LessonDoor key={lesson.id} lesson={lesson} onOpen={() => open(lesson.id)} />
            ))}
          </div>
        ) : (
          <div className="fss-doors">
            {here.children.map((child) => {
              if (child.kind === 'lesson') return null;
              const s = summarise(child.lessons);
              return (
                <Door key={child.id} onOpen={() => open(child.id)}>
                  <span className="fss-door-kind">{child.kind === 'subject' ? <Layers size={14} aria-hidden="true" /> : <BookOpen size={14} aria-hidden="true" />} {KIND_LABEL[child.kind]}</span>
                  <h3>{child.title}</h3>
                  <div className="fss-door-row">
                    <Ring value={s.completionRate} size={58} />
                    <div className="fss-door-stats is-stacked">
                      <span><b>{s.lessons}</b> lectures</span>
                      <span><b>{count(s.starts)}</b> plays</span>
                      <span><b>{percent(s.carryThrough)}</b> carried through</span>
                    </div>
                  </div>
                  <Spark lessons={child.lessons} />
                  <ArrowUpRight className="fss-door-arrow" size={20} aria-hidden="true" />
                </Door>
              );
            })}
          </div>
        )}
      </motion.section>

      {here.kind === 'course' && course.channels.length > 0 && (
        <motion.section variants={rise} className="fss-panel">
          <div className="fss-panel-head">
            <h2>Outside channels</h2>
            <p>Channels suggested for this course. Students see them only once an owner or admin approves.</p>
          </div>
          <ul className="fss-list">
            {course.channels.map((c) => (
              <li key={c.channel_id}>
                <a href={`https://www.youtube.com/channel/${c.channel_id}`} target="_blank" rel="noreferrer">{c.channel_id}</a>
                {c.approved_by ? <em>Approved</em> : onApprove ? <button type="button" className="fss-chip-button" onClick={() => onApprove(c.channel_id)}>Approve for students</button> : <em>Waiting for an owner or admin</em>}
              </li>
            ))}
          </ul>
        </motion.section>
      )}
    </motion.div>
  );
}

function LessonDoor({ lesson, onOpen }: { lesson: Lesson; onOpen: () => void }) {
  const rate = lesson.stats.started ? lesson.stats.done / lesson.stats.started : 0;
  return (
    <Door className="is-lesson" onOpen={onOpen}>
      <span className="fss-film-frame">
        <img src={thumb(lesson.id)} alt="" loading="lazy" />
        <span className="fss-film-no">{String(lesson.number).padStart(2, '0')}</span>
        {lesson.quiz && <span className="fss-film-tag"><ListChecks size={12} aria-hidden="true" /> Quiz</span>}
      </span>
      <h3>{lesson.title ?? `Lesson ${lesson.number}`}</h3>
      <span className="fss-meter" aria-label={`${percent(rate)} watched to the end`}>
        <motion.i initial={{ width: 0 }} whileInView={{ width: percent(rate) }} viewport={{ once: true }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
      </span>
      <span className="fss-door-stats"><span><b>{count(lesson.stats.started)}</b> began</span><span><b>{percent(rate)}</b> finished</span></span>
    </Door>
  );
}

/* ─── One lecture ────────────────────────────────────────────────────────── */

export function LessonRoom({ course, trail, go }: { course: CourseView; trail: string[]; go: (p: Place) => void }) {
  const section = course.section!;
  const topic = walkSection(section, trail.slice(0, -1));
  const lesson = topic.lessons.find((l) => l.id === trail.at(-1))!;
  const all = section.lessons;
  const index = all.findIndex((l) => l.id === lesson.id);
  const before = all[index - 1];
  const after = all[index + 1];
  const { started, half, done } = lesson.stats;
  const stages = [
    { label: 'Began', value: started },
    { label: 'Reached half way', value: half },
    { label: 'Watched to the end', value: done },
  ];
  const nextStarted = after?.stats.started ?? null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-lesson-hero">
        <div className="fss-lesson-screen">
          <img src={thumb(lesson.id, 'hq')} alt="" />
          <a href={`https://www.youtube.com/watch?v=${lesson.id}`} target="_blank" rel="noreferrer"><PlayCircle size={18} aria-hidden="true" /> Watch on YouTube</a>
        </div>
        <div>
          <p className="fss-eyebrow">Lecture {lesson.number} of {all.length} · {topic.title}</p>
          <h1 className="is-lesson">{lesson.title ?? `Lesson ${lesson.number}`}</h1>
          <div className="fss-chips">
            {lesson.quiz && <span><ListChecks size={13} aria-hidden="true" /> Has an institute quiz</span>}
            {lesson.membersOnly && <span>Batch members only</span>}
          </div>
        </div>
      </motion.header>

      <motion.section variants={rise} className="fss-panel">
        <div className="fss-panel-head">
          <h2>Inside this lecture</h2>
          <p>How far students got. The gap between bars is attention lost inside the lecture.</p>
        </div>
        <div className="fss-bars">
          {stages.map((stage) => (
            <div key={stage.label} className="fss-stagebar">
              <span className="fss-eyebrow">{stage.label}</span>
              <span className="fss-stagebar-track">
                <motion.i initial={{ width: 0 }} whileInView={{ width: percent(started ? stage.value / started : 0) }} viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} />
              </span>
              <strong><CountUp value={stage.value} /></strong>
            </div>
          ))}
        </div>
        <div className="fss-insights is-inline">
          <div>
            <span className="fss-eyebrow">Finish rate</span>
            <p><b>{percent(started ? done / started : 0)}</b> of those who began watched to the end.</p>
          </div>
          {nextStarted !== null && (
            <div>
              <span className="fss-eyebrow">Into the next lecture</span>
              <p>{nextStarted >= started ? <>Every viewer carried on to lecture {after!.number}.</> : <><b>{count(started - nextStarted)}</b> students did not begin lecture {after!.number}.</>}</p>
            </div>
          )}
        </div>
      </motion.section>

      <motion.nav variants={rise} className="fss-neighbours" aria-label="Neighbouring lectures">
        {before && <LessonDoor lesson={before} onOpen={() => go({ room: 'course', path: lessonPath(section, before) })} />}
        {after && <LessonDoor lesson={after} onOpen={() => go({ room: 'course', path: lessonPath(section, after) })} />}
      </motion.nav>
    </motion.div>
  );
}

/* ─── Talent board ───────────────────────────────────────────────────────── */

export function StudentsRoom({ students }: { students: Student[] }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<'quiz' | 'completion'>('quiz');
  const shown = students
    .filter((s) => !group || groupOf(s) === group)
    .sort((a, b) => (sort === 'quiz' ? (b.quiz ?? -1) - (a.quiz ?? -1) : (b.completion ?? -1) - (a.completion ?? -1)));

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero is-room">
        <p className="fss-eyebrow">Talent board</p>
        <h1><CountUp value={students.length} /> students<br /><span>share their progress with you.</span></h1>
        <p className="fss-lede">Each point is one student: lectures completed across, quiz score up. Pick a group to see who is in it. Students who don’t share are counted in course totals only, never named.</p>
      </motion.header>

      <motion.section variants={rise} className="fss-panel">
        <TalentMap students={students} selected={selected} onSelect={(id) => setSelected(selected === id ? null : id)} group={group} onGroup={setGroup} />
        {group && <p className="fss-group-hint"><Sparkles size={14} aria-hidden="true" /> {GROUPS[group].hint}</p>}
      </motion.section>

      <motion.section variants={rise} className="fss-panel">
        <div className="fss-panel-head is-row">
          <h2>{group ? GROUPS[group].label : 'Everyone sharing'} <small>{shown.length}</small></h2>
          <div className="fss-segment" role="group" aria-label="Sort students">
            <button type="button" aria-pressed={sort === 'quiz'} onClick={() => setSort('quiz')}>By quiz score</button>
            <button type="button" aria-pressed={sort === 'completion'} onClick={() => setSort('completion')}>By lectures</button>
          </div>
        </div>
        <ol className="fss-roster">
          {shown.slice(0, 120).map((s, i) => (
            <li key={s.id} className={selected === s.id ? 'is-selected' : undefined} onClick={() => setSelected(selected === s.id ? null : s.id)}>
              <span className="fss-rank">{i + 1}</span>
              <span className="fss-avatar" aria-hidden="true">{s.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <span className="fss-roster-name">{s.name}<small className={`is-${groupOf(s)}`}>{GROUPS[groupOf(s)].label}</small></span>
              <span className="fss-roster-meter"><span className="fss-meter"><i style={{ width: `${s.completion ?? 0}%` }} /></span><small>{s.completion ?? 0}% of lectures</small></span>
              <span className="fss-roster-score">{s.quiz === null ? '—' : `${s.quiz}%`}<small>quiz</small></span>
            </li>
          ))}
        </ol>
        {shown.length > 120 && <p className="fss-muted">Showing the first 120. Narrow it with a group above.</p>}
      </motion.section>
    </motion.div>
  );
}

/* ─── Leads ──────────────────────────────────────────────────────────────── */

export function LeadsRoom({ contactable, courses, onExport }: { contactable: number; courses: CourseView[]; onExport: (filters: { courseId: string; minCompletion: number; minQuizScore: number }) => Promise<string | null> }) {
  const [courseId, setCourseId] = useState('');
  const [minCompletion, setMinCompletion] = useState(0);
  const [minQuizScore, setMinQuizScore] = useState(0);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [more, setMore] = useState(false);

  const run = async () => {
    setState('busy');
    try {
      setMore(!!(await onExport({ courseId, minCompletion, minQuizScore })));
      setState('done');
    } catch {
      setState('idle');
    }
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero is-room">
        <p className="fss-eyebrow">Leads</p>
        <h1><CountUp value={contactable} /> students<br /><span>said yes to a call.</span></h1>
        <p className="fss-lede">Only students who chose to share their contact details and verified their number by SMS. Anyone who withdraws leaves every later export.</p>
      </motion.header>

      <motion.section variants={rise} className="fss-panel fss-export">
        <div className="fss-panel-head">
          <h2>Build a call list</h2>
          <p>Progress filters apply only to students who also share progress. Each export is recorded with who made it and when.</p>
        </div>
        <div className="fss-export-grid">
          <label>
            <span className="fss-eyebrow">Course</span>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">All courses</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label>
            <span className="fss-eyebrow">Watched at least <b>{minCompletion}%</b></span>
            <input type="range" min={0} max={100} step={5} value={minCompletion} onChange={(e) => setMinCompletion(Number(e.target.value))} />
          </label>
          <label>
            <span className="fss-eyebrow">Quiz score at least <b>{minQuizScore}%</b></span>
            <input type="range" min={0} max={100} step={5} value={minQuizScore} onChange={(e) => setMinQuizScore(Number(e.target.value))} />
          </label>
        </div>
        <button type="button" className="fss-cta" onClick={() => void run()} disabled={state === 'busy'}>
          <Download size={16} aria-hidden="true" /> {state === 'busy' ? 'Preparing…' : 'Download call list (CSV)'}
        </button>
        {state === 'done' && <p className="fss-muted">Downloaded{more ? '. There are more: download again for the next page.' : '.'}</p>}
      </motion.section>
    </motion.div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function walkSection(course: Section, path: string[]): Section {
  let here = course;
  for (const id of path.slice(1)) {
    const next = here.children.find((c) => c.id === id);
    if (!next || next.kind === 'lesson') break;
    here = next;
  }
  return here;
}

function lessonPath(course: Section, lesson: Lesson): string[] {
  for (const subject of course.children) {
    if (subject.kind === 'lesson') continue;
    for (const topic of subject.children) {
      if (topic.kind === 'lesson') continue;
      if (topic.children.some((c) => c.id === lesson.id)) return [course.id, subject.id, topic.id, lesson.id];
    }
  }
  return [course.id];
}
