import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, ChevronRight, History, Pencil, Plus, Power, RefreshCw, Sparkles, Trophy, Users, X } from 'lucide-react';
import type { LearningMode, Settings, Topic } from '@/types/domain';
import { activeModeOf, addTemplateWithChannels, missingTemplates, selectMode, setChannelRule, setFocusEnabled, SpaceLimitError } from '@/modes/service';
import { groupByCategory } from '@/modes/categories';
import { parseVideoInput, removeFromTopic, saveToTopic } from '@/modes/playlists';
import { updateItem } from '@/storage/storage';
import { sendMessage } from '@/messaging/runtime';
import { composeFeed } from '@/learning/feed';
import { topicItems, type FeedVideo, type FeedView } from '@/learning/feed-view';
import type { DiscoveredVideo } from '@/learning/discovery';
import { relativeTime } from '@/learning/library';
import { normalizeText } from '@/learning/text';
import { channelUrl, searchUrl, watchUrl } from '@/integrations/youtube/urls';
import { useStorage } from '@/ui/hooks';
import { SpaceIcon } from '@/ui/icons';
import { YtLink } from '@/ui/nav';
import { Button } from '@/ui/components/primitives';
import { Modal } from '@/ui/components/Modal';
import { TemplateCreators } from '@/ui/components/TemplateCreators';
import type { PickedChannel } from '@/ui/components/ChannelPicker';
import { useBecauseYouPlayed, useContinueWatching, useDiscovery, useFeedView } from '../data/hooks';
import { TIER_LABEL } from '@/learning/classifier';
import type { NextLearningItem } from '@/learning/next';
import { examInfo, isExamId, type ExamId } from '@/modes/exams';
import { ExamPicker } from './ExamPicker';
import { Billboard, type Featured } from './home/Billboard';
import { Row } from './home/Row';
import { PosterCard, PosterSkeletons } from './home/PosterCard';
import { usePinnedBar } from './home/usePinnedBar';
import { FocusSpaceHistoryRow, FocusSpaceLibraryRow } from './home/FocusSpaceRows';
import { continueToVisible, discoveredToVisible, libraryToVisible, publishContinueWatching, publishFeedVideos } from '../data/visible-feed';
import type { CardData } from './FeedCard';

const PAGE = 16;

/** FocusSpace's home inside YouTube: pick a space (or, first, an exam), then a streaming-style home. */
export function SpaceHome({ settings, modes, onCreateSpace }: { settings: Settings; modes: LearningMode[]; onCreateSpace: () => void }) {
  const mode = activeModeOf(settings, modes);
  const [topicId, setTopicId] = useState<string | null>(null);

  useEffect(() => setTopicId(null), [mode?.id]);

  if (!mode || !settings.onboarded) return <FirstRun settings={settings} modes={modes} onCreate={onCreateSpace} />;

  return (
    <div className="fs-home">
      <SpaceBar mode={mode} modes={modes} topicId={topicId} onTopic={setTopicId} onCreate={onCreateSpace} />
      <SpaceFeed key={mode.id} mode={mode} topicId={topicId} onTopic={setTopicId} />
    </div>
  );
}

/**
 * First, the exam ("Which exam are you preparing for?") — unless they already answered it or already
 * have Spaces. Then the Spaces the learner already has, then suggestions. A suggestion is only a
 * template until it is picked: choosing one creates the Space (and so counts it against the
 * allowance) — nothing is handed out up front.
 */
function FirstRun({ settings, modes, onCreate }: { settings: Settings; modes: LearningMode[]; onCreate: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<LearningMode | null>(null);
  const [pendingExam, setPendingExam] = useState<ExamId | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestions = missingTemplates(modes);

  if (settings.exam === null && modes.length === 0) {
    return (
      <div className="fs-first-run fs-exam-stage">
        <div className="fs-exam-stage-glow" aria-hidden />
        <span className="fs-exam-stage-eyebrow">Step 1 of 2 · Your goal</span>
        <h1>Which exam are you preparing for?</h1>
        <p>FocusSpace turns YouTube into a classroom for that exam: only lessons from your syllabus, your teachers first, nothing else on the page.</p>
        <ExamPicker />
      </div>
    );
  }

  const finish = async (mode: LearningMode, channels: PickedChannel[]) => {
    setError(null);
    setBusy(true);
    try {
      await addTemplateWithChannels(mode.id, channels.map((c) => ({ id: c.id, title: c.title, handle: c.handle ?? undefined })));
      await selectMode(mode.id);
      await updateItem('settings', (s) => ({ ...s, onboarded: true, defaultModeId: s.defaultModeId ?? mode.id }));
      setPendingTemplate(null);
    } catch (err) {
      setError(err instanceof SpaceLimitError ? err.message : 'FocusSpace couldn’t create that Space. Try again.');
    } finally {
      setBusy(false);
    }
  };

  /** An already-created Space is just switched to; a template opens the (skippable) creator step first. */
  const choose = async (mode: LearningMode, isSuggestion: boolean) => {
    // Exams and B.Tech have their own questions (optional subject, branch & year) before creators.
    if (isSuggestion && isExamId(mode.id)) return setPendingExam(mode.id);
    if (isSuggestion) return setPendingTemplate(mode);
    setError(null);
    try {
      await selectMode(mode.id);
      await updateItem('settings', (s) => ({ ...s, onboarded: true, defaultModeId: s.defaultModeId ?? mode.id }));
    } catch (err) {
      setError(err instanceof SpaceLimitError ? err.message : 'FocusSpace couldn’t create that Space. Try again.');
    }
  };
  /*
   * The learner's own Spaces come first and uncategorised — they already know what those are. Only the
   * suggestions are grouped, because that is where the list is long enough to need shape and where the
   * grouping does real work: it answers "what else is FocusSpace for?" without turning into a catalogue.
   */
  const groups = groupByCategory(suggestions);

  return (
    <div className="fs-first-run fs-animate-in">
      <h1>What do you want to focus on?</h1>
      <p>FocusSpace organises YouTube around it: your subscriptions first, then the best matches from the rest of YouTube. You can switch anytime.</p>


      {modes.length > 0 && (
        <div className="fs-first-run-group">
          <span className="fs-first-run-label">Your spaces</span>
          <div className="fs-chips fs-chips-wrap">
            {modes.map((m) => (
              <button key={m.id} type="button" className="fs-chip fs-chip-lg" onClick={() => void choose(m, false)}>
                <SpaceIcon name={m.icon} size={18} />
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {groups.map(({ category, modes: templates }) => (
        <div key={category.id} className="fs-first-run-group">
          <span className="fs-first-run-label">
            {category.name}
            <small>{category.description}</small>
          </span>
          <div className="fs-chips fs-chips-wrap">
            {templates.map((m) => (
              <button key={m.id} type="button" className="fs-chip fs-chip-lg" onClick={() => void choose(m, true)}>
                <SpaceIcon name={m.icon} size={18} />
                {m.name}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="fs-chips fs-chips-wrap">
        <button type="button" className="fs-chip fs-chip-lg fs-chip-outline" onClick={onCreate}>
          <Plus size={18} aria-hidden />
          Something else
        </button>
      </div>
      {error && <p className="fs-error" role="alert">{error}</p>}

      {/*
        An explicit way out. Someone who opened YouTube to watch one thing
        should not have to pick a subject first, and "close the extension" is
        the wrong answer to "not right now" — this turns Focus Mode off and
        leaves YouTube exactly as it was, with a small pill to come back by.
      */}
      <div className="fs-first-run-opt-out">
        <p>Not right now?</p>
        <button type="button" className="fs-link" onClick={() => void browseNormally()}>
          Just browse YouTube
        </button>
        <span className="fs-caption">FocusSpace turns off. Nothing is hidden, nothing is reordered. Turn it back on whenever you want.</span>
      </div>

      <Modal open={!!pendingExam} onClose={() => setPendingExam(null)} title={pendingExam ? `Set up ${examInfo(pendingExam)?.label}` : 'Set up'} subtitle="A couple of quick choices, then your Space is ready." width={720}>
        {pendingExam && <ExamPicker initialExam={pendingExam} onChosen={() => setPendingExam(null)} />}
      </Modal>

      <Modal
        open={!!pendingTemplate}
        onClose={() => setPendingTemplate(null)}
        title={pendingTemplate ? `Creators for ${pendingTemplate.name}` : 'Creators'}
        subtitle="Optional. You can skip this and change it later."
        width={560}
      >
        {pendingTemplate && (
          <TemplateCreators
            template={pendingTemplate}
            busy={busy}
            onSkip={() => void finish(pendingTemplate, [])}
            onContinue={(channels) => void finish(pendingTemplate, channels)}
          />
        )}
      </Modal>
    </div>
  );
}

/**
 * Leaves YouTube untouched, but marks onboarding done: the picker has been
 * seen and answered ("not now" is an answer), so it must not reappear every
 * time the learner opens YouTube. Turning Focus back on returns them to the
 * picker only if they never actually chose a space.
 */
async function browseNormally() {
  await updateItem('settings', (s) => ({ ...s, onboarded: true }));
  await setFocusEnabled(false);
}

function SpaceBar({ mode, modes, topicId, onTopic, onCreate }: { mode: LearningMode; modes: LearningMode[]; topicId: string | null; onTopic: (id: string | null) => void; onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const pin = usePinnedBar();

  return (
    <>
    <div ref={pin.anchor} style={pin.spacer} aria-hidden />
    <div className={`fs-bar${pin.pinned ? ' is-pinned' : ''}`} ref={pin.bar} style={pin.style}>
      <div className="fs-space-menu" ref={ref}>
        <button type="button" className="fs-space-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <SpaceIcon name={mode.icon} size={18} />
          <span>{mode.name}</span>
          <ChevronDown size={16} aria-hidden />
        </button>
        {open && (
          <div className="fs-menu" role="menu">
            <div className="fs-menu-label">Your spaces</div>
            {modes.map((m) => (
              <button key={m.id} type="button" role="menuitemradio" aria-checked={m.id === mode.id} className="fs-menu-item" onClick={run(() => void selectMode(m.id))}>
                <SpaceIcon name={m.icon} size={18} />
                <span>{m.name}</span>
                {m.id === mode.id && <Check size={16} aria-hidden />}
              </button>
            ))}
            <div className="fs-menu-sep" />
            <button type="button" role="menuitem" className="fs-menu-item" onClick={run(onCreate)}>
              <Plus size={18} aria-hidden />
              <span>New space</span>
            </button>
            <div className="fs-menu-sep" />
            <button type="button" role="menuitem" className="fs-menu-item" onClick={run(() => void sendMessage('dashboard/open', { route: `/modes/${mode.id}` }))}>
              <Pencil size={18} aria-hidden />
              <span>Edit {mode.name}</span>
            </button>
            <button type="button" role="menuitem" className="fs-menu-item" onClick={run(() => void setFocusEnabled(false))}>
              <Power size={18} aria-hidden />
              <span>Turn off Focus Mode</span>
            </button>
          </div>
        )}
      </div>
      {mode.topics.length > 0 && (
        <div className="fs-chips" role="tablist" aria-label={`${mode.name} topics`}>
          <button type="button" role="tab" className="fs-chip" aria-selected={!topicId} onClick={() => onTopic(null)}>
            All
          </button>
          {mode.topics.map((t, i) => (
            <Fragment key={t.id}>
              {/* The hierarchy, inline: "Prelims · GS", "Mains", "Optional", "Year 2" before their topics. */}
              {t.group && t.group !== mode.topics[i - 1]?.group && (
                <span className="fs-chip-group" aria-hidden>
                  {t.group}
                </span>
              )}
              <button type="button" role="tab" className="fs-chip" aria-selected={t.id === topicId} onClick={() => onTopic(t.id === topicId ? null : t.id)} title={t.group ? `${t.group} → ${t.name}` : t.name}>
                {t.name}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

function useSentinel(onVisible: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && callback.current(), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

const why = (mode: LearningMode, topicId: string | null, matched: string[]) => {
  const topic = mode.topics.find((t) => t.id === topicId)?.name;
  return `Matches ${mode.name}${topic ? ` → ${topic}` : ''}${matched.length ? ` (${matched.slice(0, 3).join(', ')})` : ''}`;
};

/** One video, whichever list it came from, with what the home's shelves need to sort and group it. */
interface Pick {
  card: CardData;
  relevance: number;
  topicId: string | null;
}

const MIN_ROW = 3;
const MAX_TOPIC_ROWS = 6;

function SpaceFeed({ mode, topicId, onTopic }: { mode: LearningMode; topicId: string | null; onTopic: (id: string | null) => void }) {
  const topic = mode.topics.find((t) => t.id === topicId) ?? null;
  // A subject's subtopics (DBMS → normalization, SQL, transactions): a second row of chips that narrows it.
  const subtopics = useMemo(() => (topic ? topic.keywords.filter((k) => !k.startsWith('~') && normalizeText(k) !== normalizeText(topic.name)).slice(0, 12) : []), [topic]);
  const [subtopic, setSubtopic] = useState<string | null>(null);
  useEffect(() => setSubtopic(null), [topicId]);
  const { view, loading, channelIds } = useFeedView(mode);
  const store = useStorage(['watchHistory', 'sync'] as const);
  const subs = useMemo(() => {
    const list = !view ? [] : topic ? topicItems(view, topic.id) : view.items;
    if (!subtopic) return list;
    const want = normalizeText(subtopic);
    return list.filter((v) => normalizeText(v.title).includes(want) || v.matched.some((m) => normalizeText(m) === want));
  }, [view, topic, subtopic]);
  const libraryIds = useMemo(() => (view ? view.items.map((v) => v.id) : []), [view]);
  // Searching YouTube for the subtopic itself, still filed under its subject.
  const searchTopic = useMemo(() => (topic && subtopic ? { ...topic, name: subtopic } : topic), [topic, subtopic]);
  const discovery = useDiscovery(mode, searchTopic, libraryIds, channelIds);
  const continuing = useContinueWatching(mode, view);
  const progress = useMemo(() => new Map((store?.watchHistory ?? []).map((e) => [e.videoId, e.progress])), [store?.watchHistory]);
  const [visible, setVisible] = useState(PAGE);

  useEffect(() => setVisible(PAGE), [topicId]);

  const entries = useMemo(
    () =>
      composeFeed(subs, discovery.items, {
        every: 4,
        isSpotlight: (d) => d.cls.tier === 'excellent',
        idOf: { primary: (v) => (v as FeedVideo).id, discovery: (d) => d.video.id },
        dividerLabel: 'More from YouTube',
      }),
    [subs, discovery.items],
  );

  // Keep discovery filling the feed as the user scrolls — never padding with weak matches.
  useEffect(() => {
    if (!discovery.loading && !discovery.exhausted && entries.length < visible + 4) discovery.loadMore();
  }, [entries.length, visible, discovery.loading, discovery.exhausted, discovery.loadMore]);

  /*
   * Publish what is on screen so the AI entry describes this page rather than
   * re-deriving a different one (data/visible-feed.ts). Only the entries the
   * learner can actually see are published, in their rendered order.
   */
  const shown = useMemo(
    () =>
      entries.slice(0, visible).flatMap((entry) => {
        if (entry.type === 'primary') return [libraryToVisible(entry.item as FeedVideo)];
        if (entry.type === 'discovery') return [discoveredToVisible(entry.item)];
        return [];
      }),
    [entries, visible],
  );
  useEffect(() => publishFeedVideos(shown, topic?.name ?? null), [shown, topic]);
  const continueShown = useMemo(() => continuing.slice(0, 4).map(continueToVisible), [continuing]);
  useEffect(() => publishContinueWatching(continueShown), [continueShown]);

  const sentinel = useSentinel(() => setVisible((v) => (entries.length > v ? v + PAGE : v)));

  const subCard = (v: FeedVideo): CardData => ({
    id: v.id,
    title: v.title,
    channelTitle: v.channelTitle,
    views: v.views,
    time: relativeTime(v.publishedAt),
    durationSec: v.durationSec,
    progress: progress.get(v.id) ?? null,
    tier: v.tier,
    source: v.source,
    why: why(mode, v.topicId, v.matched),
  });
  const discCard = (d: DiscoveredVideo): CardData => ({
    id: d.video.id,
    title: d.video.title,
    channelTitle: d.video.channelTitle,
    views: d.video.views,
    time: d.video.publishedText,
    durationSec: d.video.durationSec,
    progress: progress.get(d.video.id) ?? (d.video.watchedPercent !== null ? d.video.watchedPercent / 100 : null),
    tier: d.cls.tier,
    source: 'discovery',
    why: d.reasons.join(' · '),
  });

  // Every video once, best first: the pool the billboard, Top 10 and topic shelves draw from.
  const picks = useMemo(() => {
    const seen = new Set<string>();
    const all: Pick[] = [];
    for (const v of subs) if (!seen.has(v.id) && seen.add(v.id)) all.push({ card: subCard(v), relevance: v.relevance, topicId: v.topicId });
    for (const d of discovery.items) if (!seen.has(d.video.id) && seen.add(d.video.id)) all.push({ card: discCard(d), relevance: d.cls.relevance, topicId: d.topicId });
    return all.sort((a, b) => b.relevance - a.relevance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, discovery.items, progress]);

  const topicName = (id: string | null) => mode.topics.find((t) => t.id === id)?.name ?? null;
  const featured = useMemo<Featured[]>(() => {
    const out: Featured[] = [];
    const resume = continuing.find((c) => c.kind === 'resume' && (c.progress ?? 0) > 0.02);
    if (resume)
      out.push({ id: resume.videoId, title: resume.title, channelTitle: resume.channelTitle, durationSec: null, eyebrow: 'Continue learning', why: resume.reason, tierLabel: null, progress: resume.progress, topicId: null, topicName: null });
    picks
      .filter((p) => p.card.tier === 'excellent' || p.card.tier === 'strong')
      .slice(0, 5 - out.length)
      .forEach((p, i) =>
        out.push({
          id: p.card.id,
          title: p.card.title,
          channelTitle: p.card.channelTitle,
          durationSec: p.card.durationSec,
          eyebrow: i === 0 ? `Best ${mode.name} video for you` : p.card.source === 'discovery' ? 'Fresh pick for you' : 'From your channels',
          why: p.card.why,
          tierLabel: TIER_LABEL[p.card.tier],
          progress: p.card.progress,
          topicId: p.topicId,
          topicName: topicName(p.topicId),
        }),
      );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, continuing, mode]);

  const topicRows = useMemo(() => {
    if (topic) return [];
    return mode.topics
      .map((t) => ({ topic: t, items: picks.filter((p) => p.topicId === t.id).slice(0, 14) }))
      .filter((r) => r.items.length >= MIN_ROW)
      .sort((a, b) => b.items.length - a.items.length)
      .slice(0, MAX_TOPIC_ROWS);
  }, [picks, mode.topics, topic]);

  const top10 = picks.slice(0, 10);
  const fromChannels = subs.slice(0, 16).map(subCard);
  const fresh = discovery.items.slice(0, 16).map(discCard);
  const summary = [subs.length ? `${subs.length} from your channels` : '', discovery.items.length ? `${discovery.items.length} fresh picks` : ''].filter(Boolean).join(' · ');
  const noChannels = !!view && view.channelCount === 0;
  const empty = !loading && entries.length === 0 && (discovery.exhausted || !mode.discovery);
  const syncError = store?.sync.lastError;
  const warming = loading || (discovery.loading && picks.length === 0);

  const notes = (
    <>
      {syncError && (
        <div className="fs-note">
          {syncError}
          <button type="button" className="fs-link" onClick={() => void sendMessage('library/sync', { force: true })}>
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      )}
      {noChannels && (
        <div className="fs-note">
          No subscriptions in FocusSpace yet. {mode.discovery ? "We're showing great matches from across YouTube." : 'Turn on discovery or import them.'}
          <button type="button" className="fs-link" onClick={() => void sendMessage('subscriptions/import', {})}>
            Import my subscriptions
          </button>
        </div>
      )}
    </>
  );

  const emptyState = empty && (
    <div className="fs-empty-yt">
      <h3>{topic ? `No clear ${topic.name} videos yet` : `No clear ${mode.name} videos yet`}</h3>
      <p>FocusSpace only shows videos that clearly match. It never fills the page with guesses.</p>
      <YtLink href={searchUrl(topic ? `${topic.name} ${mode.searchHint || mode.name}` : mode.searchHint || mode.name)} className="fs-btn fs-btn-secondary">
        Search YouTube for “{topic ? topic.name : mode.name}”
      </YtLink>
    </div>
  );

  const grid = (
    <>
      <div className="fs-poster-grid">
        {entries.slice(0, visible).map((entry) => {
          if (entry.type === 'divider')
            return (
              <div key={entry.key} className="fs-divider-row">
                <span>{entry.label}</span>
              </div>
            );
          return <PosterCard key={entry.key} card={entry.type === 'primary' ? subCard(entry.item as FeedVideo) : discCard(entry.item)} />;
        })}
        {(loading || (discovery.loading && entries.length < visible)) && <PosterSkeletons count={entries.length ? 4 : 8} />}
      </div>
      <div ref={sentinel} className="fs-sentinel" aria-hidden />
    </>
  );

  if (topic) {
    return (
      <>
        <section className="fs-section" aria-label={`${topic.name} videos`}>
          <div className="fs-section-head">
            <h2>{subtopic ? `${topic.name} · ${subtopic}` : `${topic.name} videos`}</h2>
            {summary && <span>{summary}</span>}
          </div>
          {subtopics.length > 0 && (
            <div className="fs-subtopics" role="tablist" aria-label={`${topic.name} subtopics`}>
              <span className="fs-subtopics-label">Subtopics</span>
              <button type="button" role="tab" className="fs-chip" aria-selected={!subtopic} onClick={() => setSubtopic(null)}>
                All of {topic.name}
              </button>
              {subtopics.map((k) => (
                <button key={k} type="button" role="tab" className="fs-chip" aria-selected={subtopic === k} onClick={() => setSubtopic(subtopic === k ? null : k)}>
                  {k.replace(/\b\w/g, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
          )}
          {notes}
          {grid}
          {emptyState}
          {discovery.error && entries.length > 0 && <div className="fs-note">{discovery.error}</div>}
        </section>
        <TopicPlaylist mode={mode} topic={topic} />
      </>
    );
  }

  return (
    <>
      {featured.length > 0 ? <Billboard items={featured} onTopic={onTopic} /> : warming ? <div className="fs-billboard fs-billboard-skeleton fs-skeleton" aria-hidden /> : null}
      {notes}

      {continuing.length > 0 && (
        <Row title="Continue learning" icon={<History size={20} aria-hidden />}>
          {continuing.slice(0, 12).map((item) => (
            <PosterCard
              key={item.videoId}
              card={{ id: item.videoId, url: item.url, title: item.title, channelTitle: item.channelTitle, views: null, time: CONTINUE_LABEL[item.kind], durationSec: null, progress: item.progress, tier: 'strong', source: 'subscription', why: item.reason }}
            />
          ))}
        </Row>
      )}

      {mode.kind !== 'learning' && <BecauseYouPlayed mode={mode} />}

      {top10.length >= MIN_ROW && (
        <Row title={`Top ${Math.min(10, top10.length)} best ${mode.name} videos`} icon={<Trophy size={20} aria-hidden />} className="fs-shelf-top10">
          {top10.map((p, i) => (
            <PosterCard key={p.card.id} card={p.card} rank={i + 1} />
          ))}
        </Row>
      )}
      {warming && picks.length === 0 && (
        <Row title={`Finding the best of ${mode.name}…`}>
          <PosterSkeletons count={6} />
        </Row>
      )}

      {topicRows.map(({ topic: t, items }) => (
        <Row
          key={t.id}
          title={t.name}
          action={
            <button type="button" className="fs-shelf-more" onClick={() => onTopic(t.id)}>
              See all <ChevronRight size={14} aria-hidden />
            </button>
          }
        >
          {items.map((p) => (
            <PosterCard key={p.card.id} card={p.card} />
          ))}
        </Row>
      ))}

      {fresh.length >= MIN_ROW && (
        <Row title="Fresh picks from YouTube" subtitle="New teachers, checked against your syllabus" icon={<Sparkles size={20} aria-hidden />}>
          {fresh.map((c) => (
            <PosterCard key={c.id} card={c} />
          ))}
        </Row>
      )}

      <FocusSpaceHistoryRow />
      <FocusSpaceLibraryRow />

      {/* Your subscriptions come last on purpose: the shelves above are what FocusSpace picked for this Space. */}
      {fromChannels.length >= MIN_ROW && (
        <Row title="From your channels" subtitle="Teachers you already trust" icon={<Users size={20} aria-hidden />}>
          {fromChannels.map((c) => (
            <PosterCard key={c.id} card={c} />
          ))}
        </Row>
      )}

      <section className="fs-section fs-browse" aria-label={`Everything for ${mode.name}`}>
        <div className="fs-section-head">
          <h2>Everything for {mode.name}</h2>
          {summary && <span>{summary}</span>}
        </div>
        {grid}
        {emptyState}
        {discovery.error && entries.length > 0 && <div className="fs-note">{discovery.error}</div>}
      </section>

      <ChannelsSection mode={mode} view={view} discovered={discovery.items} channelIds={channelIds} />
    </>
  );
}

const CONTINUE_LABEL: Record<NextLearningItem['kind'], string> = { missed: 'You skipped this one', resume: 'Pick up where you left off', next: 'Up next in your course' };

/** Music and other just-for-you Spaces: more like what was played here, from YouTube's own "up next". */
function BecauseYouPlayed({ mode }: { mode: LearningMode }) {
  const rows = useBecauseYouPlayed(mode);
  if (!rows.length) return null;
  return (
    <>
      {rows.map((row) => (
        <Row key={row.seed.videoId} title="Because you played" subtitle={row.seed.title}>
          {row.videos.slice(0, 12).map((v) => (
            <PosterCard
              key={v.id}
              card={{
                id: v.id,
                title: v.title,
                channelTitle: v.channelTitle,
                views: v.views,
                time: v.publishedText,
                durationSec: v.durationSec,
                progress: v.watchedPercent !== null ? v.watchedPercent / 100 : null,
                tier: 'strong',
                source: 'discovery',
                why: `Because you played ${row.seed.title}`,
              }}
            />
          ))}
        </Row>
      ))}
    </>
  );
}

function TopicPlaylist({ mode, topic }: { mode: LearningMode; topic: Topic }) {
  const store = useStorage(['topicPlaylists'] as const);
  const saved = store?.topicPlaylists[mode.id]?.[topic.id] ?? [];
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const id = parseVideoInput(input);
    if (!id) return setError('Paste a YouTube video link.');
    setBusy(true);
    try {
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`, { credentials: 'omit' });
      const data = res.ok ? ((await res.json()) as { title?: string; author_name?: string }) : null;
      if (!data?.title) throw new Error('not found');
      await saveToTopic(mode.id, topic.id, { videoId: id, title: data.title, channelTitle: data.author_name ?? '' });
      setInput('');
      setError(null);
    } catch {
      setError("Couldn't find that video.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fs-section fs-playlist" aria-label={`${topic.name} playlist`}>
      <div className="fs-section-head">
        <h2>{topic.name}</h2>
        <span>
          Your playlist · {saved.length} {saved.length === 1 ? 'video' : 'videos'}
        </span>
      </div>
      {saved.length > 0 ? (
        <ol className="fs-playlist-list">
          {saved.map((v, i) => (
            <li key={v.videoId}>
              <span className="fs-playlist-index">{String(i + 1).padStart(2, '0')}</span>
              <YtLink href={watchUrl(v.videoId)} className="fs-playlist-item">
                <img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
                <span>
                  <b>{v.title}</b>
                  <small>{v.channelTitle}</small>
                </span>
              </YtLink>
              <button type="button" className="fs-icon-plain" aria-label={`Remove ${v.title}`} onClick={() => void removeFromTopic(mode.id, topic.id, v.videoId)}>
                <X size={16} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="fs-muted-line">Save videos to {topic.name} from the watch page, or paste a link below.</p>
      )}
      <form className="fs-playlist-add" onSubmit={add}>
        <input className="fs-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Paste a YouTube link to add it to ${topic.name}`} aria-label={`Add a video to ${topic.name}`} />
        <Button type="submit" size="sm" icon={<Plus />} loading={busy} disabled={!input.trim()}>
          Add video
        </Button>
      </form>
      {error && <span className="fs-muted-line fs-error">{error}</span>}
    </section>
  );
}

function ChannelsSection({ mode, view, discovered, channelIds }: { mode: LearningMode; view: FeedView | null; discovered: DiscoveredVideo[]; channelIds: string[] }) {
  const [added, setAdded] = useState<string[]>([]);
  const mine = (view?.channels ?? []).filter((c) => (c.kind === 'educational' || c.kind === 'adjacent') && c.relevant > 0).slice(0, 8);
  const fresh = useMemo(() => {
    const known = new Set(channelIds);
    const counts = new Map<string, { id: string; title: string; count: number }>();
    for (const d of discovered) {
      const id = d.video.channelId;
      if (!id || known.has(id)) continue;
      const entry = counts.get(id) ?? { id, title: d.video.channelTitle, count: 0 };
      entry.count++;
      counts.set(id, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [discovered, channelIds]);

  if (!mine.length && !fresh.length) return null;

  const addChannel = async (c: { id: string; title: string }) => {
    setAdded((a) => [...a, c.id]);
    await setChannelRule(mode.id, { id: c.id, title: c.title }, 'allowed');
    void sendMessage('channel/add', { input: c.id }).catch(() => undefined);
  };

  return (
    <section className="fs-section" aria-label={`Channels for ${mode.name}`}>
      <div className="fs-section-head">
        <h2>Channels for {mode.name}</h2>
      </div>
      <div className="fs-channel-columns">
        {mine.length > 0 && (
          <div>
            <div className="fs-subhead">From your subscriptions</div>
            <div className="fs-channel-list">
              {mine.map((c) => (
                <YtLink key={c.id} href={channelUrl(c.id)} className="fs-channel-row-yt">
                  {c.thumbnail ? <img src={c.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="fs-avatar-yt">{c.title.slice(0, 1)}</span>}
                  <span className="fs-grow">
                    <b>{c.title}</b>
                    <small>
                      {c.relevant} of {c.total} recent videos match
                    </small>
                  </span>
                </YtLink>
              ))}
            </div>
          </div>
        )}
        {fresh.length > 0 && (
          <div>
            <div className="fs-subhead">Discover new channels</div>
            <div className="fs-channel-list">
              {fresh.map((c) => (
                <div key={c.id} className="fs-channel-row-yt">
                  <span className="fs-avatar-yt">{c.title.slice(0, 1)}</span>
                  <YtLink href={channelUrl(c.id)} className="fs-grow">
                    <b>{c.title}</b>
                    <small>
                      {c.count} great {c.count === 1 ? 'match' : 'matches'} for {mode.name}
                    </small>
                  </YtLink>
                  <button type="button" className="fs-pill-button" disabled={added.includes(c.id)} onClick={() => void addChannel(c)}>
                    {added.includes(c.id) ? 'Added' : 'Add to space'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
