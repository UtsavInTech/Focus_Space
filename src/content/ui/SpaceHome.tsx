import { InstituteHome } from './InstituteHome';
import { isReadOnlySpace } from '@/institutes/home';
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, History, Pencil, Plus, Power, Quote, RefreshCw, Route, Search, Sparkles, Trophy, Users, X } from 'lucide-react';
import type { LearningMode, Settings, Topic } from '@/types/domain';
import { activeModeOf, addTemplateWithChannels, missingTemplates, selectMode, setChannelRule, setFocusEnabled, SpaceLimitError, updateMode } from '@/modes/service';
import { groupId, groupTitle, scopeIds, subjectAsTopic, subjectOf, subtopicsOf, withSubtopic, withTopic } from '@/modes/groups';
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
import type { NextLearningItem } from '@/learning/next';
import { examInfo, isExamId, type ExamId } from '@/modes/exams';
import { ExamPicker } from './ExamPicker';
import { Billboard, type Featured } from './home/Billboard';
import { Row } from './home/Row';
import { PosterCard, PosterSkeletons, thumbnailUrl } from './home/PosterCard';
import { buildTopicPlan, currentStep, quoteOfTheDay, SPACE_INTRO, type PlanStep, type PlanVideo } from './home/topic-plan';
import { usePinnedBar } from './home/usePinnedBar';
import { LearningPath, PathPosition, useTopicProgress, COVERED_AFTER } from './home/LearningPath';
import { lastPlace, useHomeTopic } from './home/nav';
import { FullScreenButton, FullScreenOffer, useFullScreen } from './home/FullScreen';
import { FocusSpaceHistoryRow, FocusSpaceLibraryRow } from './home/FocusSpaceRows';
import { continueToVisible, discoveredToVisible, libraryToVisible, publishContinueWatching, publishFeedVideos } from '../data/visible-feed';
import type { CardData } from './FeedCard';

const PAGE = 16;

/** FocusSpace's home inside YouTube: pick a space (or, first, an exam), then a streaming-style home. */
export function SpaceHome({ settings, modes, onCreateSpace }: { settings: Settings; modes: LearningMode[]; onCreateSpace: () => void }) {
  const mode = activeModeOf(settings, modes);
  // Shared with YouTube's sidebar, which can open a subject ("NEET → Chemistry") here too.
  const [topicId, setTopicId] = useHomeTopic(mode?.id ?? null);
  const full = useFullScreen();
  // A new Space or topic starts at the top: the bar, the path, then its videos.
  useEffect(() => {
    if (mode) window.scrollTo({ top: 0 });
  }, [mode?.id, topicId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mode || !settings.onboarded) return <FirstRun settings={settings} modes={modes} onCreate={onCreateSpace} />;

  return (
    <div className="fs-home">
      <SpaceBar mode={mode} modes={modes} topicId={topicId} onTopic={setTopicId} onCreate={onCreateSpace} full={full} />
      {!topicId && <FullScreenOffer wide={full.wide} onAccept={full.toggle} />}
      {mode.source ? <InstituteHome mode={mode} topicId={topicId} onTopic={setTopicId} /> : <SpaceFeed key={mode.id} mode={mode} topicId={topicId} onTopic={setTopicId} />}
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
        <h1>What are you preparing for?</h1>
        <p>An exam, your degree, or a course of your own. FocusSpace turns YouTube into a classroom for it: only lessons from your syllabus, your teachers first, nothing else on the page. You can add more Spaces later, like UPSC next to B.Tech.</p>
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

function SpaceBar({
  mode,
  modes,
  topicId,
  onTopic,
  onCreate,
  full,
}: {
  mode: LearningMode;
  modes: LearningMode[];
  topicId: string | null;
  onTopic: (id: string | null) => void;
  onCreate: () => void;
  full: { wide: boolean; toggle: () => void };
}) {
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
            {!isReadOnlySpace(mode) && <button type="button" role="menuitem" className="fs-menu-item" onClick={run(() => void sendMessage('dashboard/open', { route: `/modes/${mode.id}` }))}>
              <Pencil size={18} aria-hidden />
              <span>Edit {mode.name}</span>
            </button>}
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
              {/* A subject opens as a page of its own: all of Chemistry, then Organic inside it. */}
              {t.group && t.group !== mode.topics[i - 1]?.group && (
                <button type="button" role="tab" className="fs-chip-group" aria-selected={topicId === groupId(t.group)} onClick={() => onTopic(topicId === groupId(t.group!) ? null : groupId(t.group!))} title={`All of ${groupTitle(t.group)}`}>
                  {t.group}
                </button>
              )}
              <button type="button" role="tab" className="fs-chip" aria-selected={t.id === topicId} onClick={() => onTopic(t.id === topicId ? null : t.id)} title={t.group ? `${t.group} → ${t.name}` : t.name}>
                {t.name}
              </button>
            </Fragment>
          ))}
        </div>
      )}
      <FullScreenButton wide={full.wide} onToggle={full.toggle} />
    </div>
    </>
  );
}

/**
 * Whether the end of the list is near the screen. A state, not a one-off event: an IntersectionObserver
 * only reports *changes*, so a learner already at the bottom when new videos arrive would never get
 * another "load more" — the feed just stopped (the "20 Botany videos, then nothing" bug).
 */
function useNearEnd() {
  // A callback ref: the home and a topic page each draw their own end-of-list marker, and opening a topic
  // replaces the element. Observing only the first one is why topic pages never loaded past one page.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      setNear(false);
    };
  }, [el]);
  return [setEl, near] as const;
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
  /** The words it matched ("constitution"), for placing it on a topic's path. */
  terms: string[];
}

type PlanPick = PlanVideo & { pick: Pick };

const MIN_ROW = 3;
const MAX_TOPIC_ROWS = 6;

function SpaceFeed({ mode, topicId, onTopic }: { mode: LearningMode; topicId: string | null; onTopic: (id: string | null) => void }) {
  // A subject (NEET → Chemistry) opens as one topic made of its topics; a topic opens as itself.
  const subject = useMemo(() => subjectOf(mode, topicId), [mode, topicId]);
  const topic = useMemo(() => (subject ? subjectAsTopic(subject) : mode.topics.find((t) => t.id === topicId) ?? null), [mode, topicId, subject]);
  // A topic's subtopics (DBMS → normalization, SQL, transactions): a second row of chips that narrows it.
  const subtopics = useMemo(() => (topic && !subject ? subtopicsOf(topic).slice(0, 30) : []), [topic, subject]);
  const [subtopic, setSubtopic] = useState<string | null>(null);
  useEffect(() => setSubtopic(null), [topicId]);
  // A step picked from the topic's path; otherwise the billboard opens on the learner's own step.
  const [stepAt, setStepAt] = useState<number | null>(null);
  useEffect(() => setStepAt(null), [topicId, subtopic]);
  const { view, loading, channelIds } = useFeedView(mode);
  const store = useStorage(['watchHistory', 'sync'] as const);
  const subs = useMemo(() => {
    if (!view) return [];
    let list = view.items;
    if (subject) {
      const ids = scopeIds(mode, subject.id);
      const fit = (v: FeedVideo) => Math.max(...ids.map((id) => v.topicScores[id] ?? 0));
      list = view.items.filter((v) => fit(v) >= 0.5).sort((a, b) => fit(b) - fit(a));
    } else if (topic) list = topicItems(view, topic.id);
    if (!subtopic) return list;
    const want = normalizeText(subtopic);
    return list.filter((v) => normalizeText(v.title).includes(want) || v.matched.some((m) => normalizeText(m) === want));
  }, [view, mode, subject, topic, subtopic]);
  const libraryIds = useMemo(() => (view ? view.items.map((v) => v.id) : []), [view]);
  // Searching YouTube for the subtopic itself, still filed under its topic.
  const searchTopic = useMemo(() => (topic && subtopic ? { ...topic, name: subtopic, keywords: [] } : topic), [topic, subtopic]);
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

  const [sentinel, nearEnd] = useNearEnd();
  // Near the end and more is ready: show the next page. Runs again whenever more arrives.
  useEffect(() => {
    if (nearEnd && entries.length > visible) setVisible((v) => v + PAGE);
  }, [nearEnd, entries.length, visible]);

  // What a card covers; when no subtopic matched, its topic ("Botany") still says more than a match score.
  const covers = (terms: string[], topicId?: string | null) => {
    const found = coveredTerms(mode, terms);
    const topic = topicId ? mode.topics.find((t) => t.id === topicId)?.name : undefined;
    return found.length || !topic ? found : [titleCase(topic)];
  };
  const subCard = (v: FeedVideo): CardData => ({
    covers: covers(v.matched, v.topicId),
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
    about: coversLine(covers(v.matched)),
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
    covers: covers(d.cls.matchedTerms, d.topicId),
    about: aboutLine(d.video.description) || coversLine(covers(d.cls.matchedTerms)),
  });

  // Every video once, best first: the pool the billboard, Top 10 and topic shelves draw from.
  const picks = useMemo(() => {
    const seen = new Set<string>();
    const all: Pick[] = [];
    for (const v of subs) if (!seen.has(v.id) && seen.add(v.id)) all.push({ card: subCard(v), relevance: v.relevance, topicId: v.topicId, terms: v.matched });
    for (const d of discovery.items) if (!seen.has(d.video.id) && seen.add(d.video.id)) all.push({ card: discCard(d), relevance: d.cls.relevance, topicId: d.topicId, terms: d.cls.matchedTerms });
    return all.sort((a, b) => b.relevance - a.relevance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs, discovery.items, progress]);

  const topicName = (id: string | null) => mode.topics.find((t) => t.id === id)?.name ?? null;
  const planVideos = useMemo<PlanPick[]>(() => picks.map((p) => ({ id: p.card.id, title: p.card.title, durationSec: p.card.durationSec, terms: p.terms, relevance: p.relevance, pick: p })), [picks]);
  const slideOf = (p: Pick, eyebrow: string, more?: Featured['more']): Featured => ({
    id: p.card.id,
    title: p.card.title,
    channelTitle: p.card.channelTitle,
    durationSec: p.card.durationSec,
    eyebrow,
    // What is in the video, in its own words; "Covers Botany." only repeats the tags.
    why: p.card.about && !p.card.about.startsWith('Covers ') ? p.card.about : '',
    tierLabel: null,
    covers: p.card.covers?.slice(0, 3),
    progress: p.card.progress,
    topicId: p.topicId,
    topicName: topicName(p.topicId),
    ...(more ? { more } : {}),
  });

  // The Space opens on its first lesson: what the syllabus is and how to begin.
  const intro = useMemo(
    () => ((mode.kind ?? 'learning') === 'learning' && !topic ? buildTopicPlan({ name: mode.name, intro: `The ${mode.name} syllabus and how to start`, introPattern: SPACE_INTRO, parts: [], videos: planVideos }).find((st) => st.kind === 'intro') ?? null : null),
    [mode, planVideos, topic],
  );

  // Where the learner is: the place they went to last, or the topic of the lesson they watched last.
  const at = useMemo(() => {
    const visit = lastPlace(mode.id);
    const watched = (store?.watchHistory ?? []).find((e) => e.modeId === mode.id && e.topicId);
    const seen = watched?.topicId ? { topicId: watched.topicId, at: watched.watchedAt } : null;
    return [visit, seen].filter((x): x is { topicId: string; at: number } => !!x).sort((a, b) => b.at - a.at)[0]?.topicId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.id, store?.watchHistory, topicId]);

  const featured = useMemo<Featured[]>(() => {
    const out: Featured[] = [];
    if (intro) out.push(slideOf(intro.video.pick, `Start here · ${intro.label}`));
    const resume = continuing.find((c) => c.kind === 'resume' && (c.progress ?? 0) > 0.02);
    if (resume)
      out.push({ id: resume.videoId, title: resume.title, channelTitle: resume.channelTitle, durationSec: null, eyebrow: 'Continue learning', why: resume.reason, tierLabel: null, progress: resume.progress, topicId: null, topicName: null });
    picks
      .filter((p) => (p.card.tier === 'excellent' || p.card.tier === 'strong') && !out.some((o) => o.id === p.card.id))
      .slice(0, 5 - out.length)
      .forEach((p, i) =>
        out.push({
          id: p.card.id,
          title: p.card.title,
          channelTitle: p.card.channelTitle,
          durationSec: p.card.durationSec,
          eyebrow: i === 0 ? `Best ${mode.name} video for you` : p.card.source === 'discovery' ? 'Fresh pick for you' : 'From your channels',
          // What is in the video, in its own words, rather than how well it scored.
          // "Covers Botany." only repeats the tags shown above it; a description line says more.
          why: p.card.about && !p.card.about.startsWith('Covers ') ? p.card.about : '',
          tierLabel: null,
          covers: p.card.covers?.slice(0, 3),
          progress: p.card.progress,
          topicId: p.topicId,
          topicName: topicName(p.topicId),
        }),
      );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, continuing, mode, intro]);

  const topicRows = useMemo(() => {
    if (topic) return [];
    return mode.topics
      .map((t) => ({ topic: t, items: picks.filter((p) => p.topicId === t.id).slice(0, 14) }))
      .filter((r) => r.items.length >= MIN_ROW)
      .sort((a, b) => b.items.length - a.items.length)
      .slice(0, MAX_TOPIC_ROWS);
  }, [picks, mode.topics, topic]);

  const learning = (mode.kind ?? 'learning') === 'learning';
  const top10 = picks.slice(0, 10);
  const fromChannels = subs.slice(0, 16).map(subCard);
  const fresh = discovery.items.slice(0, 16).map(discCard);
  const summary = [subs.length ? `${subs.length} from your channels` : '', discovery.items.length ? `${discovery.items.length} fresh picks` : ''].filter(Boolean).join(' · ');
  const noChannels = !!view && view.channelCount === 0;
  const empty = !loading && entries.length === 0 && (discovery.exhausted || !mode.discovery);
  const syncError = store?.sync.lastError;
  const warming = loading || (discovery.loading && picks.length === 0);

  const syncNote = syncError && (
    <div className="fs-note">
      {syncError}
      <button type="button" className="fs-link" onClick={() => void sendMessage('library/sync', { force: true })}>
        <RefreshCw size={14} aria-hidden /> Retry
      </button>
    </div>
  );
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

  const endOfFeed = !!topic && entries.length > 0 && !loading && !discovery.loading && (discovery.exhausted || !mode.discovery) && visible >= entries.length && (
    <EndOfFeed
      name={subtopic ?? topic.name}
      query={`${subtopic ?? topic.name} ${mode.searchHint || mode.name}`}
      next={subject ? subject.topics.map((t) => ({ label: t.name, go: () => onTopic(t.id) })) : subtopics.filter((k) => k !== subtopic).slice(0, 6).map((k) => ({ label: titleCase(k), go: () => setSubtopic(k) }))}
    />
  );

  if (topic) {
    const addSubtopic = async (text: string) => {
      await updateMode(mode.id, { topics: withSubtopic(mode.topics, topic.id, text) });
      setSubtopic(text.trim().toLowerCase());
    };
    const addTopic = async (text: string) => {
      if (!subject) return;
      const next = withTopic(mode.topics, text, subject.name);
      await updateMode(mode.id, { topics: next.topics });
      if (next.id) onTopic(next.id);
    };
    /*
     * The page is a short course, like the Space's home: 1 What is Polity, 2 Understand Polity, then
     * each subtopic (or, for a stage like Mains, each of its topics). The billboard shows the step the
     * learner is on; "Next" and the step list move them along.
     */
    const name = subtopic ? titleCase(subtopic) : topic.name;
    const parts = subtopic ? [] : subject ? subject.topics.map((t) => t.name) : subtopics;
    const plan = buildTopicPlan({ name, parts, videos: planVideos }).map((st) => (st.kind === 'part' ? { ...st, label: titleCase(st.label) } : st));
    const here = currentStep(plan, progress);
    const active = Math.min(stepAt ?? here, Math.max(0, plan.length - 1));
    const openPart = (st: PlanStep<PlanPick>): Featured['more'] => {
      if (!st.subtopic) return undefined;
      if (subject) {
        const t = subject.topics.find((x) => x.name === st.subtopic);
        return t ? { label: `Open ${t.name}`, go: () => onTopic(t.id) } : undefined;
      }
      return { label: `More ${st.label}`, go: () => setSubtopic(st.subtopic!.toLowerCase()) };
    };
    const slides = plan.map((st, i) => slideOf(st.video.pick, `Step ${i + 1} of ${plan.length} · ${st.label}`, openPart(st)));
    const words = [name, ...(subtopic ? [] : subtopicsOf(topic))].map(normalizeText).filter((w) => w.length > 2);
    const topicContinue = continuing.filter((c) => words.some((w) => normalizeText(c.title).includes(w)));
    const pick = (i: number) => {
      setStepAt(i);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    return (
      <>
        <div className="fs-topic-head">
          <Crumbs mode={mode} topic={topic} subject={!!subject} onTopic={onTopic} subtopic={subtopic ? name : null} onLeaveSubtopic={() => setSubtopic(null)} />
          {!subject && !subtopic && <PathPosition mode={mode} topic={topic} onTopic={onTopic} />}
        </div>
        {syncNote}

        {slides.length > 0 ? <Billboard items={slides} onTopic={onTopic} steps index={active} onIndex={setStepAt} /> : warming ? <div className="fs-billboard fs-billboard-skeleton fs-skeleton" aria-hidden /> : null}

        {plan.length > 1 && <TopicSteps name={name} steps={plan} here={here} active={active} progress={progress} onPick={pick} />}

        {subject && <SubjectTopics mode={mode} topics={subject.topics} onTopic={onTopic} onAdd={addTopic} subjectName={subject.title} />}
        {!subject && !subtopic && (
          <div className="fs-subtopics is-row" role="tablist" aria-label={`Subtopics of ${topic.name}`}>
            <span className="fs-subtopics-label">Subtopics of {topic.name}</span>
            {subtopics.map((k) => (
              <button key={k} type="button" role="tab" className="fs-chip" aria-selected={false} onClick={() => setSubtopic(k)}>
                {titleCase(k)}
              </button>
            ))}
            <AddInline label="Add subtopic" placeholder={`A subtopic of ${topic.name}`} onAdd={addSubtopic} />
          </div>
        )}

        {topicContinue.length > 0 && (
          <Row title={`Continue ${name}`} icon={<History size={20} aria-hidden />}>
            {topicContinue.slice(0, 12).map((item) => (
              <PosterCard
                key={item.videoId}
                card={{ id: item.videoId, url: item.url, title: item.title, channelTitle: item.channelTitle, views: null, time: CONTINUE_LABEL[item.kind], durationSec: null, progress: item.progress, tier: 'strong', source: 'subscription', why: item.reason }}
              />
            ))}
          </Row>
        )}

        <section className="fs-section" aria-label={`${name} videos`}>
          <div className="fs-section-head">
            <h2>{subject ? `Everything in ${topic.name}` : `All ${name} videos`}</h2>
            {summary && <span>{summary}</span>}
          </div>
          {grid}
          {emptyState}
          {endOfFeed}
          {discovery.error && entries.length > 0 && <div className="fs-note">{discovery.error}</div>}
        </section>
        {!subject && !subtopic && <TopicPlaylist mode={mode} topic={topic} />}
        <ExploreMore mode={mode} current={topic} onTopic={onTopic} />
      </>
    );
  }

  return (
    <>
      {featured.length > 0 ? <Billboard items={featured} onTopic={onTopic} /> : warming ? <div className="fs-billboard fs-billboard-skeleton fs-skeleton" aria-hidden /> : null}
      {notes}
      <LearningPath mode={mode} onTopic={onTopic} at={at} />

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
      {!learning && fromChannels.length >= MIN_ROW && (
        <Row title="From your channels" subtitle="Teachers you already trust" icon={<Users size={20} aria-hidden />}>
          {fromChannels.map((c) => (
            <PosterCard key={c.id} card={c} />
          ))}
        </Row>
      )}

      {/* Where to go next and a line worth reading, in place of a list of channels; above the endless grid so it is seen. */}
      {learning && <ExploreMore mode={mode} current={null} onTopic={onTopic} />}

      <section className="fs-section fs-browse" aria-label={`Everything for ${mode.name}`}>
        <div className="fs-section-head">
          <h2>Everything for {mode.name}</h2>
          {summary && <span>{summary}</span>}
        </div>
        {grid}
        {emptyState}
        {discovery.error && entries.length > 0 && <div className="fs-note">{discovery.error}</div>}
      </section>

      {!learning && <ChannelsSection mode={mode} view={view} discovered={discovery.items} channelIds={channelIds} />}
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

  const [adding, setAdding] = useState(false);
  const form = (
    <form className="fs-playlist-add" onSubmit={add}>
      <input className="fs-input" autoFocus={adding} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Paste a YouTube link to keep it in ${topic.name}`} aria-label={`Add a video to ${topic.name}`} />
      <Button type="submit" size="sm" icon={<Plus />} loading={busy} disabled={!input.trim()}>
        Add video
      </Button>
    </form>
  );

  // Nothing saved yet: one quiet line, not a whole section, so the end of the feed is not a form.
  if (!saved.length)
    return (
      <div className="fs-playlist-empty">
        <span>
          <b>Your own {topic.name} list.</b> Keep the lessons you want to come back to: tap Save on a video’s page, or{' '}
          <button type="button" className="fs-link" onClick={() => setAdding(true)}>
            paste a link
          </button>
          .
        </span>
        {adding && form}
        {error && <span className="fs-muted-line fs-error">{error}</span>}
      </div>
    );

  return (
    <section className="fs-section fs-playlist" aria-label={`${topic.name} playlist`}>
      <div className="fs-section-head">
        <h2>Your {topic.name} list</h2>
        <span>
          {saved.length} saved {saved.length === 1 ? 'video' : 'videos'}
        </span>
      </div>
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
      {form}
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

/* ─── Topic & subject pages ────────────────────────────────────────────────── */

/** Subtopics as labels: "named reactions" → "Named Reactions", and acronyms stay acronyms ("GOC", "IUPAC"). */
const ACRONYMS = new Set(['goc', 'iupac', 'dsa', 'dbms', 'sql', 'oop', 'oops', 'psm', 'ent', 'gst', 'ncert', 'dns', 'http', 'https', 'api', 'cdn', 'cap', 'lld', 'hld', 'gs', 'csat', 'dilr', 'varc', 'qa', 'ai', 'ml', 'nlp', 'llm', 'llms', 'gi', 'cns', 'shm', 'ac', 'dc', 'emi', 'pyq', 'pyqs', 'ui', 'ux', 'css', 'html', 'php', 'cad', 'cam', 'rcc', 'vlsi', 'dsp', 'uml', 'solid']);
const titleCase = (text: string) => text.replace(/[\p{L}\p{N}]+/gu, (w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));

/**
 * Where you are, and the way back: "← Back · NEET › Chemistry › Organic Chemistry". Back goes up one
 * level (topic → its subject → the Space's home); every crumb is a way straight there.
 */
function Crumbs({ mode, topic, subject, onTopic, subtopic = null, onLeaveSubtopic }: { mode: LearningMode; topic: Topic; subject: boolean; onTopic: (id: string | null) => void; subtopic?: string | null; onLeaveSubtopic?: () => void }) {
  const parent = !subject && topic.group ? groupId(topic.group) : null;
  // In a subtopic (Polity → Constitution), Back goes to the topic; otherwise up one level.
  const back = subtopic ? { label: `Back to ${topic.name}`, go: () => onLeaveSubtopic?.() } : { label: parent ? `Back to ${groupTitle(topic.group!)}` : `Back to ${mode.name} home`, go: () => onTopic(parent) };
  return (
    <nav className="fs-crumbs" aria-label="Where you are">
      <button type="button" className="fs-crumb-back" onClick={back.go}>
        <ArrowLeft size={16} aria-hidden /> {back.label}
      </button>
      <span className="fs-crumb-trail">
        <button type="button" className="fs-link" onClick={() => onTopic(null)}>
          {mode.name}
        </button>
        {parent && (
          <>
            <ChevronRight size={14} aria-hidden />
            <button type="button" className="fs-link" onClick={() => onTopic(parent)}>
              {groupTitle(topic.group!)}
            </button>
          </>
        )}
        <ChevronRight size={14} aria-hidden />
        {subtopic ? (
          <>
            <button type="button" className="fs-link" onClick={() => onLeaveSubtopic?.()}>
              {topic.name}
            </button>
            <ChevronRight size={14} aria-hidden />
            <b aria-current="page">{subtopic}</b>
          </>
        ) : (
          <b aria-current="page">{topic.name}</b>
        )}
      </span>
    </nav>
  );
}

/** The topic's lessons in order, each with its state: watched, where you are, or still ahead. */
function TopicSteps({ name, steps, here, active, progress, onPick }: { name: string; steps: PlanStep<PlanPick>[]; here: number; active: number; progress: Map<string, number>; onPick: (i: number) => void }) {
  return (
    <section className="fs-steps" aria-label={`Your ${name} path`}>
      <header className="fs-steps-head">
        <h2>
          <Route size={20} aria-hidden /> Your {name} path
        </h2>
        <span className="fs-shelf-sub">
          {steps.length} steps · you are on step {here + 1}
        </span>
      </header>
      <ol className="fs-steps-list">
        {steps.map((st, i) => {
          const done = (progress.get(st.video.id) ?? 0) >= 0.8;
          return (
            <li key={st.video.id}>
              <button type="button" className={`fs-step${i === here ? ' is-here' : ''}${done ? ' is-done' : ''}${i === active ? ' is-active' : ''}`} aria-current={i === here ? 'step' : undefined} onClick={() => onPick(i)}>
                <span className="fs-step-art">
                  <img src={thumbnailUrl(st.video.id, 'mq')} alt="" loading="lazy" />
                  <span className="fs-step-num">{done ? <Check size={13} aria-hidden /> : i + 1}</span>
                </span>
                <span className="fs-step-text">
                  <b>{st.label}</b>
                  <small>{i === here ? 'You are here' : done ? 'Watched' : st.video.title}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The end of a learning page: other topics to go to (this stage's first), and one line worth reading.
 * It replaces the list of subscribed channels, which a learner did not come here to manage.
 */
function ExploreMore({ mode, current, onTopic }: { mode: LearningMode; current: Topic | null; onTopic: (id: string) => void }) {
  const quote = quoteOfTheDay();
  const near = current?.group ? mode.topics.filter((t) => t.group === current.group && t.id !== current.id) : [];
  const rest = mode.topics.filter((t) => t.id !== current?.id && !near.includes(t));
  const others = [...near, ...rest].slice(0, 14);
  return (
    <section className="fs-explore" aria-label="Explore more">
      {others.length > 0 && (
        <div className="fs-explore-topics">
          <h2>{current ? 'Explore other topics' : `More of ${mode.name} to explore`}</h2>
          <div className="fs-chips fs-chips-wrap">
            {others.map((t) => (
              <button key={t.id} type="button" className="fs-chip" onClick={() => onTopic(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <figure className="fs-quote">
        <Quote size={22} aria-hidden />
        <blockquote>{quote.text}</blockquote>
        <figcaption>{quote.by}</figcaption>
      </figure>
    </section>
  );
}

/** A subject's topics as tiles (Physical · Organic · Inorganic), each with its progress, plus a way to add one. */
function SubjectTopics({ mode, topics, subjectName, onTopic, onAdd }: { mode: LearningMode; topics: Topic[]; subjectName: string; onTopic: (id: string) => void; onAdd: (name: string) => Promise<void> }) {
  const progress = useTopicProgress(mode.id);
  return (
    <div className="fs-subject-topics">
      {topics.map((t) => {
        const done = progress.get(t.id) ?? 0;
        return (
          <button key={t.id} type="button" className={`fs-subject-tile${done >= COVERED_AFTER ? ' is-covered' : ''}`} onClick={() => onTopic(t.id)}>
            <b>
              {done >= COVERED_AFTER && <Check size={14} aria-hidden />} {t.name}
            </b>
            <small>
              {subtopicsOf(t).length} subtopics{done ? ` · ${done} watched` : ''}
            </small>
            <span className="fs-subject-tile-subs">{subtopicsOf(t).slice(0, 3).map(titleCase).join(' · ')}</span>
          </button>
        );
      })}
      <AddInline label={`Add a topic to ${subjectName}`} placeholder={`A chapter or part of ${subjectName}`} onAdd={onAdd} tile />
    </div>
  );
}

/** "+ Add subtopic": a chip that opens into a small field, so a learner can grow a topic where they are. */
function AddInline({ label, placeholder, onAdd, tile = false }: { label: string; placeholder: string; onAdd: (text: string) => Promise<void>; tile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" className={tile ? 'fs-subject-tile fs-subject-tile-add' : 'fs-chip fs-chip-add'} onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden /> {label}
      </button>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text.trim());
      setText('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={`fs-add-inline${tile ? ' is-tile' : ''}`} onSubmit={submit}>
      <input className="fs-input" autoFocus value={text} maxLength={60} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} placeholder={placeholder} aria-label={label} />
      <Button type="submit" size="sm" loading={busy} disabled={!text.trim()}>
        Add
      </Button>
      <button type="button" className="fs-icon-plain" aria-label="Cancel" onClick={() => setOpen(false)}>
        <X size={14} aria-hidden />
      </button>
    </form>
  );
}

/** The end of what FocusSpace is sure about, said plainly, with where to go next: never a silent stop. */
function EndOfFeed({ name, query, next }: { name: string; query: string; next: { label: string; go: () => void }[] }) {
  return (
    <div className="fs-end-feed">
      <b>That’s every clear {name} video FocusSpace found for now.</b>
      <span>It only shows lessons that match, so the list ends instead of filling up with guesses.</span>
      {next.length > 0 && (
        <div className="fs-chips fs-chips-wrap">
          <span className="fs-subtopics-label">Keep going with</span>
          {next.map((n) => (
            <button key={n.label} type="button" className="fs-chip" onClick={n.go}>
              {n.label}
            </button>
          ))}
        </div>
      )}
      <YtLink href={searchUrl(query)} className="fs-btn fs-btn-secondary">
        <Search size={15} aria-hidden /> Search all of YouTube for “{name}”
      </YtLink>
    </div>
  );
}

/* ─── What a video covers, in words ────────────────────────────────────────── */

/** The subtopics a video was matched on, most specific first: never the Space's own name or search words. */
function coveredTerms(mode: LearningMode, terms: string[]): string[] {
  const own = new Set([mode.name, mode.searchHint, ...mode.keywords].map((k) => normalizeText(k.replace(/^~/, ''))));
  const topicNames = new Set(mode.topics.map((t) => normalizeText(t.name)));
  const kept = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 2 && !own.has(normalizeText(t))))];
  return kept.sort((a, b) => Number(topicNames.has(normalizeText(a))) - Number(topicNames.has(normalizeText(b)))).map(titleCase);
}

const coversLine = (terms: string[]) => (terms.length ? `Covers ${terms.slice(0, 3).join(', ')}.` : '');

/** Promotion lines that open many lesson descriptions ("Join our Telegram", "Use code…"): skipped. */
const PROMO = /telegram|whatsapp|instagram|subscribe|download|app\b|batch|enrol|enroll|coupon|discount|use code|join|link|follow|visit|register|call|contact|price|offer/i;

/** The first sentence of a video's description that says what is in it, short enough to read at a glance. */
function aboutLine(description: string | null | undefined): string {
  if (!description) return '';
  const sentences = description
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((x) => x.replace(/\s+/g, ' ').trim());
  const line = sentences.find((x) => x.length >= 30 && !PROMO.test(x) && /\p{L}{3}/u.test(x));
  if (!line) return '';
  return line.length > 170 ? `${line.slice(0, 167).replace(/\s+\S*$/, '')}…` : line;
}
