import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { count, GROUPS, groupOf, percent, type Group, type Lesson, type Student } from './model';

const EASE = [0.22, 1, 0.36, 1] as const;

/** A number that counts up the first time it is seen. Tabular figures, so it never jitters. */
export function CountUp({ value, format = count }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(0);
  const text = useTransform(motionValue, (n) => format(Math.round(n * 1000) / 1000));
  useEffect(() => {
    if (!seen) return;
    if (reduced) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration: 1.4, ease: EASE });
    return () => controls.stop();
  }, [seen, value, reduced, motionValue]);
  return <motion.span ref={ref} className="fss-num">{text}</motion.span>;
}

/**
 * Lesson by lesson, how many began it and how many finished it. The gap between the two areas is attention
 * lost inside a lesson; the slope is students lost between lessons. The biggest fall is marked.
 */
export function RetentionCurve({ lessons, onPick, mark }: { lessons: Lesson[]; onPick?: (lesson: Lesson) => void; mark?: Lesson | null }) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: '-15% 0px' });
  const [hover, setHover] = useState<number | null>(null);
  const width = 1000;
  const height = 280;
  const pad = 18;
  const max = Math.max(1, ...lessons.map((l) => l.stats.started));
  const x = (i: number) => (lessons.length < 2 ? width / 2 : pad + (i * (width - pad * 2)) / (lessons.length - 1));
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);

  const line = (pick: (l: Lesson) => number) => {
    if (!lessons.length) return '';
    return lessons
      .map((l, i) => {
        if (i === 0) return `M ${x(0)} ${y(pick(l))}`;
        const px = x(i - 1);
        const cx = (px + x(i)) / 2;
        return `C ${cx} ${y(pick(lessons[i - 1]))}, ${cx} ${y(pick(l))}, ${x(i)} ${y(pick(l))}`;
      })
      .join(' ');
  };
  const area = (pick: (l: Lesson) => number) => `${line(pick)} L ${x(lessons.length - 1)} ${height} L ${x(0)} ${height} Z`;

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - box.left) / box.width;
    const i = Math.round(((ratio * width - pad) / (width - pad * 2)) * (lessons.length - 1));
    setHover(Math.max(0, Math.min(lessons.length - 1, i)));
  };

  const current = hover === null ? null : lessons[hover];
  const markIndex = mark ? lessons.findIndex((l) => l.id === mark.id) : -1;

  return (
    <div ref={ref} className="fss-curve" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={() => current && onPick?.(current)} role="img"
      aria-label={`Lesson by lesson: ${lessons.map((l) => `lesson ${l.number}, ${l.stats.started} started, ${l.stats.done} finished`).join('; ')}`}>
      <div className="fss-curve-y" aria-hidden="true"><span>{count(max)} students</span><span>{count(Math.round(max / 2))}</span><span>0</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-start`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--fss-accent)" stopOpacity=".28" />
            <stop offset="1" stopColor="var(--fss-accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-done`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--fss-accent)" stopOpacity=".75" />
            <stop offset="1" stopColor="var(--fss-accent)" stopOpacity=".08" />
          </linearGradient>
          <clipPath id={`${id}-reveal`}>
            <motion.rect x="0" y="0" height={height} initial={{ width: reduced ? width : 0 }} animate={{ width: seen || reduced ? width : 0 }} transition={{ duration: 1.8, ease: EASE }} />
          </clipPath>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={width} y1={y(max * f)} y2={y(max * f)} stroke="var(--fss-line)" vectorEffect="non-scaling-stroke" />
        ))}
        <g clipPath={`url(#${id}-reveal)`}>
          <path d={area((l) => l.stats.started)} fill={`url(#${id}-start)`} />
          <path d={line((l) => l.stats.started)} fill="none" stroke="var(--fss-accent)" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          <path d={area((l) => l.stats.done)} fill={`url(#${id}-done)`} />
          <path d={line((l) => l.stats.done)} fill="none" stroke="var(--fss-accent)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        </g>
        {current && <line x1={x(hover!)} x2={x(hover!)} y1="0" y2={height} stroke="var(--fss-ink)" strokeOpacity=".35" vectorEffect="non-scaling-stroke" />}
      </svg>
      {markIndex >= 0 && (
        <span className="fss-curve-mark"
          style={{ left: `${(x(markIndex) / width) * 100}%`, top: `${(y(lessons[markIndex].stats.started) / height) * 100}%`, '--shift': markIndex / Math.max(1, lessons.length - 1) < 0.15 ? '-12px' : markIndex / Math.max(1, lessons.length - 1) > 0.85 ? 'calc(-100% + 12px)' : '-50%' } as CSSProperties}>
          Biggest fall after lesson {lessons[markIndex].number}
        </span>
      )}
      {current && (
        <div className="fss-curve-tip" style={{ left: `${(x(hover!) / width) * 100}%` }}>
          <img src={`https://i.ytimg.com/vi/${current.id}/mqdefault.jpg`} alt="" width={160} height={90} loading="lazy" />
          <b>Lesson {current.number}</b>
          <span>{current.title ?? 'Untitled lesson'}</span>
          <span className="fss-tip-row"><i className="is-start" /> {count(current.stats.started)} started <i className="is-done" /> {count(current.stats.done)} finished</span>
        </div>
      )}
      <div className="fss-curve-axis" aria-hidden="true">
        <span>Lesson 1</span>
        <span>Lesson {lessons.at(-1)?.number ?? 1}</span>
      </div>
    </div>
  );
}

/** A thin progress ring, drawn in on first sight. */
export function Ring({ value, size = 64, label }: { value: number; size?: number; label?: ReactNode }) {
  const ref = useRef<SVGSVGElement>(null);
  const seen = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const r = size / 2 - 4;
  const length = 2 * Math.PI * r;
  return (
    <span className="fss-ring" style={{ width: size, height: size }}>
      <svg ref={ref} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fss-line)" strokeWidth="3" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fss-accent)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={length} initial={{ strokeDashoffset: length }} animate={{ strokeDashoffset: seen || reduced ? length * (1 - Math.min(1, value)) : length }}
          transition={{ duration: reduced ? 0 : 1.3, ease: EASE }} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span>{label ?? percent(value)}</span>
    </span>
  );
}

/** A tiny curve of starts across a room's lessons, for its door. */
export function Spark({ lessons }: { lessons: Lesson[] }) {
  if (lessons.length < 2) return null;
  const max = Math.max(1, ...lessons.map((l) => l.stats.started));
  const points = lessons.map((l, i) => `${(i / (lessons.length - 1)) * 100},${30 - (l.stats.started / max) * 28}`).join(' ');
  return (
    <svg className="fss-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--fss-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A door: a large surface that catches a soft light where the pointer is, and lifts a little on hover. */
export function Door({ onOpen, children, className = '', style }: { onOpen: () => void; children: ReactNode; className?: string; style?: CSSProperties }) {
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - box.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - box.top}px`);
  };
  return (
    <motion.button type="button" className={`fss-door ${className}`} style={style} onClick={onOpen} onPointerMove={onMove}
      whileHover={{ y: -4 }} whileTap={{ scale: 0.985 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
      {children}
    </motion.button>
  );
}

/**
 * Every consenting student as a point: lectures completed across, quiz score up. The two guide lines split
 * the room into the four groups an institute acts on. Pick a point or a group to filter the list.
 */
export function TalentMap({ students, selected, onSelect, group, onGroup }: {
  students: Student[];
  selected: string | null;
  onSelect: (id: string) => void;
  group: Group | null;
  onGroup: (g: Group | null) => void;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: '-10% 0px' });
  const [hover, setHover] = useState<Student | null>(null);
  const plotted = students.filter((s) => s.completion !== null);
  const corners: { g: Group; style: CSSProperties }[] = [
    { g: 'talent', style: { left: 0, top: 0 } },
    { g: 'toppers', style: { right: 0, top: 0 } },
    { g: 'drifting', style: { left: 0, bottom: 0 } },
    { g: 'help', style: { right: 0, bottom: 0 } },
  ];
  return (
    <div ref={ref} className="fss-map">
      <div className="fss-map-plot">
        {corners.map(({ g, style }) => (
          <button type="button" key={g} className={`fss-map-zone is-${g}${group === g ? ' is-on' : ''}`} style={style} onClick={() => onGroup(group === g ? null : g)} aria-pressed={group === g}>
            <b>{GROUPS[g].label}</b>
            <span>{plotted.filter((s) => groupOf(s) === g).length}</span>
          </button>
        ))}
        {plotted.map((s, i) => {
          const g = groupOf(s);
          const dim = (group && group !== g) || (selected && selected !== s.id);
          return (
            <motion.button type="button" key={s.id} className={`fss-dot is-${g}${selected === s.id ? ' is-selected' : ''}`} aria-label={`${s.name}: ${s.completion}% of lectures, quiz ${s.quiz ?? 'none'}`}
              style={{ left: `${s.completion}%`, bottom: `${s.quiz ?? 0}%` }}
              initial={reduced ? false : { scale: 0, opacity: 0 }} animate={seen ? { scale: 1, opacity: dim ? 0.18 : 1 } : {}}
              transition={{ delay: reduced ? 0 : Math.min(1.2, i * 0.008), type: 'spring', stiffness: 260, damping: 18 }}
              onPointerEnter={() => setHover(s)} onPointerLeave={() => setHover(null)} onClick={() => onSelect(s.id)} />
          );
        })}
        {hover && (
          <div className="fss-map-tip" style={{ left: `${hover.completion}%`, bottom: `${hover.quiz ?? 0}%` }}>
            <b>{hover.name}</b>
            <span>{hover.completion}% of lectures · quiz {hover.quiz ?? '—'}{hover.quiz !== null ? '%' : ''}</span>
          </div>
        )}
      </div>
      <div className="fss-map-axes" aria-hidden="true">
        <span>↑ Quiz score · line at 70%</span>
        <span>Lectures done → · line at half</span>
      </div>
    </div>
  );
}

/**
 * How far students got in a course, as plain horizontal bars with the count and share printed on each.
 * Every bar is measured against the first, so the shortening is the drop-off.
 */
export function Journey({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const base = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="fss-journey">
      {steps.map((step, i) => (
        <div key={step.label} className="fss-journey-row">
          <div className="fss-journey-label">
            <b>{step.label}</b>
            {step.hint && <small>{step.hint}</small>}
          </div>
          <div className="fss-journey-track">
            <motion.i initial={{ width: 0 }} whileInView={{ width: percent(step.value / base) }} viewport={{ once: true }} transition={{ duration: 1.1, delay: i * 0.08, ease: EASE }} />
          </div>
          <div className="fss-journey-value">
            <strong><CountUp value={step.value} /></strong>
            <small>{i === 0 ? 'everyone' : percent(step.value / base)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lectures begun per day for four weeks, this week in full colour, with dates under the bars. */
export function DailyBars({ days }: { days: { day: string; started: number; done: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.started));
  const ticks = [0, Math.round(max / 2), max];
  const label = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <div className="fss-daily">
      <div className="fss-daily-y" aria-hidden="true">{[...ticks].reverse().map((t) => <span key={t}>{count(t)}</span>)}</div>
      <div className="fss-daily-plot" onPointerLeave={() => setHover(null)} role="img"
        aria-label={`Lectures begun per day: ${days.map((d) => `${label(d.day)} ${d.started}`).join(', ')}`}>
        {days.map((d, i) => {
          const thisWeek = i >= days.length - 7;
          return (
            <div key={d.day} className={`fss-daily-col${thisWeek ? ' is-now' : ''}`} onPointerEnter={() => setHover(i)}>
              <motion.span className="fss-daily-bar is-started" initial={{ height: 0 }} whileInView={{ height: percent(d.started / max) }} viewport={{ once: true }} transition={{ duration: 0.8, delay: i * 0.015, ease: EASE }} />
              <motion.span className="fss-daily-bar is-done" initial={{ height: 0 }} whileInView={{ height: percent(d.done / max) }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.2 + i * 0.015, ease: EASE }} />
              {hover === i && (
                <span className="fss-daily-tip">
                  <b>{new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</b>
                  {count(d.started)} begun · {count(d.done)} finished
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="fss-daily-x" aria-hidden="true">
        <span>{label(days[0].day)}</span>
        <span>Last week</span>
        <span>This week</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/** Eight weeks of study days, Monday at the top, darker for more lectures that day. */
export function StudyCalendar({ days }: { days: { day: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => days.slice(w * 7, w * 7 + 7));
  return (
    <div className="fss-calendar">
      <div className="fss-calendar-days" aria-hidden="true"><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span>Sun</span></div>
      <div className="fss-calendar-grid">
        {weeks.map((w, i) => (
          <div key={i} className="fss-calendar-week">
            {w.map((d) => (
              <span key={d.day} title={`${d.day}: ${d.count} lecture${d.count === 1 ? '' : 's'}`}
                style={{ '--level': d.count ? 0.25 + (0.75 * d.count) / max : 0 } as CSSProperties} className={d.count ? 'is-on' : undefined} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** When in the day the student studies, in four-hour blocks. */
export function HourBlocks({ hours }: { hours: number[] }) {
  const blocks = [
    { label: '4–8 am', value: hours.slice(4, 8) },
    { label: '8 am–12', value: hours.slice(8, 12) },
    { label: '12–4 pm', value: hours.slice(12, 16) },
    { label: '4–8 pm', value: hours.slice(16, 20) },
    { label: '8 pm–12', value: hours.slice(20, 24) },
    { label: '12–4 am', value: hours.slice(0, 4) },
  ].map((b) => ({ label: b.label, value: b.value.reduce((x, y) => x + y, 0) }));
  const max = Math.max(1, ...blocks.map((b) => b.value));
  return (
    <div className="fss-hours">
      {blocks.map((b) => (
        <div key={b.label}>
          <span className="fss-hours-track"><motion.i initial={{ height: 0 }} whileInView={{ height: percent(b.value / max) }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }} /></span>
          <small>{b.label}</small>
        </div>
      ))}
    </div>
  );
}

/** Quiz scores in the order they were taken, 0–100%, with the student's average as a line. */
export function QuizChart({ points }: { points: { at: number; percent: number; label: string; kind: 'institute' | 'quizme' }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <p className="fss-muted">No quiz scores shared yet.</p>;
  const avg = points.reduce((n, p) => n + p.percent, 0) / points.length;
  const x = (i: number) => (points.length === 1 ? 50 : 4 + (i * 92) / (points.length - 1));
  return (
    <div className="fss-quiz" onPointerLeave={() => setHover(null)}>
      <div className="fss-quiz-y" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
      <div className="fss-quiz-plot" role="img" aria-label={`Quiz scores in order: ${points.map((p) => `${p.percent}%`).join(', ')}. Average ${Math.round(avg)}%.`}>
        <span className="fss-quiz-avg" style={{ bottom: `${avg}%` }}><em>average {Math.round(avg)}%</em></span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points.map((p, i) => `${x(i)},${100 - p.percent}`).join(' ')} fill="none" stroke="var(--fss-accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {points.map((p, i) => (
          <button type="button" key={i} className={`fss-quiz-dot is-${p.kind}`} style={{ left: `${x(i)}%`, bottom: `${p.percent}%` }}
            onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} aria-label={`${p.label}: ${p.percent}%`} />
        ))}
        {hover !== null && (
          <span className="fss-quiz-tip" style={{ left: `${x(hover)}%`, bottom: `${points[hover].percent}%` }}>
            <b>{points[hover].percent}%</b> {points[hover].label}
            <small>{points[hover].kind === 'institute' ? 'Institute quiz' : 'Quiz me'} · {new Date(points[hover].at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
          </span>
        )}
      </div>
    </div>
  );
}
