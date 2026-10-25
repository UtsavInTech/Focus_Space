import { motion } from 'motion/react';
import { ArrowUpRight, BookOpen, Layers, ListChecks, PlayCircle } from 'lucide-react';
import { CountUp, Door, Journey, RetentionCurve, Ring, Spark } from './charts';
import { count, percent, summarise, type Lesson, type Place, type Section } from './model';

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

function journeySteps(t: Totals) {
  return [
    { label: 'Joined', value: t.joined ?? 0, hint: 'Enrolled in this course' },
    { label: 'Began a lecture', value: t.started ?? 0, hint: 'Pressed play at least once' },
    { label: 'Got halfway through one', value: t.half ?? 0 },
    { label: 'Finished a lecture', value: t.done ?? 0, hint: 'Watched at least one to the end' },
  ];
}

/* ─── Courses: one door per course ──────────────────────────────────────── */

export function CoursesPage({ courses, go }: { courses: CourseView[]; go: (p: Place) => void }) {
  return (
    <motion.div variants={stagger} initial="hidden" animate="shown">
      <motion.header variants={rise} className="fss-hero is-room">
        <p className="fss-eyebrow">Courses</p>
        <h1>Choose a door.</h1>
        <p className="fss-lede">Each course opens into its subjects, topics and lectures, with what students did in each.</p>
      </motion.header>
      <motion.div variants={rise} className="fss-doors is-wide">
        {courses.map((course) => {
          const summary = course.section ? summarise(course.section.lessons) : null;
          const cover = course.section?.lessons[0]?.id;
          return (
            <Door key={course.id} className="is-course" onOpen={() => go({ room: 'course', path: [course.id] })}>
              {cover && <img className="fss-door-cover" src={thumb(cover, 'hq')} alt="" loading="lazy" />}
              <span className="fss-door-kind">{course.kind === 'batch' ? 'Batch course' : 'Free course'}</span>
              <h3>{course.title}</h3>
              <div className="fss-door-stats">
                <span><b>{count(course.totals?.joined ?? 0)}</b> students</span>
                <span><b>{summary?.lessons ?? 0}</b> lectures</span>
                {summary && <span><b>{percent(summary.completionRate)}</b> of plays watched to the end</span>}
              </div>
              <ArrowUpRight className="fss-door-arrow" size={20} aria-hidden="true" />
            </Door>
          );
        })}
      </motion.div>
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
            <h2>{percent((course.totals.done ?? 0) / Math.max(1, course.totals.joined ?? 0))} of students have finished at least one lecture</h2>
            <p>Everyone enrolled is counted, whether or not they share their progress. {count(course.totals.shared_progress ?? 0)} share progress; {count(course.totals.shared_contact ?? 0)} asked to be contacted.</p>
          </div>
          <Journey steps={journeySteps(course.totals)} />
        </motion.section>
      )}

      {here.lessons.length > 1 && (
        <motion.section variants={rise} className="fss-panel">
          <div className="fss-panel-head">
            <h2>Of {count(here.lessons[0].stats.started)} who began lecture {here.lessons[0].number}, {count(here.lessons.at(-1)!.stats.started)} reached lecture {here.lessons.at(-1)!.number}</h2>
            <p>Students per lecture, in your order. <i className="fss-key is-start" /> began it <i className="fss-key is-done" /> watched it to the end. Point at a lecture to see it; click to open it.</p>
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
