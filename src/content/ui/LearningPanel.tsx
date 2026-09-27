import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, Circle, CircleDot, CircleHelp, Lightbulb, ListChecks, MessageCircle, NotebookPen, Play, SkipForward, Sparkles, X } from 'lucide-react';
import type { AiSettings, LearningMode } from '@/types/domain';
import type { WatchPage } from '@/integrations/youtube/innertube-client';
import { positionLabel } from '@/learning/next';
import { PATH_LABEL, type LearningPath, type PathRow } from '@/learning/path/path';
import { buildLearningContext, type LearningContext } from '@/learning/context/context';
import { WINDOW_FOR, type AiAction, type QuizDifficulty } from '@/learning/ai/actions';
import type { QuizBlock } from '@/learning/ai/quiz-plan';
import type { UsageStatusView } from '@/types/usage';
import { useCanSave } from '@/ui/account/use-can-save';
import type { AiResult, AiStatus } from '@/learning/ai/service';
import type { ConceptPosition, ConceptStop } from '@/learning/knowledge/locate';
import { formatTimestamp } from '@/learning/knowledge/timestamps';
import { MIN_VISIBLE_CONFIDENCE, type KnowledgeMap, type KnowledgeSource } from '@/learning/knowledge/types';
import { HOSTED_AI_LABEL } from '@/config';
import { sendMessage } from '@/messaging/runtime';
import { YtLink } from '@/ui/nav';
import { useKnowledge, usePlaybackConcept, useVideoDuration } from '../data/knowledge';
import { useVideoOutline } from '../data/outline';
import { ChatPanel } from './ChatPanel';
import { FitToScreen } from './FitToScreen';
import { LimitActions } from './LimitActions';
import { NotesPanel } from './NotesPanel';
import { QuizSession, type QuizMoreResult } from './QuizCards';
import { RichText } from '@/ui/components/RichText';

const watchUrl = (id: string, list: string | null) => `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ''}`;
/** Creators format titles with markdown ("__Beginner Level__"); show the words. */
const display = (title: string) => title.replace(/^(?:__|\*\*)(.+?)(?:__|\*\*)$/, '$1');

/* ─── Your course ──────────────────────────────────────────────────────────── */

const ROW_ICON: Record<PathRow['state'], ReactNode> = {
  watched: <Check size={14} aria-hidden />,
  current: <Play size={13} aria-hidden />,
  next: <ArrowRight size={14} aria-hidden />,
  skipped: <SkipForward size={13} aria-hidden />,
  'in-progress': <Circle size={10} aria-hidden />,
  unwatched: <Circle size={10} aria-hidden />,
};

function rowTag(row: PathRow, path: LearningPath): string {
  switch (row.state) {
    case 'current':
      return 'You are here';
    case 'next':
      return path.authoritative ? (path.nextSkipsWatched ? 'Next unwatched' : 'Next') : path.nextLabel === 'Appears to be next' ? 'Appears next' : 'Next';
    case 'skipped':
      return 'Skipped';
    case 'in-progress':
      return row.progress !== null ? `${Math.round(row.progress * 100)}%` : '';
    default:
      return '';
  }
}

/** Where this video sits in its course: the creator's playlist when there is one. */
export function LearningPathPanel({ path, currentId }: { path: LearningPath; currentId: string }) {
  const position = path.current ? `You are here: ${positionLabel(path.current)}${path.authoritative ? ` of ${path.total}` : ''}` : '';
  return (
    <section className="fs-sec fs-path" aria-label="Your course">
      <div className="fs-sec-label">
        <span>{path.authoritative ? 'Your course' : 'Continue this series'}</span>
        {path.authoritative && path.playlistId ? (
          <YtLink href={`https://www.youtube.com/playlist?list=${path.playlistId}`} className="fs-sec-meta" title="Open the full playlist">
            {PATH_LABEL[path.source]}
          </YtLink>
        ) : (
          <span className="fs-sec-meta">Detected from video titles</span>
        )}
      </div>
      <div className="fs-path-title">{path.title}</div>
      {(position || path.watchedCount > 0) && <div className="fs-meta">{[position, path.watchedCount ? `${path.watchedCount} watched` : ''].filter(Boolean).join(' · ')}</div>}
      <ol className="fs-path-list">
        {path.rows.map((row, i) => (
          <Fragment key={row.item.videoId}>
            {i > 0 && row.hiddenBefore > 0 && <li className="fs-path-gap">{row.hiddenBefore} more</li>}
            <li className={`fs-path-row fs-path-${row.state}`}>
              <span className="fs-path-icon">{ROW_ICON[row.state]}</span>
              <span className="fs-path-index">{positionLabel(row.item)}</span>
              {row.item.videoId === currentId ? (
                <span className="fs-path-name">{row.item.title}</span>
              ) : (
                <YtLink href={watchUrl(row.item.videoId, path.playlistId)} className="fs-path-name">
                  {row.item.title}
                </YtLink>
              )}
              {rowTag(row, path) && <span className="fs-path-tag">{rowTag(row, path)}</span>}
            </li>
          </Fragment>
        ))}
      </ol>
      {path.next && path.next.videoId !== currentId && (
        <YtLink href={watchUrl(path.next.videoId, path.playlistId)} className="fs-next-link">
          <span>
            <small>{path.nextLabel}</small>
            <b>{path.next.title}</b>
          </span>
          <ArrowRight size={18} aria-hidden />
        </YtLink>
      )}
    </section>
  );
}

/* ─── You're learning · Knowledge map · Learn with AI ─────────────────────── */

export const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  chapters: "From the creator's chapters",
  'auto-chapters': "From YouTube's automatic chapters",
  description: 'From the description',
  comments: 'From viewer comments · may be inaccurate',
  transcript: 'Estimated from the transcript',
  ai: 'Suggested by AI',
};

const SOURCE_SHORT: Record<KnowledgeSource, string> = {
  chapters: "Creator's chapters",
  'auto-chapters': 'YouTube auto-chapters',
  description: 'From the description',
  comments: 'From viewer comments',
  transcript: 'From the transcript',
  ai: 'Suggested by AI',
};

const ACTIONS: { id: AiAction; label: string; icon: ReactNode }[] = [
  { id: 'what', label: 'What am I learning?', icon: <BookOpen size={14} aria-hidden /> },
  { id: 'explain', label: 'Explain', icon: <Lightbulb size={14} aria-hidden /> },
  { id: 'example', label: 'Example', icon: <Sparkles size={14} aria-hidden /> },
  { id: 'quiz', label: 'Quiz me', icon: <ListChecks size={14} aria-hidden /> },
];
const ACTION_TITLE: Record<AiAction, string> = { what: 'What you’re learning', explain: 'Explanation', example: 'Example', quiz: 'Quiz' };
const PROVIDER_NAME: Record<string, string> = { chrome: 'on-device AI', endpoint: 'your AI endpoint' };

type Answer =
  | { kind: 'loading'; action: AiAction; at: number }
  | { kind: 'local'; action: AiAction; at: number; context: LearningContext; now: string | null; aiLoading: boolean; provider: string | null }
  | { kind: 'answer'; action: AiAction; at: number; text: string; provider: string }
  | { kind: 'quiz'; action: AiAction; at: number }
  | { kind: 'fallback'; action: AiAction; at: number; excerpt: string | null; setup: 'off' | 'download' | 'configure' }
  | { kind: 'error'; action: AiAction; at: number; error: string; code?: string };

const TRANSCRIPT_STATUS: Record<string, string> = {
  loading: 'Reading the captions…',
  none: 'This video has no captions FocusSpace can read.',
  ad: 'Try again after the ad.',
  'not-ready': 'Try again once the video has started.',
  unsupported: 'Captions are not available in this player.',
  failed: 'Couldn’t read the captions.',
  timeout: 'Couldn’t read the captions.',
};

export function NowLearning({
  mode,
  video,
  page,
  path,
  topicId,
  ai,
  debug,
}: {
  mode: LearningMode;
  video: { id: string; title: string; channelTitle: string };
  page: WatchPage | null;
  path: LearningPath | null;
  topicId: string | null;
  ai: AiSettings;
  debug: boolean;
}) {
  const duration = useVideoDuration(video.id);
  const knowledge = useKnowledge(video.id, page, mode, duration);
  const { position, currentTime, seek } = usePlaybackConcept(video.id, knowledge.stops);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [panel, setPanel] = useState<'notes' | 'chat' | null>(null);
  const [usage, setUsage] = useState<UsageStatusView | null>(null);
  const signedIn = useCanSave();
  const runId = useRef(0);
  const outline = useVideoOutline(panel !== null, video, knowledge.transcript, duration, knowledge.map);
  // Chat answers from the transcript and the outline built on it, so opening chat fetches the captions — the same request "Explain this" makes.
  const { requestTranscript } = knowledge;
  useEffect(() => {
    if (panel === 'chat') void requestTranscript();
  }, [panel, requestTranscript]);
  const loadTranscript = useCallback(async () => (await requestTranscript())?.segments ?? null, [requestTranscript]);

  useEffect(() => {
    runId.current++;
    setAnswer(null);
    setPanel(null);
  }, [video.id]);

  useEffect(() => {
    let alive = true;
    sendMessage('ai/status', {})
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, [ai.provider, ai.endpointUrl]);

  const map = knowledge.map;
  const current = position?.current ?? null;
  const upcoming = position?.upcoming[0] ?? null;
  const readingOutline = !!page && page.videoId === video.id && !map;
  const visibleCount = knowledge.stops.length;

  async function run(action: AiAction) {
    setPanel(null);
    const id = ++runId.current;
    const at = currentTime();
    // Quiz me asks first: the part watched so far, or the full video (QuizSession).
    if (action === 'quiz') {
      setAnswer({ kind: 'quiz', action, at });
      void sendMessage('usage/status', {}).then((u) => id === runId.current && setUsage(u)).catch(() => undefined);
      return;
    }
    const contextWith = (segments: NonNullable<typeof knowledge.transcript>['segments'] | null) =>
      buildLearningContext({
        video,
        mode,
        topicId,
        path,
        map,
        stops: knowledge.stops,
        transcript: segments,
        // Auto-generated captions are a real source but a lossy one; the model is told which it has.
        transcriptSource: knowledge.transcript?.kind ?? null,
        currentTime: at,
        window: WINDOW_FOR[action],
      });

    if (action === 'what') {
      setAnswer({ kind: 'local', action, at, context: contextWith(knowledge.transcript?.segments ?? null), now: null, aiLoading: status?.availability === 'available', provider: null });
      if (status?.availability !== 'available') return;
    } else setAnswer({ kind: 'loading', action, at });

    // Answers about *this moment* need what the instructor said: reading captions is part of the request.
    const transcript = knowledge.transcript ?? (await knowledge.requestTranscript());
    if (id !== runId.current) return;
    const context = contextWith(transcript?.segments ?? null);
    const result = await sendMessage('ai/run', { action, context }).catch((): AiResult => ({ ok: false, code: 'failed', error: 'FocusSpace couldn’t reach its AI service. Reload the page and try again.' }));
    if (id !== runId.current) return;

    if (action === 'what') {
      setAnswer((prev) => (prev?.kind === 'local' ? { ...prev, context, now: result.ok ? result.answer : null, aiLoading: false, provider: result.ok ? result.provider : null } : prev));
      return;
    }
    if (result.ok) setAnswer({ kind: 'answer', action, at, text: result.answer, provider: result.provider });
    else if (result.code === 'unavailable') setAnswer({ kind: 'fallback', action, at, excerpt: context.transcriptWindow?.text ?? null, setup: ai.provider === 'off' ? 'off' : status?.availability === 'downloadable' ? 'download' : 'configure' });
    else setAnswer({ kind: 'error', action, at, error: result.error, code: result.code });
  }

  /** One quiz round: five questions on one block of the part chosen, never repeating what was asked. */
  async function quizRound(block: QuizBlock, difficulty: QuizDifficulty | undefined, previous: string[]): Promise<QuizMoreResult> {
    const id = runId.current;
    const transcript = knowledge.transcript ?? (await knowledge.requestTranscript());
    if (!transcript?.segments.length) return { ok: false, error: 'This video has no captions FocusSpace can read, so there is nothing to quiz you on.' };
    const context = buildLearningContext({
      video, mode, topicId, path, map, stops: knowledge.stops, transcript: transcript.segments,
      transcriptSource: transcript.kind ?? null,
      currentTime: block.startSec,
      range: block,
      // 15 minutes of speech is about 12,000 characters; the rules and earlier questions still fit inside the API's prompt limit.
      window: { maxChars: 12000 },
    });
    const result = await sendMessage('ai/run', { action: 'quiz', context, quiz: { scope: 'span', previous, difficulty } }).catch((): AiResult => ({ ok: false, code: 'failed', error: 'FocusSpace couldn’t reach its AI service. Reload the page and try again.' }));
    if (id !== runId.current) return { ok: false, error: 'This quiz belongs to an earlier moment.' };
    return result.ok ? { ok: true, text: result.answer } : { ok: false, error: result.error, code: result.code };
  }

  const aiState =
    ai.provider === 'off' ? 'Off' : status?.availability === 'available' ? (status.provider === 'chrome' ? 'On-device' : status.label === HOSTED_AI_LABEL ? HOSTED_AI_LABEL : 'Your endpoint') : status?.availability === 'downloadable' || status?.availability === 'downloading' ? 'Model not downloaded' : status ? 'Not set up' : '';

  return (
    <>
      <section className="fs-sec fs-ai" aria-label="Learn with AI">
        <div className="fs-sec-label">
          <span>Learn with AI</span>
          {aiState && <span className="fs-sec-meta">{aiState}</span>}
        </div>
        <div className="fs-ai-actions" role="toolbar" aria-label="FocusSpace AI">
          {ACTIONS.map((a) => (
            <button key={a.id} type="button" className={`fs-ai-chip${!panel && answer?.action === a.id ? ' is-active' : ''}`} aria-pressed={!panel && answer?.action === a.id} onClick={() => void run(a.id)}>
              {a.icon} {a.label}
            </button>
          ))}
          <button type="button" className={`fs-ai-chip${panel === 'notes' ? ' is-active' : ''}`} aria-pressed={panel === 'notes'} onClick={() => { setAnswer(null); setPanel((p) => (p === 'notes' ? null : 'notes')); }}>
            <NotebookPen size={14} aria-hidden /> Make Notes
          </button>
          <button type="button" className={`fs-ai-chip${panel === 'chat' ? ' is-active' : ''}`} aria-pressed={panel === 'chat'} onClick={() => { setAnswer(null); setPanel((p) => (p === 'chat' ? null : 'chat')); }}>
            <MessageCircle size={14} aria-hidden /> Ask FocusSpace AI
          </button>
        </div>
        {panel === 'notes' ? (
          <NotesPanel
            video={video}
            mode={mode}
            topicId={topicId}
            path={path}
            map={map}
            transcript={knowledge.transcript?.segments ?? null}
            outline={outline}
            loadTranscript={loadTranscript}
            durationSec={duration}
            currentTime={currentTime}
            defaultLanguage={ai.language}
            onSeek={seek}
            onClose={() => setPanel(null)}
          />
        ) : panel === 'chat' ? (
          // Ends where the window ends: the conversation scrolls inside it and the question box stays in view.
          <FitToScreen className="fs-chat-frame">
          <ChatPanel
            video={video}
            mode={mode}
            topicId={topicId}
            path={path}
            map={map}
            transcript={knowledge.transcript?.segments ?? null}
            transcriptSource={knowledge.transcript?.kind ?? null}
            outline={outline}
            loadTranscript={loadTranscript}
            currentTime={currentTime}
            onSeek={seek}
            durationSec={duration}
            language={ai.language}
            onClose={() => setPanel(null)}
          />
          </FitToScreen>
        ) : (
          answer && (
            // Same for an answer or a quiz: it scrolls inside, and the page (and the video) stay put.
            <FitToScreen className="fs-answer-frame">
            <AnswerView
              answer={answer}
              providerLabel={status?.label ?? null}
              onSeek={seek}
              quiz={{ durationSec: duration, needsAccount: status?.label === HOSTED_AI_LABEL, signedIn, extras: !!usage?.quiz?.extras, onRound: quizRound }}
              onClose={() => {
                runId.current++;
                setAnswer(null);
              }}
            />
            </FitToScreen>
          )
        )}
      </section>

      <section className="fs-sec fs-learning" aria-label="You're learning">
        <div className="fs-sec-label">
          <span>{current || !upcoming ? 'You’re learning' : 'Coming up'}</span>
          {current && (
            <button type="button" className="fs-ts" onClick={() => seek(current.startSec)} title="Back to the start of this part">
              {formatTimestamp(current.startSec)}
            </button>
          )}
        </div>

        {readingOutline ? (
          <div className="fs-skeleton" style={{ height: 22, width: '70%' }} aria-label="Reading the video outline" />
        ) : current ? (
          <>
            <div className="fs-learning-title">{display(current.title)}</div>
            <dl className="fs-context">
              {position!.ancestors.length > 0 && (
                <>
                  <dt>Part of</dt>
                  <dd>{position!.ancestors.map((a) => display(a.title)).join(' › ')}</dd>
                </>
              )}
              {position!.previous.length > 0 && (
                <>
                  <dt>Previously</dt>
                  <dd>{position!.previous.slice(-2).map((p) => display(p.title)).join(' · ')}</dd>
                </>
              )}
              {upcoming && (
                <>
                  <dt>Next</dt>
                  <dd>
                    <button type="button" className="fs-learning-next" onClick={() => seek(upcoming.startSec)}>
                      {display(upcoming.title)}
                    </button>
                    <span className="fs-ts-inline">{formatTimestamp(upcoming.startSec)}</span>
                  </dd>
                </>
              )}
            </dl>
            <div className="fs-learning-sub">{SOURCE_LABEL[current.source]}</div>
          </>
        ) : upcoming ? (
          <>
            <div className="fs-learning-title">{display(upcoming.title)}</div>
            <button type="button" className="fs-learning-next" onClick={() => seek(upcoming.startSec)}>
              Starts at {formatTimestamp(upcoming.startSec)}
            </button>
          </>
        ) : (
          <p className="fs-answer-note">
            {map ? 'No chapters, timestamps or viewer outline for this video yet.' : video.title}
            {map && !knowledge.transcript && knowledge.transcriptStatus === 'idle' && (
              <button type="button" className="fs-link" onClick={() => void knowledge.requestTranscript()}>
                Read the transcript
              </button>
            )}
            {TRANSCRIPT_STATUS[knowledge.transcriptStatus] && <span>{TRANSCRIPT_STATUS[knowledge.transcriptStatus]}</span>}
          </p>
        )}
      </section>

      {map && visibleCount > 0 && <KnowledgeMapSection map={map} stops={knowledge.stops} position={position} onSeek={seek} debug={debug} />}
    </>
  );
}

const WINDOW = 8;

function KnowledgeMapSection({ map, stops, position, onSeek, debug }: { map: KnowledgeMap; stops: ConceptStop[]; position: ConceptPosition | null; onSeek: (sec: number) => void; debug: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const currentId = position?.current?.id ?? null;
  const currentIndex = currentId ? stops.findIndex((s) => s.node.id === currentId) : -1;
  const upcomingIndex = position?.upcoming[0] ? stops.findIndex((s) => s.node.id === position.upcoming[0].id) : 0;
  const anchor = currentIndex >= 0 ? currentIndex : Math.max(0, upcomingIndex);
  const windowed = !expanded && stops.length > WINDOW;
  const start = windowed ? Math.min(Math.max(0, anchor - 2), stops.length - WINDOW) : 0;
  const visible = windowed ? stops.slice(start, start + WINDOW) : stops;
  const lineage = new Set(position?.ancestors.map((a) => a.id));

  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('.is-current');
    if (expanded && list && item) list.scrollTop = Math.max(0, item.offsetTop - list.clientHeight / 3);
  }, [expanded]);

  return (
    <section className="fs-sec fs-map" aria-label="Video knowledge map">
      <div className="fs-sec-label">
        <span>Video knowledge map</span>
        {map.backbone && (
          <span className="fs-sec-meta" title={SOURCE_LABEL[map.backbone]}>
            {SOURCE_SHORT[map.backbone]}
          </span>
        )}
      </div>
      <ol ref={listRef} className={`fs-map-list${expanded ? ' is-expanded' : ''}`}>
        {visible.map(({ node, ancestors }, i) => {
          const index = start + i;
          const state = node.id === currentId ? 'current' : lineage.has(node.id) ? 'parent' : currentIndex >= 0 && index < currentIndex ? 'done' : 'upcoming';
          const group = node.children.some((c) => c.confidence >= MIN_VISIBLE_CONFIDENCE);
          return (
            <li key={node.id}>
              <button
                type="button"
                className={`fs-map-item is-${state}${group ? ' is-group' : ''}`}
                style={{ '--depth': ancestors.length } as CSSProperties}
                onClick={() => onSeek(node.startSec)}
                aria-current={state === 'current' ? 'true' : undefined}
                title={debug ? node.evidence.map((e) => `${e.source} ${e.confidence}${e.note ? ` (${e.note})` : ''}`).join('\n') : undefined}
              >
                <span className="fs-map-dot">{state === 'done' ? <Check size={13} aria-hidden /> : state === 'current' || state === 'parent' ? <CircleDot size={13} aria-hidden /> : <Circle size={9} aria-hidden />}</span>
                <span className="fs-map-title">
                  {display(node.title)}
                  {state === 'current' && <span className="fs-map-here">You are here</span>}
                  {debug && <span className="fs-map-debug"> · {node.source} {node.confidence.toFixed(2)}</span>}
                </span>
                <span className="fs-map-time">{formatTimestamp(node.startSec)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {(stops.length > WINDOW || map.mentions.length > 0) && (
        <div className="fs-map-foot">
          {stops.length > WINDOW && (
            <button type="button" className="fs-text-button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
              {expanded ? 'Show less' : `All ${stops.length} parts`}
            </button>
          )}
          {map.mentions.length > 0 && <span className="fs-map-mentions">Also mentioned: {map.mentions.join(', ')}</span>}
        </div>
      )}
    </section>
  );
}

function AnswerView({
  answer,
  providerLabel,
  onSeek,
  quiz,
  onClose,
}: {
  answer: Answer;
  providerLabel: string | null;
  onSeek: (sec: number) => void;
  quiz: Omit<Parameters<typeof QuizSession>[0], 'watchedSec'>;
  onClose: () => void;
}) {
  const provider = answer.kind === 'answer' ? answer.provider : answer.kind === 'local' ? answer.provider : null;
  return (
    <div className="fs-answer" role="region" aria-live="polite" aria-label={ACTION_TITLE[answer.action]}>
      <div className="fs-answer-head">
        <span>
          {ACTION_TITLE[answer.action]} · {formatTimestamp(answer.at)}
        </span>
        <button type="button" className="fs-icon-plain" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="fs-answer-body">
        {answer.kind === 'loading' && (
          <div aria-busy="true">
            <p className="fs-answer-note">Looking at this moment…</p>
            <div className="fs-skeleton" style={{ height: 12, width: '95%', marginTop: 10 }} />
            <div className="fs-skeleton" style={{ height: 12, width: '80%', marginTop: 8 }} />
            <div className="fs-skeleton" style={{ height: 12, width: '60%', marginTop: 8 }} />
          </div>
        )}

        {answer.kind === 'local' && <MomentSummary answer={answer} onSeek={onSeek} />}

        {answer.kind === 'answer' && <RichText text={answer.text} />}

        {answer.kind === 'quiz' && <QuizSession watchedSec={answer.at} {...quiz} />}

        {answer.kind === 'fallback' && (
          <>
            <p className="fs-answer-note">
              <CircleHelp size={14} aria-hidden />{' '}
              {answer.setup === 'off' ? 'AI is turned off. Turn it back on in Settings → FocusSpace AI.' : answer.setup === 'download' ? 'The on-device AI model needs a one-time download, Settings → FocusSpace AI.' : 'FocusSpace couldn’t reach its AI just now. Try again in a moment.'}
            </p>
            {answer.excerpt && (
              <>
                <div className="fs-answer-label">What the instructor said around {formatTimestamp(answer.at)}</div>
                <blockquote className="fs-answer-quote">…{answer.excerpt.slice(-420)}</blockquote>
              </>
            )}
          </>
        )}

        {/* A monthly-allowance message (Layer 2C) is an expected, calm state, not a failure — it gets the plain note style, never the red "danger" tint. */}
        {answer.kind === 'error' && (
          <p className={`fs-answer-note${answer.code === 'quota_exceeded' ? '' : ' fs-error'}`}>
            {answer.error}
            {answer.code === 'quota_exceeded' && (
              <LimitActions />
            )}
          </p>
        )}
      </div>

      {provider && <div className="fs-answer-foot">From {providerLabel === HOSTED_AI_LABEL ? HOSTED_AI_LABEL : PROVIDER_NAME[provider] ?? providerLabel ?? 'AI'} · AI can make mistakes</div>}
    </div>
  );
}

/** "What am I learning?": scannable in a few seconds — previously · now · next, then (with AI) one sentence. */
function MomentSummary({ answer, onSeek }: { answer: Extract<Answer, { kind: 'local' }>; onSeek: (sec: number) => void }) {
  const ctx = answer.context;
  return (
    <>
      <div className="fs-answer-headline">{display(ctx.currentConcept ?? ctx.videoTitle)}</div>
      <dl className="fs-context">
        {ctx.previousConcepts.length > 0 && (
          <>
            <dt>Previously</dt>
            <dd>{ctx.previousConcepts.slice(-3).map(display).join(' · ')}</dd>
          </>
        )}
        {(answer.now || answer.aiLoading || ctx.conceptPath.length > 1) && (
          <>
            <dt>Now</dt>
            <dd>{answer.now ?? (answer.aiLoading ? <span className="fs-skeleton" style={{ display: 'block', height: 12, width: '90%', marginTop: 3 }} /> : `Part of ${ctx.conceptPath.slice(0, -1).map(display).join(' › ')}`)}</dd>
          </>
        )}
        {ctx.upcomingConcepts.length > 0 && (
          <>
            <dt>Next</dt>
            <dd>{display(ctx.upcomingConcepts[0])}</dd>
          </>
        )}
        {ctx.playlist?.position && (
          <>
            <dt>Course</dt>
            <dd>
              #{ctx.playlist.position} of {ctx.playlist.total} · {ctx.playlist.title}
            </dd>
          </>
        )}
      </dl>
      {!ctx.currentConcept && (
        <button type="button" className="fs-link" style={{ marginTop: 8 }} onClick={() => onSeek(0)}>
          This video has no outline yet
        </button>
      )}
    </>
  );
}

