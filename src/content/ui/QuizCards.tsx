import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import type { QuizDifficulty } from '@/learning/ai/actions';
import { nearDuplicate, parseQuiz, type QuizQuestion } from '@/learning/ai/quiz-format';
import { QUIZ_ROUND_QUESTIONS, quizBlocks, type QuizBlock } from '@/learning/ai/quiz-plan';
import { formatTimestamp } from '@/learning/knowledge/timestamps';
import { sendMessage } from '@/messaging/runtime';
import { openSignIn } from '@/ui/account/use-can-save';
import { RichText } from '@/ui/components/RichText';
import { LimitActions } from './LimitActions';

export type QuizMoreResult = { ok: true; text: string } | { ok: false; error: string; code?: string };

/** An option's text: plain words with `code` kept as code. Options are buttons, so no block elements. */
function OptionText({ text }: { text: string }) {
  return (
    <span className="fs-quiz-option-text">
      {text.split(/(`[^`\n]+`)/g).map((part, i) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : part))}
    </span>
  );
}

/** One card per question. Picking an option turns it green or red, marks the right one, and shows why. */
export function QuizCards({ questions, picked, onPick }: { questions: QuizQuestion[]; picked: Record<number, string>; onPick: (n: number, letter: string) => void }) {
  return (
    <>
      {questions.map((q) => {
        const choice = picked[q.n];
        const correct = q.answer?.letter;
        return (
          <section key={q.n} className="fs-quiz-card" aria-label={`Question ${q.n}`}>
            <div className="fs-quiz-q">
              <span className="fs-quiz-n">{q.n}</span>
              <RichText text={q.text} />
            </div>
            <div className="fs-quiz-options" role="group" aria-label={`Options for question ${q.n}`}>
              {q.options.map((o) => {
                const state = !choice ? '' : o.letter === correct ? 'is-right' : o.letter === choice ? 'is-wrong' : 'is-muted';
                return (
                  <button
                    key={o.letter}
                    type="button"
                    className={`fs-quiz-option ${state}${!correct && o.letter === choice ? ' is-picked' : ''}`}
                    disabled={!!choice}
                    aria-pressed={o.letter === choice}
                    onClick={() => onPick(q.n, o.letter)}
                  >
                    <span className="fs-quiz-letter">{state === 'is-right' ? <Check size={12} aria-label="Correct" /> : state === 'is-wrong' ? <X size={12} aria-label="Your answer" /> : o.letter}</span>
                    <OptionText text={o.text} />
                  </button>
                );
              })}
            </div>
            {choice && q.answer && (
              <p className={`fs-quiz-why ${choice === correct ? 'is-right' : 'is-wrong'}`}>
                <strong>{choice === correct ? 'Correct.' : `Not quite, it’s ${correct}.`}</strong>
                {q.answer.reason ? ` ${q.answer.reason}` : ''}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

const DIFFICULTIES: { id: QuizDifficulty; label: string }[] = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

/** The quiz lengths offered; batches of `QUIZ_ROUND_QUESTIONS` add up to each. */
export const QUIZ_COUNTS = [5, 10, 15, 20] as const;

const span = (b: QuizBlock) => `${formatTimestamp(b.startSec)}–${formatTimestamp(b.endSec)}`;

/**
 * "Quiz me": first how many questions (5–20; on-device as many as you like, FocusSpace's AI within the
 * plan's monthly allowance) and the part to be quizzed on, then that many per 15 minutes of it, one
 * round at a time. "Next questions" walks forward through the
 * video, so nothing is written (or paid for) before it is asked for. Choosing a difficulty and keeping
 * score come with a paid plan (`extras`).
 */
export function QuizSession({
  watchedSec,
  durationSec,
  needsAccount,
  signedIn,
  extras,
  onRound,
  onDevice = false,
  remaining = null,
}: {
  watchedSec: number;
  durationSec: number | null;
  /** FocusSpace's own AI: Quiz me needs an account there. */
  needsAccount: boolean;
  signedIn: boolean | undefined;
  extras: boolean;
  onRound: (block: QuizBlock, difficulty: QuizDifficulty | undefined, previous: string[]) => Promise<QuizMoreResult>;
  /** Answered by Chrome's on-device model: as many questions as the learner likes, free. */
  onDevice?: boolean;
  /** Questions left this month on FocusSpace's AI (the plan's rule); `null` when there is no ceiling. */
  remaining?: number | null;
}) {
  const [blocks, setBlocks] = useState<QuizBlock[] | null>(null);
  // How many questions a round asks. Batches of five are written one after another (each told what was
  // already asked), so the server meters exactly as before and a free plan's limit still holds.
  const allowed = (n: number) => remaining === null || remaining === undefined || n <= Math.max(QUIZ_ROUND_QUESTIONS, remaining);
  const [count, setCount] = useState(() => [15, 10, 5].find(allowed) ?? QUIZ_ROUND_QUESTIONS);
  const [progress, setProgress] = useState<{ got: number; want: number } | null>(null);
  // The allowance arrives after the panel opens: never leave a length chosen that the plan can't cover.
  useEffect(() => {
    if (!allowed(count)) setCount([...QUIZ_COUNTS].reverse().find(allowed) ?? QUIZ_ROUND_QUESTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('medium');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [rounds, setRounds] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  if (needsAccount && signedIn === false) {
    return (
      <p className="fs-answer-note">
        Sign in to use Quiz me. A free account includes quiz questions every month.{' '}
        <button type="button" className="fs-link" onClick={openSignIn}>
          Sign in
        </button>
      </p>
    );
  }

  async function round(all: QuizBlock[], index: number, asked: QuizQuestion[]) {
    setLoading(true);
    setError(null);
    const start = asked.length;
    let list = asked;
    let empty = 0;
    setProgress({ got: 0, want: count });
    // One round = `count` questions on this part of the video, written five at a time.
    while (list.length - start < count && empty < 2) {
      const result = await onRound(all[index], extras ? difficulty : undefined, list.map((q) => q.text.split('\n')[0]));
      if (!result.ok) {
        setError({ text: result.error, code: result.code });
        break;
      }
      const fresh = (parseQuiz(result.text) ?? [])
        .filter((q, i, batch) => !list.some((old) => nearDuplicate(old.text, q.text)) && !batch.slice(0, i).some((p) => nearDuplicate(p.text, q.text)))
        .slice(0, count - (list.length - start));
      if (!fresh.length) {
        empty++;
        continue;
      }
      empty = 0;
      list = [...list, ...fresh.map((q, i) => ({ ...q, n: list.length + i + 1 }))];
      setQuestions(list);
      setProgress({ got: list.length - start, want: count });
    }
    setLoading(false);
    setProgress(null);
    setRounds(index + 1);
    if (list.length === start) {
      setError((e) => e ?? { text: 'No new questions came out of this part. Try the next one.' });
      return;
    }
    // Bring the first new question into view inside the answer's own scroll area, never the page.
    if (start) {
      requestAnimationFrame(() => {
        const card = rootRef.current?.querySelectorAll<HTMLElement>('.fs-quiz-card')[start];
        const scroller = rootRef.current?.closest<HTMLElement>('.fs-answer-body');
        if (card && scroller) scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
      });
    }
  }

  if (!blocks) {
    const watched = quizBlocks(0, watchedSec);
    const full = durationSec ? quizBlocks(0, durationSec) : [];
    const choice = (label: string, detail: string, list: QuizBlock[], disabledNote: string) => (
      <button
        type="button"
        className="fs-quiz-choice"
        disabled={!list.length}
        onClick={() => {
          setBlocks(list);
          void round(list, 0, []);
        }}
      >
        <strong>{label}</strong>
        <span>{list.length ? `${detail} · ${list.length > 1 ? `${list.length} parts of ${count} questions` : `${count} questions`}` : disabledNote}</span>
      </button>
    );
    return (
      <div className="fs-quiz">
        <div className="fs-quiz-count">
          <span className="fs-quiz-count-label">How many questions?</span>
          <div className="fs-quiz-level" role="radiogroup" aria-label="How many questions">
            {QUIZ_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                disabled={!allowed(n)}
                title={allowed(n) ? undefined : `Your plan has ${remaining} quiz questions left this month`}
                className={`fs-quiz-level-btn${count === n ? ' is-active' : ''}`}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
          {onDevice ? (
            <span className="fs-quiz-count-note">On-device AI: as many as you like, free.</span>
          ) : remaining !== null && remaining !== undefined ? (
            <span className="fs-quiz-count-note">
              {remaining} left this month on your plan.{' '}
              {remaining < 20 && (
                <button type="button" className="fs-link" onClick={() => void sendMessage('site/open', { path: '/pricing' })}>
                  Get more
                </button>
              )}
            </span>
          ) : null}
        </div>
        <div className="fs-quiz-choices">
          {choice('Watched so far', `0:00–${formatTimestamp(watchedSec)}`, watched, 'Watch at least a minute first')}
          {choice('Full video', durationSec ? formatTimestamp(durationSec) : '', full, 'Video length not known yet')}
        </div>
        {extras ? (
          <div className="fs-quiz-level" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <button key={d.id} type="button" role="radio" aria-checked={difficulty === d.id} className={`fs-quiz-level-btn${difficulty === d.id ? ' is-active' : ''}`} onClick={() => setDifficulty(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
        ) : (
          needsAccount && (
            <p className="fs-quiz-upsell">
              Choosing a difficulty and keeping score come with Plus.{' '}
              <button type="button" className="fs-link" onClick={() => void sendMessage('site/open', { path: '/pricing' })}>
                See plans
              </button>
            </p>
          )
        )}
      </div>
    );
  }

  const answered = questions.filter((q) => q.answer && picked[q.n]);
  const right = answered.filter((q) => picked[q.n] === q.answer!.letter).length;
  const next = rounds < blocks.length ? blocks[rounds] : null;
  const finished = !next && !loading && answered.length === questions.length && questions.length > 0;

  return (
    <div ref={rootRef} className="fs-quiz">
      {!questions.length && loading && (
        <div aria-busy="true">
          <p className="fs-answer-note">
            Writing and checking {count} questions on {span(blocks[0])}… {progress && progress.got > 0 ? `${progress.got} ready` : ''}
          </p>
          <div className="fs-skeleton" style={{ height: 12, width: '90%', marginTop: 10 }} />
          <div className="fs-skeleton" style={{ height: 12, width: '70%', marginTop: 8 }} />
        </div>
      )}
      <QuizCards questions={questions} picked={picked} onPick={(n, letter) => setPicked((p) => ({ ...p, [n]: letter }))} />

      {(questions.length > 0 || error) && (
        <div className="fs-quiz-foot">
          {extras && answered.length > 0 && (
            <span className="fs-quiz-score">
              {finished ? `Score ${right}/${answered.length} (${Math.round((right / answered.length) * 100)}%)` : `${right} of ${answered.length} right`}
            </span>
          )}
          {next ? (
            <button type="button" className="fs-quiz-more" onClick={() => void round(blocks, rounds, questions)} disabled={loading}>
              {loading ? <Loader2 size={14} className="fs-spin" aria-hidden /> : <Plus size={14} aria-hidden />}
              {loading ? `Writing and checking… ${progress ? `${progress.got}/${progress.want}` : ''}` : `Next ${count} questions · ${span(next)}`}
            </button>
          ) : (
            !loading && questions.length > 0 && <span className="fs-quiz-score">That covers the part you chose.</span>
          )}
        </div>
      )}
      {error && (
        <p className={`fs-answer-note${error.code === 'quota_exceeded' ? '' : ' fs-error'}`}>
          {error.text}
          {error.code === 'quota_exceeded' && <LimitActions />}
          {error.code !== 'quota_exceeded' && !questions.length && (
            <button type="button" className="fs-link" onClick={() => void round(blocks, rounds, questions)}>
              Try again
            </button>
          )}
        </p>
      )}
    </div>
  );
}
