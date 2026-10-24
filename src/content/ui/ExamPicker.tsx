import { useMemo, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { asked, buildExamMode, defaultAnswers, EXAM_GROUPS, EXAMS, EXCLUDE, examCreators, examInfo, type ExamAnswers, type ExamId, type ExamInfo } from '@/modes/exams';
import { chooseExam, skipExam, SpaceLimitError } from '@/modes/service';
import { SpaceIcon } from '@/ui/icons';
import { ChannelPicker, type PickedChannel } from '@/ui/components/ChannelPicker';

/**
 * "Which exam are you preparing for?" — FocusSpace's first question, as a short guided setup:
 *
 *   1. the goal (grouped: government jobs · entrance exams · B.Tech & engineering)
 *   2. its own questions — UPSC's optional subject, which SSC exam, the state commission, branch & year
 *   3. the Space it will build, as a hierarchy (Prelims → Polity…, Optional → Sociology), and the
 *      creators to start with — popular ones a tap away — then Create
 *
 * Not preparing for one is an equal answer: it goes on to the general picker.
 */

type Step = { kind: 'pick' } | { kind: 'ask'; exam: ExamInfo } | { kind: 'review'; exam: ExamInfo };

const EASE = [0.2, 0, 0, 1] as const;

export function ExamPicker({
  onPick,
  onChosen,
  onSkip,
  compact = false,
  initialExam,
}: {
  /** The goal was confirmed — the setup chat writes "I'm preparing for UPSC" here. */
  onPick?: (id: ExamId, label: string) => void;
  onChosen?: (id: ExamId) => void;
  onSkip?: () => void;
  compact?: boolean;
  /** Start straight at this goal's questions (the learner typed or said it). */
  initialExam?: ExamId | null;
}) {
  const reduce = useReducedMotion();
  const start = initialExam ? examInfo(initialExam) : null;
  const [step, setStep] = useState<Step>(start ? (start.questions.length ? { kind: 'ask', exam: start } : { kind: 'review', exam: start }) : { kind: 'pick' });
  const [answers, setAnswers] = useState<ExamAnswers>(start ? defaultAnswers(start) : {});
  const [channels, setChannels] = useState<PickedChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (exam: ExamInfo) => {
    setAnswers(defaultAnswers(exam));
    setChannels([]);
    setError(null);
    setStep(exam.questions.length ? { kind: 'ask', exam } : { kind: 'review', exam });
  };

  const create = async (exam: ExamInfo) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onPick?.(exam.id, buildExamMode(exam.id, answers).name);
    try {
      await chooseExam(exam.id, answers, channels.map((c) => ({ id: c.id, title: c.title, handle: c.handle ?? undefined })));
      onChosen?.(exam.id);
    } catch (err) {
      setError(err instanceof SpaceLimitError ? err.message : 'FocusSpace couldn’t set that up. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    await skipExam();
    onSkip?.();
  };

  const motionStep = {
    initial: reduce ? false : { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0 },
    exit: reduce ? undefined : { opacity: 0, x: -24 },
    transition: { duration: 0.28, ease: EASE },
  } as const;

  return (
    <div className={`fs-exams${compact ? ' is-compact' : ''}`}>
      <AnimatePresence mode="wait" initial={false}>
        {step.kind === 'pick' && (
          <m.div key="pick" className="fs-exam-step" {...motionStep}>
            {EXAM_GROUPS.map((group) => (
              <div key={group.id} className="fs-exam-group">
                <div className="fs-exam-group-head">
                  <b>{group.label}</b>
                  {!compact && <small>{group.hint}</small>}
                </div>
                <m.div className="fs-exam-grid" initial="hidden" animate="shown" variants={{ hidden: {}, shown: { transition: { staggerChildren: reduce ? 0 : 0.035 } } }}>
                  {EXAMS.filter((e) => e.group === group.id).map((exam) => (
                    <m.button
                      key={exam.id}
                      type="button"
                      className="fs-exam-card"
                      onClick={() => choose(exam)}
                      variants={{ hidden: reduce ? {} : { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } }}
                      whileHover={reduce ? undefined : { y: -4 }}
                      whileTap={reduce ? undefined : { scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                    >
                      <span className="fs-exam-icon">
                        <SpaceIcon name={exam.icon} size={compact ? 18 : 22} />
                      </span>
                      <span className="fs-exam-text">
                        <b>{exam.label}</b>
                        {!compact && <small>{exam.covers}</small>}
                      </span>
                      <ArrowRight className="fs-exam-go" size={16} aria-hidden />
                    </m.button>
                  ))}
                </m.div>
              </div>
            ))}
            <button type="button" className="fs-link fs-exam-skip" onClick={() => void skip()}>
              I’m not preparing for an exam
            </button>
          </m.div>
        )}

        {step.kind === 'ask' && (
          <m.div key={`ask-${step.exam.id}`} className="fs-exam-step" {...motionStep}>
            <StepHead exam={step.exam} onBack={() => setStep({ kind: 'pick' })} />
            {step.exam.questions.filter((q) => asked(q, step.exam, answers)).map((q) => (
              <fieldset key={q.id} className="fs-exam-question">
                <legend>{q.prompt}</legend>
                {q.help && <p className="fs-exam-help">{q.help}</p>}
                <div className="fs-exam-options" role={q.multi ? 'group' : 'radiogroup'}>
                  {q.options.map((o) => {
                    const on = (answers[q.id] ?? []).includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role={q.multi ? 'checkbox' : 'radio'}
                        aria-checked={on}
                        className="fs-exam-option"
                        onClick={() =>
                          setAnswers((a) => {
                            const cur = a[q.id] ?? [];
                            if (!q.multi) return { ...a, [q.id]: [o.id] };
                            const next = cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id];
                            // Years need at least one; skills may be none at all.
                            return { ...a, [q.id]: next.length || q.id.startsWith('skills') ? next : cur };
                          })
                        }
                      >
                        {on && <Check size={14} aria-hidden />}
                        {o.label}
                        {o.hint && <small>{o.hint}</small>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <div className="fs-exam-actions">
              <button type="button" className="fs-cta fs-cta-primary" onClick={() => setStep({ kind: 'review', exam: step.exam })}>
                Next <ArrowRight size={18} aria-hidden />
              </button>
            </div>
          </m.div>
        )}

        {step.kind === 'review' && (
          <m.div key={`review-${step.exam.id}`} className="fs-exam-step" {...motionStep}>
            <StepHead exam={step.exam} onBack={() => setStep(step.exam.questions.length ? { kind: 'ask', exam: step.exam } : { kind: 'pick' })} />
            <SpacePreview exam={step.exam} answers={answers} compact={compact} onToggle={(id) => setAnswers((a) => ({ ...a, [EXCLUDE]: (a[EXCLUDE] ?? []).includes(id) ? (a[EXCLUDE] ?? []).filter((x) => x !== id) : [...(a[EXCLUDE] ?? []), id] }))} />
            <div className="fs-exam-creators">
              <div className="fs-exam-question-title">Add teachers you like</div>
              <p className="fs-exam-help">Optional. They come first in your Space. You can skip this and FocusSpace finds good ones on its own.</p>
              <ChannelPicker
                selected={channels}
                onChange={setChannels}
                mode={buildExamMode(step.exam.id, answers)}
                creators={{ names: examCreators(step.exam, answers), label: `Popular for ${buildExamMode(step.exam.id, answers).name}` }}
              />
            </div>
            {error && (
              <p className="fs-error" role="alert">
                {error}
              </p>
            )}
            <div className="fs-exam-actions">
              <button type="button" className="fs-cta fs-cta-primary" disabled={busy} onClick={() => void create(step.exam)}>
                {busy ? 'Setting it up…' : channels.length ? `Create my Space with ${channels.length} ${channels.length === 1 ? 'teacher' : 'teachers'}` : 'Create my Space'}
                <ArrowRight size={18} aria-hidden />
              </button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepHead({ exam, onBack }: { exam: ExamInfo; onBack: () => void }) {
  return (
    <div className="fs-exam-stephead">
      <button type="button" className="fs-icon-plain" aria-label="Back" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden />
      </button>
      <span className="fs-exam-icon">
        <SpaceIcon name={exam.icon} size={18} />
      </span>
      <span className="fs-exam-text">
        <b>{exam.label}</b>
        <small>{exam.covers}</small>
      </span>
    </div>
  );
}

/**
 * The Space about to be built, as its hierarchy: each stage or year, then its subjects, each with its
 * subtopics. Tapping a subject leaves it out ("I don't study this one") or brings it back.
 */
function SpacePreview({ exam, answers, compact, onToggle }: { exam: ExamInfo; answers: ExamAnswers; compact: boolean; onToggle: (topicId: string) => void }) {
  // Everything that could be in the Space, so a subject switched off stays on screen to switch back on.
  const all = useMemo(() => buildExamMode(exam.id, { ...answers, [EXCLUDE]: [] }), [exam.id, answers]);
  const off = new Set(answers[EXCLUDE] ?? []);
  const groups = useMemo(() => {
    const out = new Map<string, typeof all.topics>();
    for (const t of all.topics) out.set(t.group ?? 'Topics', [...(out.get(t.group ?? 'Topics') ?? []), t]);
    return [...out];
  }, [all]);
  const kept = all.topics.filter((t) => !off.has(t.id)).length;
  const subtopics = (t: (typeof all.topics)[number]) => t.keywords.filter((k) => !k.startsWith('~') && k !== t.name.toLowerCase());
  return (
    <div className="fs-exam-preview">
      <div className="fs-exam-preview-head">
        <SpaceIcon name={all.icon} size={16} />
        <b>Your {all.name} Space</b>
        <small>
          {kept} of {all.topics.length} topics · tap one to leave it out
        </small>
      </div>
      <ol className="fs-exam-tree">
        {groups.map(([group, topics]) => (
          <li key={group}>
            <span className="fs-exam-tree-group">{group}</span>
            <span className="fs-exam-tree-topics">
              {topics.map((t) => {
                const subs = subtopics(t);
                return (
                  <button key={t.id} type="button" className="fs-exam-tree-topic" aria-pressed={!off.has(t.id)} onClick={() => onToggle(t.id)} title={subs.length ? `Subtopics: ${subs.join(', ')}` : t.name}>
                    {!off.has(t.id) && <Check size={12} aria-hidden />}
                    <span>
                      {t.name}
                      {!compact && subs.length > 0 && <small>{subs.slice(0, 4).join(' · ')}{subs.length > 4 ? ` +${subs.length - 4}` : ''}</small>}
                    </span>
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
