import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowLeft, BookOpen, CalendarCheck, Check, ChevronRight, ClipboardList, GraduationCap, ListVideo, WifiOff } from 'lucide-react';
import type { LearningMode, Topic } from '@/types/domain';
import { useStorage } from '@/ui/hooks';
import { YtLink } from '@/ui/nav';
import { Modal } from '@/ui/components/Modal';
import { sendMessage } from '@/messaging/runtime';
import { groupId, groupTitle, isGroupId } from '@/modes/groups';
import {
  completedVideos,
  courseLessons,
  isVideoRef,
  pickFeatured,
  sharingLine,
  showsQuizChip,
  splitAssignments,
  topicProgress,
  topicShelves,
  watchedShare,
  type Assignment,
  type Featured,
  type Lesson,
  type Shelf,
} from '@/institutes/home';
import { Billboard } from './home/Billboard';
import { LearningPath } from './home/LearningPath';
import { PosterCard } from './home/PosterCard';
import { Row } from './home/Row';
import { InstituteManage } from './institute/InstituteControls';
import { InstituteQuiz } from './institute/InstituteQuiz';
import { useLessonInfo } from './institute/lesson-title';

/**
 * A student's institute Space: the same streaming-style home as every other Space, built only from the
 * faculty's course. Today's class (or the next lesson) as the billboard, homework, the subjects as a
 * path, then one shelf per topic in the faculty's order. No discovery, no outside channels, no Shorts,
 * and nothing editable — the institute manages the course; the student only watches it.
 *
 * Course data is the cached, published version (it survives offline); titles come from YouTube at
 * display time and are kept in memory only; progress is the student's own watch history.
 */

type Shares = ReturnType<typeof watchedShare>;
type LoadState = 'loading' | 'ready' | 'failed';

const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;

/** Today's class and homework for the learner's batch. A free course has none, so it never waits. */
function useAssignments(mode: LearningMode): { assignments: Assignment[]; state: LoadState } {
  const source = mode.source!;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [state, setState] = useState<LoadState>(source.batchId ? 'loading' : 'ready');

  useEffect(() => {
    let live = true;
    setState(source.batchId ? 'loading' : 'ready');
    void sendMessage('institutes/student', { orgId: source.orgId, courseId: source.courseId })
      .then((result) => {
        if (!live) return;
        setAssignments((result as { assignments?: Assignment[] }).assignments ?? []);
        setState('ready');
      })
      .catch(() => live && setState('failed'));
    return () => {
      live = false;
    };
  }, [mode.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { assignments, state };
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** The topics a selection covers: one topic, a whole subject (`group:…`), or none selected. */
function selectedTopicIds(mode: LearningMode, topicId: string | null): Set<string> | null {
  if (!topicId) return null;
  if (isGroupId(topicId)) return new Set(mode.topics.filter((t) => !!t.group && groupId(t.group) === topicId).map((t) => t.id));
  return new Set([topicId]);
}

export function InstituteHome({ mode, topicId, onTopic }: { mode: LearningMode; topicId: string | null; onTopic: (id: string | null) => void }) {
  const source = mode.source!;
  const history = useStorage(['watchHistory'] as const);
  const { assignments, state } = useAssignments(mode);
  const online = useOnline();
  const [quiz, setQuiz] = useState<string | null>(null);

  const lessons = useMemo(() => courseLessons(source), [source]);
  const completed = useMemo(() => completedVideos(history?.watchHistory, mode.id), [history?.watchHistory, mode.id]);
  const shares = useMemo(() => watchedShare(history?.watchHistory, mode.id), [history?.watchHistory, mode.id]);
  const selected = selectedTopicIds(mode, topicId);
  const shelves = useMemo(() => topicShelves(mode, source, selected ?? undefined), [mode, source, topicId]); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = !source.items.length;
  // The billboard waits for the student's history (and, in a batch, today's class) so it never swaps under them.
  const settled = history !== undefined && state !== 'loading';

  const shelfProps = { mode, completed, shares, onQuiz: setQuiz };

  return (
    <div className="fs-institute" style={{ '--fs-institute-accent': source.accent ?? 'var(--fs-accent)' } as CSSProperties}>
      <InstituteHeader mode={mode} />
      {!online && (
        <p className="fs-note fs-institute-offline" role="status">
          <WifiOff size={16} aria-hidden /> Offline: showing your saved course
        </p>
      )}

      {empty ? (
        <EmptyCourse orgName={source.orgName} />
      ) : selected ? (
        <TopicView topicId={topicId!} shelves={shelves} onTopic={onTopic} {...shelfProps} />
      ) : (
        <>
          {settled ? (
            <FeaturedLesson featured={pickFeatured(lessons, completed, assignments)} mode={mode} total={lessons.length} shares={shares} onTopic={onTopic} />
          ) : (
            <div className="fs-billboard fs-billboard-skeleton fs-skeleton" aria-hidden />
          )}
          <AssignmentShelves assignments={assignments} lessons={lessons} {...shelfProps} />
          <CoursePath mode={mode} lessons={lessons} completed={completed} onTopic={onTopic} />
          {shelves.map((shelf) => (
            <TopicShelf key={shelf.topic.id} shelf={shelf} onTopic={onTopic} {...shelfProps} />
          ))}
        </>
      )}

      <Modal open={!!quiz} onClose={() => setQuiz(null)} title="Institute quiz" width={560}>
        {quiz && <InstituteQuiz mode={mode} quizId={quiz} />}
      </Modal>
    </div>
  );
}

/* ─── Header ───────────────────────────────────────────────────────────────── */

/** Who runs the course and what they can see. Withdrawing sharing or leaving never locks a feature. */
function InstituteHeader({ mode }: { mode: LearningMode }) {
  const source = mode.source!;
  return (
    <header className="fs-institute-head">
      {source.logo ? (
        <img className="fs-institute-logo" src={source.logo} alt="" width={44} height={44} referrerPolicy="no-referrer" />
      ) : (
        <span className="fs-institute-logo fs-institute-logo-blank" aria-hidden>
          <GraduationCap size={22} />
        </span>
      )}
      <div className="fs-institute-id">
        <span className="fs-institute-org">{source.orgName}</span>
        <h1 className="fs-institute-title">{mode.name}</h1>
        <span className="fs-institute-meta">
          Course version {source.courseVersion} · {sharingLine(source)}
        </span>
      </div>
      <div className="fs-institute-manage">
        <InstituteManage mode={mode} />
      </div>
    </header>
  );
}

function EmptyCourse({ orgName }: { orgName: string }) {
  return (
    <section className="fs-empty-yt fs-institute-empty">
      <BookOpen size={28} aria-hidden />
      <h3>No lessons yet</h3>
      <p>{orgName} hasn’t added lessons to this course yet. They appear here, in your institute’s order, as soon as it publishes them.</p>
    </section>
  );
}

/* ─── Billboard ────────────────────────────────────────────────────────────── */

function eyebrowFor(featured: Featured, total: number): string {
  if (featured.reason === 'today') return 'Today’s class';
  if (featured.reason === 'review') return 'Course complete · Watch again';
  return `Up next · Lesson ${featured.lesson.number} of ${total}`;
}

function whyFor(featured: Featured, orgName: string, topicName: string | null, total: number): string {
  if (featured.note) return featured.note;
  if (featured.reason === 'today') return `Set by ${orgName} for your batch.`;
  if (featured.reason === 'review') return `You’ve completed all ${total} lessons.`;
  return topicName ? `The next lesson in ${topicName}, in your institute’s order.` : 'The next lesson in your institute’s order.';
}

function FeaturedLesson({ featured, mode, total, shares, onTopic }: { featured: Featured | null; mode: LearningMode; total: number; shares: Shares; onTopic: (id: string) => void }) {
  const lesson = featured?.lesson;
  const info = useLessonInfo(lesson?.videoId ?? '', lesson ? `Lesson ${lesson.number}` : '');
  if (!featured || !lesson) return null;
  const source = mode.source!;
  const topic = mode.topics.find((t) => t.id === lesson.topicId) ?? null;
  const share = shares.get(lesson.videoId);
  return (
    <Billboard
      items={[
        {
          id: lesson.videoId,
          title: info.title,
          channelTitle: info.author ?? source.orgName,
          durationSec: share?.durationSec ?? null,
          eyebrow: eyebrowFor(featured, total),
          why: whyFor(featured, source.orgName, topic?.name ?? null, total),
          tierLabel: null,
          progress: share && featured.reason !== 'review' ? share.progress : null,
          topicId: topic?.id ?? null,
          topicName: topic?.name ?? null,
        },
      ]}
      onTopic={onTopic}
    />
  );
}

/* ─── Shelves ──────────────────────────────────────────────────────────────── */

interface ShelfProps {
  mode: LearningMode;
  completed: Set<string>;
  shares: Shares;
  onQuiz: (quizId: string) => void;
}

function LessonPoster({ lesson, mode, completed, shares, onQuiz, label }: ShelfProps & { lesson: Lesson; label?: string }) {
  const info = useLessonInfo(lesson.videoId, `Lesson ${lesson.number}`);
  const done = completed.has(lesson.videoId);
  const share = shares.get(lesson.videoId);
  return (
    <PosterCard
      plain
      card={{
        id: lesson.videoId,
        title: info.title,
        channelTitle: info.author ?? mode.source!.orgName,
        views: null,
        time: label ?? `Lesson ${lesson.number}`,
        durationSec: share?.durationSec ?? null,
        progress: done ? null : (share?.progress ?? null),
        tier: 'strong',
        source: 'subscription',
        why: '',
      }}
      badge={
        done && (
          <span className="fs-poster-flag fs-institute-done">
            <Check size={11} aria-hidden /> Completed
          </span>
        )
      }
      footer={
        showsQuizChip(lesson, completed) && (
          <button type="button" className="fs-institute-quiz-chip" onClick={() => onQuiz(lesson.quizId!)}>
            <ClipboardList size={14} aria-hidden /> Institute quiz
          </button>
        )
      }
    />
  );
}

/** A course playlist has no single video to show, so it is a plain card that opens the playlist. */
function PlaylistCard({ id, title }: { id: string; title: string }) {
  return (
    <article className="fs-poster fs-institute-playlist">
      <YtLink href={playlistUrl(id)} className="fs-poster-link">
        <span className="fs-poster-art fs-institute-playlist-art">
          <ListVideo size={30} aria-hidden />
        </span>
        <span className="fs-poster-info">
          <span className="fs-poster-title">{title}</span>
          <span className="fs-poster-meta">Course playlist</span>
        </span>
      </YtLink>
    </article>
  );
}

function TopicShelf({ shelf, onTopic, ...props }: ShelfProps & { shelf: Shelf; onTopic: (id: string) => void }) {
  const { topic } = shelf;
  const done = shelf.lessons.filter((l) => props.completed.has(l.videoId)).length;
  return (
    <Row
      title={topic.name}
      subtitle={`${topic.group ? `${groupTitle(topic.group)} · ` : ''}${done} of ${shelf.lessons.length} completed`}
      action={
        <button type="button" className="fs-shelf-more" onClick={() => onTopic(topic.id)}>
          See all <ChevronRight size={14} aria-hidden />
        </button>
      }
    >
      {shelf.lessons.map((lesson) => (
        <LessonPoster key={lesson.videoId} lesson={lesson} {...props} />
      ))}
      {shelf.playlists.map((id) => (
        <PlaylistCard key={id} id={id} title={topic.name} />
      ))}
    </Row>
  );
}

/** One assignment: a course lesson as a poster, a playlist as a card. Refs outside the course are skipped. */
function AssignmentCard({ assignment, byVideo, ...props }: ShelfProps & { assignment: Assignment; byVideo: Map<string, Lesson> }) {
  const lesson = byVideo.get(assignment.item_ref);
  if (lesson) return <LessonPoster lesson={lesson} label={assignment.note || `Lesson ${lesson.number}`} {...props} />;
  if (isVideoRef(assignment.item_ref)) return null;
  return <PlaylistCard id={assignment.item_ref} title={assignment.note || 'Course playlist'} />;
}

/**
 * Today's class is the billboard; a shelf only adds the rest of it (a second lesson, or a playlist).
 * Homework is its own shelf right after.
 */
function AssignmentShelves({ assignments, lessons, ...props }: ShelfProps & { assignments: Assignment[]; lessons: Lesson[] }) {
  const byVideo = useMemo(() => new Map(lessons.map((l) => [l.videoId, l])), [lessons]);
  const { today, homework } = splitAssignments(assignments);
  const featured = pickFeatured(lessons, props.completed, assignments);
  const restOfToday = today.filter((a) => !(featured?.reason === 'today' && a.item_ref === featured.lesson.videoId));
  return (
    <>
      {restOfToday.length > 0 && (
        <Row title="Also in today’s class" icon={<CalendarCheck size={20} aria-hidden />}>
          {restOfToday.map((a, i) => (
            <AssignmentCard key={a.id ?? `${a.item_ref}:${i}`} assignment={a} byVideo={byVideo} {...props} />
          ))}
        </Row>
      )}
      {homework.length > 0 && (
        <Row title="Homework" icon={<ClipboardList size={20} aria-hidden />}>
          {homework.map((a, i) => (
            <AssignmentCard key={a.id ?? `${a.item_ref}:${i}`} assignment={a} byVideo={byVideo} {...props} />
          ))}
        </Row>
      )}
    </>
  );
}

/** The subjects as the stages of a path: a topic counts as covered once every lesson in it is completed. */
function CoursePath({ mode, lessons, completed, onTopic }: { mode: LearningMode; lessons: Lesson[]; completed: Set<string>; onTopic: (id: string) => void }) {
  const { done, total } = useMemo(() => topicProgress(lessons, completed), [lessons, completed]);
  const isCovered = (t: Topic, n: number) => (total.get(t.id) ?? 0) > 0 && n >= (total.get(t.id) ?? 0);
  const detail = (t: Topic) => {
    const count = total.get(t.id) ?? 0;
    return `${done.get(t.id) ?? 0} of ${count} ${count === 1 ? 'lesson' : 'lessons'}`;
  };
  return <LearningPath mode={mode} onTopic={onTopic} progress={done} isCovered={isCovered} detail={detail} minStages={1} />;
}

/* ─── A topic or subject opened on its own ─────────────────────────────────── */

function TopicView({ mode, topicId, shelves, onTopic, ...props }: ShelfProps & { topicId: string; shelves: Shelf[]; onTopic: (id: string | null) => void }) {
  const subject = isGroupId(topicId) ? mode.topics.find((t) => t.group && groupId(t.group) === topicId)?.group : undefined;
  const topic = subject ? undefined : mode.topics.find((t) => t.id === topicId);
  const title = subject ? `All of ${groupTitle(subject)}` : (topic?.name ?? mode.name);
  return (
    <section className="fs-section fs-institute-topic" aria-label={title}>
      <nav className="fs-crumbs" aria-label="Where you are">
        <button type="button" className="fs-crumb-back" onClick={() => onTopic(null)}>
          <ArrowLeft size={16} aria-hidden /> Back to {mode.name}
        </button>
      </nav>
      <div className="fs-section-head">
        <h2>{title}</h2>
        {topic?.group && <span>{groupTitle(topic.group)}</span>}
      </div>
      {shelves.length ? (
        shelves.map((shelf) => <TopicShelf key={shelf.topic.id} shelf={shelf} onTopic={onTopic} mode={mode} {...props} />)
      ) : (
        <p className="fs-muted-line">No lessons in this part of the course yet.</p>
      )}
    </section>
  );
}
