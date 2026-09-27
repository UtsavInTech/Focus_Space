import { useRef, useState } from 'react';
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

const span = (b: QuizBlock) => `${formatTimestamp(b.startSec)}–${formatTimestamp(b.endSec)}`;

/**
 * "Quiz me": first the part to be quizzed on (what has been watched so far, or the full video), then five
 * questions per 15 minutes of it, one round at a time. "Next 5 questions" walks forward through the
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
}: {
  watchedSec: number;
  durationSec: number | null;
  /** FocusSpace's own AI: Quiz me needs an account there. */
  needsAccount: boolean;
  signedIn: boolean | undefined;
  extras: boolean;
  onRound: (block: QuizBlock, difficulty: QuizDifficulty | undefined, previous: string[]) => Promise<QuizMoreResult>;
}) {
  const [blocks, setBlocks] = useState<QuizBlock[] | null>(null);
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
    const result = await onRound(all[index], extras ? difficulty : undefined, asked.map((q) => q.text.split('\n')[0]));
    setLoading(false);
    if (!result.ok) return setError({ text: result.error, code: result.code });
    const fresh = (parseQuiz(result.text) ?? []).filter((q, i, list) => !asked.some((old) => nearDuplicate(old.text, q.text)) && !list.slice(0, i).some((p) => nearDuplicate(p.text, q.text)));
    setRounds(index + 1);
    if (!fresh.length) return setError({ text: 'No new questions came out of this part. Try the next one.' });
    const start = asked.length;
    setQuestions([...asked, ...fresh.map((q, i) => ({ ...q, n: start + i + 1 }))]);
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
        <span>{list.length ? `${detail} · up to ${list.length * QUIZ_ROUND_QUESTIONS} questions` : disabledNote}</span>
      </button>
    );
    return (
      <div className="fs-quiz">
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
          <p className="fs-answer-note">Writing and checking questions on {span(blocks[0])}…</p>
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
              {loading ? 'Writing and checking…' : `Next ${QUIZ_ROUND_QUESTIONS} questions · ${span(next)}`}
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
