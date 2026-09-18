import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Pencil, Plus, Power, RefreshCw, X } from 'lucide-react';
import type { LearningMode, Settings, Topic } from '@/types/domain';
import { activeModeOf, selectMode, setChannelRule, setFocusEnabled } from '@/modes/service';
import { parseVideoInput, removeFromTopic, saveToTopic } from '@/modes/playlists';
import { updateItem } from '@/storage/storage';
import { sendMessage } from '@/messaging/runtime';
import { composeFeed } from '@/learning/feed';
import { topicItems, type FeedVideo, type FeedView } from '@/learning/feed-view';
import type { DiscoveredVideo } from '@/learning/discovery';
import { relativeTime } from '@/learning/library';
import { channelUrl, searchUrl, watchUrl } from '@/integrations/youtube/urls';
import { useStorage } from '@/ui/hooks';
import { SpaceIcon } from '@/ui/icons';
import { YtLink } from '@/ui/nav';
import { Button } from '@/ui/components/primitives';
import { useContinueWatching, useDiscovery, useFeedView } from '../data/hooks';
import { continueToVisible, discoveredToVisible, libraryToVisible, publishContinueWatching, publishFeedVideos } from '../data/visible-feed';
import { CardSkeletons, ContinueCard, FeedCard, SpotlightCard, type CardData } from './FeedCard';

const PAGE = 16;

/** FocusSpace's home inside YouTube: pick a space, then videos. */
export function SpaceHome({ settings, modes, onCreateSpace }: { settings: Settings; modes: LearningMode[]; onCreateSpace: () => void }) {
  const mode = activeModeOf(settings, modes);
  const [topicId, setTopicId] = useState<string | null>(null);

  useEffect(() => setTopicId(null), [mode?.id]);

  if (!mode || !settings.onboarded) return <FirstRun modes={modes} onCreate={onCreateSpace} />;

  return (
    <div className="fs-home">
      <SpaceBar mode={mode} modes={modes} topicId={topicId} onTopic={setTopicId} onCreate={onCreateSpace} />
      <SpaceFeed key={mode.id} mode={mode} topicId={topicId} />
    </div>
  );
}

function FirstRun({ modes, onCreate }: { modes: LearningMode[]; onCreate: () => void }) {
  const choose = async (mode: LearningMode) => {
    await selectMode(mode.id);
    await updateItem('settings', (s) => ({ ...s, onboarded: true }));
  };
  return (
    <div className="fs-first-run fs-animate-in">
      <h1>What do you want to focus on?</h1>
      <p>FocusSpace organises YouTube around it — your subscriptions first, then the best matches from the rest of YouTube. You can switch anytime.</p>
      <div className="fs-chips fs-chips-wrap">
        {modes.map((m) => (
          <button key={m.id} type="button" className="fs-chip fs-chip-lg" onClick={() => choose(m)}>
            <SpaceIcon name={m.icon} size={18} />
            {m.name}
          </button>
        ))}
        <button type="button" className="fs-chip fs-chip-lg fs-chip-outline" onClick={onCreate}>
          <Plus size={18} aria-hidden />
          Something else
        </button>
      </div>

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
        <span className="fs-caption">FocusSpace turns off. Nothing is hidden, nothing is reordered — turn it back on whenever you want.</span>
      </div>
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

  return (
    <div className="fs-bar">
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
          {mode.topics.map((t) => (
            <button key={t.id} type="button" role="tab" className="fs-chip" aria-selected={t.id === topicId} onClick={() => onTopic(t.id === topicId ? null : t.id)}>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
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

function SpaceFeed({ mode, topicId }: { mode: LearningMode; topicId: string | null }) {
  const topic = mode.topics.find((t) => t.id === topicId) ?? null;
  const { view, loading, channelIds } = useFeedView(mode);
  const store = useStorage(['watchHistory', 'sync'] as const);
  const subs = useMemo(() => (!view ? [] : topic ? topicItems(view, topic.id) : view.items), [view, topic]);
  const libraryIds = useMemo(() => (view ? view.items.map((v) => v.id) : []), [view]);
  const discovery = useDiscovery(mode, topic, libraryIds, channelIds);
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

  const heading = topic ? `${topic.name}` : subs.length ? 'From your subscriptions' : 'Best matches from YouTube';
  const summary = [subs.length ? `${subs.length} relevant from your channels` : '', discovery.items.length ? `${discovery.items.length} discovered` : ''].filter(Boolean).join(' · ');
  const noChannels = !!view && view.channelCount === 0;
  const empty = !loading && entries.length === 0 && (discovery.exhausted || !mode.discovery);
  const syncError = store?.sync.lastError;

  return (
    <>
      {!topic && <ContinueRow mode={mode} view={view} />}
      {topic && <TopicPlaylist mode={mode} topic={topic} />}

      <section className="fs-section" aria-label={heading}>
        <div className="fs-section-head">
          <h2>{topic ? `${topic.name} videos` : heading}</h2>
          {summary && <span>{summary}</span>}
        </div>

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
            No subscriptions in FocusSpace yet — {mode.discovery ? "we're showing great matches from across YouTube." : 'turn on discovery or import them.'}
            <button type="button" className="fs-link" onClick={() => void sendMessage('subscriptions/import', {})}>
              Import my subscriptions
            </button>
          </div>
        )}

        <div className="fs-grid">
          {entries.slice(0, visible).map((entry) => {
            if (entry.type === 'divider')
              return (
                <div key={entry.key} className="fs-divider-row">
                  <span>{entry.label}</span>
                </div>
              );
            if (entry.type === 'primary') return <FeedCard key={entry.key} card={subCard(entry.item)} />;
            return entry.spotlight ? <SpotlightCard key={entry.key} card={discCard(entry.item)} reasons={entry.item.reasons} /> : <FeedCard key={entry.key} card={discCard(entry.item)} />;
          })}
          {(loading || (discovery.loading && entries.length < visible)) && <CardSkeletons count={entries.length ? 4 : 8} />}
        </div>
        <div ref={sentinel} className="fs-sentinel" aria-hidden />

        {empty && (
          <div className="fs-empty-yt">
            <h3>{topic ? `No clear ${topic.name} videos yet` : `No clear ${mode.name} videos yet`}</h3>
            <p>FocusSpace only shows videos that clearly match — it never fills the page with guesses.</p>
            <YtLink href={searchUrl(topic ? `${topic.name} ${mode.searchHint || mode.name}` : mode.searchHint || mode.name)} className="fs-btn fs-btn-secondary">
              Search YouTube for “{topic ? topic.name : mode.name}”
            </YtLink>
          </div>
        )}
        {discovery.error && entries.length > 0 && <div className="fs-note">{discovery.error}</div>}
      </section>

      {!topic && <ChannelsSection mode={mode} view={view} discovered={discovery.items} channelIds={channelIds} />}
    </>
  );
}

function ContinueRow({ mode, view }: { mode: LearningMode; view: FeedView | null }) {
  const items = useContinueWatching(mode, view);
  const shown = useMemo(() => items.slice(0, 4).map(continueToVisible), [items]);
  useEffect(() => publishContinueWatching(shown), [shown]);
  if (!items.length) return null;
  return (
    <section className="fs-section" aria-label="Continue watching">
      <div className="fs-section-head">
        <h2>Continue watching</h2>
      </div>
      <div className="fs-grid fs-grid-row">
        {items.slice(0, 4).map((item) => (
          <ContinueCard key={item.videoId} item={item} />
        ))}
      </div>
    </section>
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
