import { useMemo, useState } from 'react';
import { BarChart3, Check, MessageCircle, Send } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import { useStorage } from '@/ui/hooks';
import { sendMessage } from '@/messaging/runtime';
import { Modal } from '@/ui/components/Modal';
import type { Lesson } from '@/institutes/home';
import { duration, studentReport } from '@/institutes/student-report';
import { useLessonInfo } from './lesson-title';

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The student's own progress and quiz report for this course, from their watch history and the quiz scores
 * kept on this device, plus the one way to reach the faculty: "Talk to your faculty". Seeing the report never
 * shares anything; the line under it says what the institute can see.
 */
export function YourReport({ mode, lessons }: { mode: LearningMode; lessons: Lesson[] }) {
  const store = useStorage(['watchHistory', 'instituteCache'] as const);
  const source = mode.source!;
  const cached = store?.instituteCache.courses[mode.id];
  const now = Date.now();
  const report = useMemo(
    () => studentReport(store?.watchHistory, mode.id, lessons, cached?.scores, now),
    [store?.watchHistory, cached?.scores, mode.id, lessons], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nextInfo = useLessonInfo(report.next?.videoId ?? '', report.next ? `Lesson ${report.next.number}` : '');
  const [asking, setAsking] = useState(false);
  if (!store) return null;

  const share = report.total ? report.done / report.total : 0;
  const weekStart = (new Date(now + 330 * 60000).getUTCDay() + 6) % 7; // today's weekday, Monday = 0
  const labels = Array.from({ length: 7 }, (_, i) => WEEKDAY[(weekStart - 6 + i + 14) % 7]);

  return (
    <section className="fs-section fs-your-report" aria-labelledby="fs-your-report">
      <div className="fs-section-head">
        <h2 id="fs-your-report"><BarChart3 size={20} aria-hidden /> Your report</h2>
        <span>{source.progressConsent ? `${source.orgName} can see this too.` : `Only you can see this. ${source.orgName} sees course totals.`}</span>
      </div>

      <div className="fs-report-grid">
        <div className="fs-report-card is-wide">
          <span className="fs-report-label">Where you are</span>
          <strong>{report.current ? `Lesson ${report.current.number} of ${report.total}` : `Not started · ${report.total} lessons`}</strong>
          <div className="fs-report-bar" aria-label={`${report.done} of ${report.total} lessons finished`}>
            {lessons.map((l) => {
              const done = l.number <= report.total && store.watchHistory.some((e) => e.modeId === mode.id && e.videoId === l.videoId && e.progress >= 0.9);
              return <i key={l.videoId} className={done ? 'is-done' : report.current?.videoId === l.videoId ? 'is-here' : undefined} />;
            })}
          </div>
          <small>{report.done} finished ({Math.round(share * 100)}%){report.next ? ` · next: ${nextInfo.title}` : ' · course complete'}</small>
        </div>

        <div className="fs-report-card">
          <span className="fs-report-label">Time in lessons</span>
          <strong>{duration(report.seconds)}</strong>
          <small>{report.study.daysLast28 ? `${report.study.daysLast28} study day${report.study.daysLast28 === 1 ? '' : 's'} in the last 4 weeks` : 'Your study days will show here'}</small>
        </div>

        <div className="fs-report-card">
          <span className="fs-report-label">Quizzes</span>
          <strong>{report.quiz.average === null ? '—' : `${report.quiz.average}%`}</strong>
          {report.quiz.recent.length > 1 && (
            <svg className="fs-report-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
              <polyline points={report.quiz.recent.map((p, i) => `${(i / (report.quiz.recent.length - 1)) * 100},${30 - (p / 100) * 28}`).join(' ')} />
            </svg>
          )}
          <small>{report.quiz.count ? `Average of ${report.quiz.count} quiz${report.quiz.count === 1 ? '' : 'zes'}${report.quiz.trend === 'rising' ? ', and rising' : report.quiz.trend === 'falling' ? ', and slipping' : ''}` : 'Take Quiz me or an institute quiz after a lesson'}</small>
        </div>

        <div className="fs-report-card">
          <span className="fs-report-label">This week</span>
          <div className="fs-report-week" aria-label={`Studied on ${report.study.week.filter(Boolean).length} of the last 7 days`}>
            {report.study.week.map((on, i) => (
              <span key={i}><i className={on ? 'is-on' : undefined} />{labels[i]}</span>
            ))}
          </div>
          <small>{report.study.streak > 1 ? `${report.study.streak}-day streak` : report.study.usualTime ? `You study mostly in the ${report.study.usualTime}` : 'A little every day adds up'}</small>
        </div>
      </div>

      <div className="fs-report-talk">
        <div>
          <b>Stuck, or want to talk about the course?</b>
          <span>{cached?.contactRequestedAt ? `Request sent. ${source.orgName} will call you on your registered number.` : `${source.orgName} sees your request first and calls you on your registered number.`}</span>
        </div>
        <button type="button" className="fs-cta fs-cta-primary" onClick={() => setAsking(true)}>
          {cached?.contactRequestedAt ? <Check size={16} aria-hidden /> : <MessageCircle size={16} aria-hidden />} {cached?.contactRequestedAt ? 'Ask again' : 'Talk to your faculty'}
        </button>
      </div>

      <Modal open={asking} onClose={() => setAsking(false)} title={`Talk to ${source.orgName}`} width={480}>
        <TalkForm modeId={mode.id} orgName={source.orgName} onDone={() => setAsking(false)} />
      </Modal>
    </section>
  );
}

function TalkForm({ modeId, orgName, onDone }: { modeId: string; orgName: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const send = async () => {
    setState('sending');
    setError('');
    try {
      await sendMessage('institutes/contact', { modeId, note });
      setState('sent');
      setTimeout(onDone, 1400);
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };
  if (state === 'sent') return <p className="fs-report-sent"><Check size={18} aria-hidden /> Sent. {orgName} will call you on your registered number.</p>;
  return (
    <div className="fs-report-form">
      <p>{orgName} gets your request straight away, with your name and number. Add a line if you like.</p>
      <textarea className="fs-input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: I’m stuck on Fundamental Rights. Please call after 6 pm." />
      {error && <p className="fs-error" role="alert">{error}</p>}
      <button type="button" className="fs-cta fs-cta-primary" disabled={state === 'sending'} onClick={() => void send()}>
        <Send size={16} aria-hidden /> {state === 'sending' ? 'Sending…' : 'Send request'}
      </button>
    </div>
  );
}
