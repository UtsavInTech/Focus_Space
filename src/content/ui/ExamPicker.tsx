import { useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { EXAMS, type ExamId } from '@/modes/exams';
import { chooseExam, skipExam, SpaceLimitError } from '@/modes/service';
import { SpaceIcon } from '@/ui/icons';

/**
 * "Which exam are you preparing for?" — the first question FocusSpace asks. One tap builds the exam's
 * Space (its subjects as topics, its vocabulary for relevance) and makes it the whole of YouTube.
 * Not preparing for one is an equal answer, not a small link: it goes on to the general picker.
 */
export function ExamPicker({ onPick, onChosen, onSkip, compact = false }: { onPick?: (id: ExamId) => void; onChosen?: (id: ExamId) => void; onSkip?: () => void; compact?: boolean }) {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState<ExamId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (id: ExamId) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    onPick?.(id);
    try {
      await chooseExam(id);
      onChosen?.(id);
    } catch (err) {
      setError(err instanceof SpaceLimitError ? err.message : 'FocusSpace couldn’t set that up. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    await skipExam();
    onSkip?.();
  };

  return (
    <div className={`fs-exams${compact ? ' is-compact' : ''}`}>
      <m.div
        className="fs-exam-grid"
        initial="hidden"
        animate="shown"
        variants={{ hidden: {}, shown: { transition: { staggerChildren: reduce ? 0 : 0.045 } } }}
      >
        {EXAMS.map((exam) => (
          <m.button
            key={exam.id}
            type="button"
            className="fs-exam-card"
            aria-busy={busy === exam.id}
            disabled={!!busy}
            onClick={() => void pick(exam.id)}
            variants={{ hidden: reduce ? {} : { opacity: 0, y: 14, scale: 0.97 }, shown: { opacity: 1, y: 0, scale: 1 } }}
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
      {error && (
        <p className="fs-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="fs-link fs-exam-skip" onClick={() => void skip()} disabled={!!busy}>
        I’m not preparing for an exam
      </button>
    </div>
  );
}
