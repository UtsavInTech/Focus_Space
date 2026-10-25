import { useEffect, useState, type CSSProperties } from 'react';
import type { LearningMode } from '@/types/domain';
import { useStorage } from '@/ui/hooks';
import { YtLink } from '@/ui/nav';
import { sendMessage } from '@/messaging/runtime';
import { slugify } from '@/learning/text';
import { InstituteManage } from './institute/InstituteControls';
import { InstituteQuiz } from './institute/InstituteQuiz';
import { InstituteVideo } from './institute/lesson-title';

type Assignment = { item_ref: string; note?: string };

/** Lessons shown per page before "More course lessons". */
const PAGE = 20;

const groupId = (group: string) => `group:${slugify(group)}`;

/** A video id opens the lesson; anything else is a playlist id. */
const assignmentHref = (ref: string) => (/^[\w-]{11}$/.test(ref) ? `https://www.youtube.com/watch?v=${ref}` : `https://www.youtube.com/playlist?list=${ref}`);

/** The topics a Space-bar selection covers: one topic, a whole subject (`group:…`), or all of them. */
function selectedTopics(mode: LearningMode, topicId: string | null) {
  if (topicId?.startsWith('group:')) return mode.topics.filter((t) => !!t.group && groupId(t.group) === topicId);
  return mode.topics.filter((t) => !topicId || t.id === topicId);
}

/** Today's class and homework for the learner's batch. Empty (not an error) for free courses and offline. */
function useAssignments(mode: LearningMode): Assignment[] {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  useEffect(() => {
    if (!mode.source) return;
    let live = true;
    void sendMessage('institutes/student', { orgId: mode.source.orgId, courseId: mode.source.courseId })
      .then((result) => {
        if (live) setAssignments((result as { assignments: Assignment[] }).assignments ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mode.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return assignments;
}

/** A read-only institute Space's home: the faculty's course, in the faculty's order. */
export function InstituteHome({ mode, topicId }: { mode: LearningMode; topicId: string | null }) {
  const history = useStorage(['watchHistory'] as const);
  const [visible, setVisible] = useState(PAGE);
  const [quiz, setQuiz] = useState<string | null>(null);
  const assignments = useAssignments(mode);

  useEffect(() => {
    setVisible(PAGE);
  }, [topicId, mode.id]);

  const source = mode.source!;
  const topics = selectedTopics(mode, topicId);
  const ids = new Set(topics.map((t) => t.id));
  const items = source.items.filter((item) => ids.has(item.topicId));
  const completed = (videoId: string | undefined) => !!history?.watchHistory.some((e) => e.videoId === videoId && e.modeId === mode.id && e.progress >= 0.8);

  return (
    <section className="fs-institute-home" style={{ borderTop: `2px solid ${source.accent ?? 'var(--fs-accent)'}`, padding: '24px 0' } as CSSProperties}>
      <header className="fs-row-wrap">
        {source.logo && <img src={source.logo} alt="" width={40} height={40} />}
        <div>
          <p className="fs-caption">
            {source.orgName} · Version {source.courseVersion}
          </p>
          <h1 className="fs-h2">{mode.name}</h1>
        </div>
      </header>
      <p className="fs-muted">
        Your institute’s order. No discovery or other channels.{' '}
        {source.progressConsent ? 'Your institute can see your course progress and quiz scores.' : 'Only course totals are shared; your progress is not listed by name.'}
      </p>
      <InstituteManage mode={mode} />

      {!!assignments.length && (
        <section>
          <h2 className="fs-h3">Today’s class</h2>
          {assignments.map((a, i) => (
            <p key={i}>
              <YtLink href={assignmentHref(a.item_ref)}>{a.note || 'Open today’s lesson'}</YtLink>
            </p>
          ))}
        </section>
      )}

      {topics.map((t) => (
        <section key={t.id} style={{ marginTop: 24 }}>
          <p className="fs-caption">{t.group}</p>
          <h2 className="fs-h3">{t.name}</h2>
          <div className="fs-row-wrap">
            {t.keywords.map((word) => (
              <span className="fs-chip" key={word}>
                {word}
              </span>
            ))}
          </div>
          <ol style={{ paddingLeft: 22 }}>
            {items
              .filter((item) => item.topicId === t.id)
              .slice(0, visible)
              .map((item, index) => (
                <li key={`${item.videoId ?? item.playlistId}:${index}`} style={{ padding: '14px 0', borderBottom: '1px solid var(--fs-border)' }}>
                  {item.type === 'video' ? (
                    <>
                      <InstituteVideo id={item.videoId!} number={index + 1} />
                      {completed(item.videoId) && <span className="fs-caption"> · Completed</span>}
                      {item.quizId && (
                        <button className="fs-link" onClick={() => setQuiz(item.quizId!)}>
                          Institute quiz
                        </button>
                      )}
                    </>
                  ) : (
                    <YtLink href={`https://www.youtube.com/playlist?list=${item.playlistId}`}>Open course playlist</YtLink>
                  )}
                </li>
              ))}
          </ol>
        </section>
      ))}

      {items.length > visible && (
        <button className="fs-cta" onClick={() => setVisible((v) => v + PAGE)}>
          More course lessons
        </button>
      )}
      {quiz && <InstituteQuiz mode={mode} quizId={quiz} onClose={() => setQuiz(null)} />}
    </section>
  );
}
