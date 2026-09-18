import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Check, ExternalLink, ShieldCheck } from 'lucide-react';
import type { LearningMode, RelatedVideosPolicy, Settings } from '@/types/domain';
import type { VideoMetadata } from '@/learning/classifier';
import { FEED_MIN_SCORE, TIER_LABEL } from '@/learning/classifier';
import { getClassifier } from '@/ai/registry';
import type { Assessment } from '@/ai/sidekick';
import { seriesNumber } from '@/learning/next';
import type { LearningPath } from '@/learning/path/path';
import { compactNumber } from '@/learning/library';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { channelRuleOf, setChannelRule } from '@/modes/service';
import { saveToTopic } from '@/modes/playlists';
import { useStorage } from '@/ui/hooks';
import { SpaceIcon } from '@/ui/icons';
import { LogoMark } from '@/ui/components/primitives';
import { YtLink } from '@/ui/nav';
import { sendMessage } from '@/messaging/runtime';
import type { WatchState } from '../store';
import { useFeedView } from '../data/hooks';
import { learningPathFor } from '../data/series';
import { formatDuration } from './FeedCard';
import { LearningPathPanel, NowLearning } from './LearningPanel';

interface RailVideo {
  id: string;
  title: string;
  channelTitle: string;
  views: number | null;
  time: string;
  durationSec: number | null;
  url: string;
  tag: string;
  source: 'subscription' | 'discovery';
  sameChannel: boolean;
  relevance: number;
}

const watch = (id: string, list?: string | null) => `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ''}`;
const byRelevance = (a: RailVideo, b: RailVideo) => b.relevance - a.relevance;

/**
 * The learning rail next to the player, in order of what matters for learning:
 *
 *   1. Your course — the creator's playlist (or a detected series): here → next → then
 *   2. You're learning — the current concept, the video outline, AI actions
 *   3. More from this creator
 *   4. From your subscriptions
 *   5. Best from YouTube (discovery), then weaker related videos
 *
 * Relevance scoring never reorders the course itself.
 */
export function WatchRail({
  mode,
  settings,
  video,
  watch: watchState,
  assessment,
  policy,
  showingNative,
  onToggleNative,
}: {
  mode: LearningMode;
  settings: Settings;
  video: { id: string; meta: VideoMetadata | null; failed: boolean };
  watch: WatchState | null;
  assessment: Assessment | null;
  policy: RelatedVideosPolicy;
  showingNative: boolean;
  onToggleNative: () => void;
}) {
  const history = useStorage(['watchHistory'] as const);
  const { view, channelIds } = useFeedView(mode);
  const data = watchState?.id === video.id ? watchState.data : null;
  const loading = !watchState || watchState.id !== video.id || watchState.status === 'loading';
  const [path, setPath] = useState<LearningPath | null>(null);
  const meta = video.meta;

  useEffect(() => {
    setPath(null);
    if (!data || !meta) return;
    let alive = true;
    learningPathFor(
      { videoId: video.id, title: meta.title, channelId: meta.channelId ?? null, channelTitle: meta.channelTitle ?? '', playlistId: data.playlist?.id ?? null },
      { playlist: data.playlist, descriptionPlaylists: data.descriptionPlaylists, pool: data.related, history: history?.watchHistory ?? [], currentVideoId: video.id },
    )
      .then((next) => alive && setPath(next))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // History changes while watching shouldn't reshuffle the rail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id, data, meta?.title]);

  const groups = useMemo(() => {
    const empty = { creator: [] as RailVideo[], subscriptions: [] as RailVideo[], discovery: [] as RailVideo[], more: [] as RailVideo[] };
    if (!data || !meta) return empty;
    const classifier = getClassifier();
    const known = new Set(channelIds);
    const inPath = new Set(path?.state.series.items.map((i) => i.videoId) ?? []);
    const onTrack = assessment?.verdict === 'on-track';
    const out: RailVideo[] = [];
    for (const v of data.related) {
      if (v.isShort || v.isLive || v.id === video.id || inPath.has(v.id)) continue;
      const cls = classifier.classify({ videoId: v.id, title: v.title, channelId: v.channelId ?? undefined, channelTitle: v.channelTitle }, mode);
      if (cls.strength === 'blocked') continue;
      const sameChannel = !!v.channelId && v.channelId === meta.channelId;
      // Lessons from the same teacher count even when their titles are terse ("L18. Implement LRU Cache").
      const sameTeacher = onTrack && sameChannel && (cls.topical >= 0.3 || cls.learning >= 0.6 || !!seriesNumber(v.title));
      if (cls.relevance < FEED_MIN_SCORE && !sameTeacher) continue;
      out.push(toRail(v, known.has(v.channelId ?? '') ? 'subscription' : 'discovery', sameChannel, sameChannel && cls.relevance < FEED_MIN_SCORE ? 'Same channel' : TIER_LABEL[cls.tier], Math.max(cls.relevance, sameTeacher ? 0.6 : 0)));
    }
    const creator = out.filter((r) => r.sameChannel).sort(byRelevance).slice(0, 4);
    const subscriptions = out.filter((r) => !r.sameChannel && r.source === 'subscription').sort(byRelevance);
    const outside = out.filter((r) => !r.sameChannel && r.source === 'discovery').sort(byRelevance);
    const discovery = outside.filter((r) => r.relevance >= 0.75).slice(0, 2);
    const more = outside.filter((r) => !discovery.includes(r)).slice(0, 3);

    // Few subscription matches here? Add the best related videos from the user's own library.
    const topicId = assessment?.classification.topicId;
    if (subscriptions.length < 4 && view && topicId) {
      const have = new Set([...out.map((r) => r.id), video.id, ...inPath]);
      for (const v of view.items) {
        if (subscriptions.length >= 6) break;
        if (have.has(v.id) || (v.topicScores[topicId] ?? 0) < 0.5) continue;
        subscriptions.push({ id: v.id, title: v.title, channelTitle: v.channelTitle, views: v.views, time: '', durationSec: v.durationSec, url: watch(v.id), tag: TIER_LABEL[v.tier], source: 'subscription', sameChannel: false, relevance: v.relevance });
      }
    }
    return { creator, subscriptions: subscriptions.slice(0, 6), discovery, more };
  }, [data, meta, path, assessment, channelIds, mode, view, video.id]);

  const topicName = assessment?.topicName ?? null;
  const verdict = assessment?.verdict;
  const channelRef = meta?.channelId || meta?.channelHandle ? { id: meta.channelId ?? '', title: meta.channelTitle ?? meta.channelHandle ?? '', handle: meta.channelHandle } : null;
  const rule = channelRef ? channelRuleOf(mode, channelRef) : null;
  const showRelated = policy !== 'hide';
  const nothing = !loading && !path && !groups.creator.length && !groups.subscriptions.length && !groups.discovery.length && !groups.more.length;

  return (
    <div className="fs-rail" aria-label={`FocusSpace · ${mode.name}`}>
      {/*
        The way out to focusspace.app, at the top of the suggestion column where
        the eye lands first. Deliberately one compact row — it sits above the
        learner's actual course, so it earns its place by being small.
      */}
      <button type="button" className="fs-rail-launcher" onClick={() => void sendMessage('site/open', {}).catch(() => undefined)} title="Open FocusSpace — notes, mind maps and plans">
        <LogoMark size={20} />
        <span className="fs-rail-launcher-name">FocusSpace</span>
        <span className="fs-rail-launcher-hint">Notes · Mind maps · Plans</span>
        <ExternalLink size={14} aria-hidden />
      </button>
      <header className="fs-rail-head">
        <div className="fs-rail-brand">
          <SpaceIcon name={mode.icon} size={16} />
          <span className="fs-rail-brand-name">
            {mode.name}
            {topicName && <span className="fs-rail-brand-topic"> · {topicName}</span>}
          </span>
          {assessment && verdict !== 'on-track' && <span className="fs-rail-flag">{verdict === 'unclear' ? 'Possibly related' : 'Not in this space'}</span>}
        </div>
        <div className="fs-rail-tools">
          {channelRef && verdict !== 'on-track' && rule !== 'allowed' && (
            <button type="button" className="fs-link fs-rail-allow" onClick={() => void setChannelRule(mode.id, channelRef, 'allowed')} title="Always allow this channel in this space">
              <ShieldCheck size={14} aria-hidden /> Allow channel
            </button>
          )}
          {mode.topics.length > 0 && meta && <SaveToTopic mode={mode} meta={meta} suggested={assessment?.classification.topicId ?? null} />}
        </div>
      </header>

      {/* AI comes first — see docs' "watch-page AI priority": the learner shouldn't scroll past the course/Knowledge Map to reach it. */}
      {meta && mode.kind !== 'media' && (
        <NowLearning
          mode={mode}
          video={{ id: video.id, title: meta.title, channelTitle: meta.channelTitle ?? '' }}
          page={data}
          path={path}
          topicId={assessment?.classification.topicId ?? null}
          ai={settings.ai}
          debug={settings.debugRelevance}
        />
      )}

      {path && <LearningPathPanel path={path} currentId={video.id} />}

      {loading && !path && (
        <div className="fs-sec" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fs-rail-item">
              <div className="fs-skeleton fs-rail-thumb" />
              <div className="fs-grow">
                <div className="fs-skeleton" style={{ height: 14, width: '90%' }} />
                <div className="fs-skeleton" style={{ height: 12, width: '50%', marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showRelated && <RailSection title={`More from ${meta?.channelTitle || 'this creator'}`} items={groups.creator} />}
      {showRelated && <RailSection title="From your subscriptions" items={groups.subscriptions} />}
      {showRelated && <RailSection title="Best from YouTube" items={groups.discovery} />}
      {showRelated && <RailSection title="More related" items={groups.more} />}

      {nothing && <p className="fs-muted-line">No clearly related videos for {mode.name} here.</p>}

      {policy !== 'show' && (
        <button type="button" className="fs-link fs-rail-native" onClick={onToggleNative}>
          {showingNative ? "Hide YouTube's suggestions" : "Show YouTube's suggestions"}
        </button>
      )}
    </div>
  );
}

function toRail(v: YtVideo, source: RailVideo['source'], sameChannel: boolean, tag: string, relevance: number): RailVideo {
  return { id: v.id, title: v.title, channelTitle: v.channelTitle, views: v.views, time: v.publishedText, durationSec: v.durationSec, url: watch(v.id), tag, source, sameChannel, relevance };
}

function RailSection({ title, items }: { title: string; items: RailVideo[] }) {
  if (!items.length) return null;
  return (
    <section className="fs-sec" aria-label={title}>
      <div className="fs-sec-label">
        <span>{title}</span>
      </div>
      <div className="fs-rail-list">
        {items.map((r) => (
          <RailItem key={r.id} item={r} />
        ))}
      </div>
    </section>
  );
}

function RailItem({ item }: { item: RailVideo }) {
  const duration = formatDuration(item.durationSec);
  return (
    <div className="fs-rail-item">
      <YtLink href={item.url} className="fs-rail-thumb" tabIndex={-1} aria-hidden="true">
        <img src={`https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`} alt="" loading="lazy" />
        {duration && <span className="fs-duration">{duration}</span>}
      </YtLink>
      <div className="fs-grow">
        <YtLink href={item.url} className="fs-rail-title">
          {item.title}
        </YtLink>
        <div className="fs-rail-sub">{item.channelTitle}</div>
        <div className="fs-rail-sub">{[item.views !== null ? `${compactNumber(item.views)} views` : '', item.time].filter(Boolean).join(' • ')}</div>
      </div>
    </div>
  );
}

function SaveToTopic({ mode, meta, suggested }: { mode: LearningMode; meta: VideoMetadata; suggested: string | null }) {
  const [topicId, setTopicId] = useState(suggested ?? mode.topics[0]?.id ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    setTopicId(suggested ?? mode.topics[0]?.id ?? '');
    setSaved(null);
  }, [meta.videoId, suggested, mode.topics]);
  const topic = mode.topics.find((t) => t.id === topicId);
  return (
    <span className="fs-save" title="Save to a topic playlist">
      <Bookmark size={14} aria-hidden />
      <select value={topicId} onChange={(e) => setTopicId(e.target.value)} aria-label="Topic playlist">
        {mode.topics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="fs-link"
        disabled={!topic || saved === topicId}
        onClick={async () => {
          await saveToTopic(mode.id, topicId, { videoId: meta.videoId, title: meta.title, channelTitle: meta.channelTitle ?? '' });
          setSaved(topicId);
        }}
      >
        {saved === topicId ? (
          <>
            <Check size={14} aria-hidden /> Saved
          </>
        ) : (
          'Save'
        )}
      </button>
    </span>
  );
}
