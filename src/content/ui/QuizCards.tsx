import { useRef, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { parseQuiz, type QuizQuestion } from '@/learning/ai/quiz-format';
import { RichText } from '@/ui/components/RichText';
import { LimitActions } from './LimitActions';

export type QuizMoreResult = { ok: true; text: string } | { ok: false; error: string; code?: string };

/** Where the next "More questions" round draws from: the part being taught, then the whole video. */
export const moreScope = (round: number, hasSection: boolean): 'section' | 'video' => (round === 1 && hasSection ? 'section' : 'video');

/** An option's text: plain words with `code` kept as code. Options are buttons, so no block elements. */
function OptionText({ text }: { text: string }) {
  return (
    <span className="fs-quiz-option-text">
      {text.split(/(`[^`\n]+`)/g).map((part, i) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : part))}
    </span>
  );
}

const same = (a: string, b: string) => a.replace(/\W+/g, ' ').trim().toLowerCase() === b.replace(/\W+/g, ' ').trim().toLowerCase();

/**
 * "Quiz me", one card per question. The learner picks an option: right turns it green, wrong turns it
 * red and marks the right one, and either way the reason appears under it. "More questions" asks for
 * another round — the part being taught, then the whole video — never repeating what was asked.
 */
export function QuizCards({ questions: first, onMore, hasSection = false }: { questions: QuizQuestion[]; onMore?: (previous: string[], scope: 'section' | 'video') => Promise<QuizMoreResult>; hasSection?: boolean }) {
  const [questions, setQuestions] = useState(first);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [round, setRound] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const answered = questions.filter((q) => q.answer && picked[q.n]);
  const right = answered.filter((q) => picked[q.n] === q.answer!.letter).length;
  const scope = moreScope(round, hasSection);

  async function more() {
    if (!onMore || loading) return;
    setLoading(true);
    setError(null);
    const result = await onMore(
      questions.map((q) => q.text.split('\n')[0]),
      scope,
    );
    setLoading(false);
    if (!result.ok) return setError({ text: result.error, code: result.code });
    const fresh = (parseQuiz(result.text) ?? []).filter((q) => !questions.some((old) => same(old.text, q.text)));
    if (!fresh.length) return setError({ text: 'FocusSpace couldn’t find new questions this time. Try again.' });
    const start = questions.length;
    setQuestions([...questions, ...fresh.map((q, i) => ({ ...q, n: start + i + 1 }))]);
    setRound((r) => r + 1);
    // Bring the first new question into view inside the answer's own scroll area — never the page.
    requestAnimationFrame(() => {
      const card = rootRef.current?.querySelectorAll<HTMLElement>('.fs-quiz-card')[start];
      const scroller = rootRef.current?.closest<HTMLElement>('.fs-answer-body');
      if (card && scroller) scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
    });
  }

  return (
    <div ref={rootRef} className="fs-quiz">
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
                    onClick={() => setPicked((p) => ({ ...p, [q.n]: o.letter }))}
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

      <div className="fs-quiz-foot">
        {answered.length > 0 && (
          <span className="fs-quiz-score">
            {right} of {answered.length} right
          </span>
        )}
        {onMore && (
          <button type="button" className="fs-quiz-more" onClick={() => void more()} disabled={loading}>
            {loading ? <Loader2 size={14} className="fs-spin" aria-hidden /> : <Plus size={14} aria-hidden />}
            {loading ? 'Writing more questions…' : scope === 'section' ? 'More questions from this part' : 'More questions from the whole video'}
          </button>
        )}
      </div>
      {error && (
        <p className={`fs-answer-note${error.code === 'quota_exceeded' ? '' : ' fs-error'}`}>
          {error.text}
          {error.code === 'quota_exceeded' && <LimitActions />}
        </p>
      )}
    </div>
  );
}
