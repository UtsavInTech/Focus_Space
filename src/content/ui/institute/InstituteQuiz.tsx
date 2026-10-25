import { useEffect, useState } from 'react';
import type { LearningMode } from '@/types/domain';
import { sendMessage } from '@/messaging/runtime';

type Question = { question: string; options: string[] };

/**
 * A faculty quiz, opened after its lesson is completed. The server sends questions and options only and
 * grades the answers itself; the score shown here is the server's.
 */
export function InstituteQuiz({ mode, quizId, onClose }: { mode: LearningMode; quizId: string; onClose?: () => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [message, setMessage] = useState('Loading quiz…');
  const orgId = mode.source!.orgId;

  useEffect(() => {
    let live = true;
    setQuestions([]);
    setAnswers({});
    setMessage('Loading quiz…');
    void sendMessage('institutes/student', { orgId, quizId })
      .then((data) => {
        if (!live) return;
        setQuestions((data as { questions: Question[] }).questions);
        setMessage('');
      })
      .catch((e) => live && setMessage(e.message));
    return () => {
      live = false;
    };
  }, [quizId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const ordered = questions.map((_, i) => answers[i]);
    void sendMessage('institutes/student', { orgId, quizId, answers: ordered })
      .then((result) => {
        const { score, total } = result as { score: number; total: number };
        setMessage(`Score: ${score}/${total}`);
      })
      .catch((e) => setMessage(e.message));
  };

  return (
    <section>
      <h3>Institute quiz</h3>
      {onClose && (
        <button className="fs-link" onClick={onClose}>
          Close quiz
        </button>
      )}
      <p role="status">{message}</p>
      {questions.map((q, i) => (
        <fieldset key={i}>
          <legend>{q.question}</legend>
          {q.options.map((option, n) => (
            <label style={{ display: 'block' }} key={n}>
              <input type="radio" name={`institute-${quizId}-${i}`} checked={answers[i] === n} onChange={() => setAnswers((a) => ({ ...a, [i]: n }))} />
              {option}
            </label>
          ))}
        </fieldset>
      ))}
      {!!questions.length && (
        <button className="fs-cta" disabled={Object.keys(answers).length !== questions.length} onClick={submit}>
          Check score
        </button>
      )}
    </section>
  );
}
