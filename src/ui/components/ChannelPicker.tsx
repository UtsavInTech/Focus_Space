import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import type { YtChannel } from '@/integrations/youtube/innertube-parse';
import { rankChannels, type RankedChannel } from '@/learning/relevance/channel-ranking';
import { useYouTubeData } from '../data';
import { Spinner } from './primitives';

export interface PickedChannel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
}

const toPicked = (c: YtChannel): PickedChannel => ({ id: c.id, title: c.title, handle: c.handle, thumbnail: c.thumbnail });

const RESULT_LIMIT = 8;
const SUGGESTION_LIMIT = 6;

/**
 * Search YouTube channels and add them to a space — no subscription needed.
 *
 * The results are real YouTube channel search results; nothing is invented. What FocusSpace adds is the
 * ordering: YouTube's channel filter ranks largely by name, which buries genuine educators under
 * channels that merely *called* themselves after the subject (see learning/relevance/channel-ranking.ts).
 * Every row says why it is being suggested, so the ranking is something the learner can judge rather
 * than something they have to trust.
 */
export function ChannelPicker({
  selected,
  onChange,
  suggestQuery,
  mode,
  knownIds,
}: {
  selected: PickedChannel[];
  onChange: (next: PickedChannel[]) => void;
  suggestQuery?: string;
  /** The Space being built, when there is one — its keywords rank results far better than the query alone. */
  mode?: Pick<LearningMode, 'name' | 'keywords' | 'topics' | 'searchHint'> | null;
  knownIds?: ReadonlySet<string>;
}) {
  const data = useYouTubeData();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YtChannel[]>([]);
  const [suggested, setSuggested] = useState<YtChannel[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    abort.current?.abort();
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setStatus('loading');
    const timer = window.setTimeout(() => {
      data
        .searchChannels(q, controller.signal)
        .then((channels) => {
          if (controller.signal.aborted) return;
          setResults(channels);
          setStatus('idle');
        })
        .catch(() => !controller.signal.aborted && setStatus('error'));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, data]);

  useEffect(() => {
    if (!suggestQuery) return;
    let alive = true;
    data
      .searchChannels(suggestQuery)
      .then((channels) => alive && setSuggested(channels))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [suggestQuery, data]);

  const searching = query.trim().length >= 2;
  const list = useMemo(() => {
    const source = searching ? results : suggested;
    if (!source.length) return [];
    const ranked = rankChannels(source, { query: searching ? query.trim() : suggestQuery ?? '', mode, knownIds });
    // Suggestions are FocusSpace speaking unprompted, so they only ever include channels it can stand
    // behind. An explicit search is the learner asking for something specific — everything is shown.
    return searching ? ranked.slice(0, RESULT_LIMIT) : ranked.filter((r) => !r.lowSignal).slice(0, SUGGESTION_LIMIT);
  }, [searching, results, suggested, query, suggestQuery, mode, knownIds]);

  const isSelected = (id: string) => selected.some((c) => c.id === id);
  const toggle = (c: YtChannel) => onChange(isSelected(c.id) ? selected.filter((s) => s.id !== c.id) : [...selected, toPicked(c)]);

  return (
    <div className="fs-channel-picker">
      {selected.length > 0 && (
        <div className="fs-picked-row" aria-label="Chosen creators">
          {selected.map((c) => (
            <button key={c.id} type="button" className="fs-picked" onClick={() => onChange(selected.filter((s) => s.id !== c.id))} aria-label={`Remove ${c.title}`}>
              {c.thumbnail ? <img src={c.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="fs-picked-initial">{c.title.slice(0, 1)}</span>}
              <span className="fs-truncate">{c.title}</span>
              <Check size={13} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <div className="fs-search">
        <Search aria-hidden />
        <input className="fs-input" style={{ height: 40, fontSize: 14 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a creator by name…" aria-label="Search YouTube channels" />
        {status === 'loading' && (
          <span className="fs-search-hint">
            <Spinner label="Searching" />
          </span>
        )}
      </div>
      {status === 'error' && <span className="fs-caption">Channel search is unavailable right now — you can skip this and add creators later.</span>}
      {searching && status === 'idle' && list.length === 0 && <span className="fs-caption">No channels found for “{query.trim()}”.</span>}
      {list.length > 0 && (
        <div className="fs-channel-results" role="listbox" aria-label="Channels">
          {!searching && <span className="fs-eyebrow">Suggested for this space</span>}
          {list.map((entry) => (
            <ChannelRow key={entry.channel.id} entry={entry} picked={isSelected(entry.channel.id)} onToggle={() => toggle(entry.channel)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelRow({ entry, picked, onToggle }: { entry: RankedChannel; picked: boolean; onToggle: () => void }) {
  const { channel, reasons, lowSignal } = entry;
  return (
    <button type="button" role="option" aria-selected={picked} className="fs-channel-result" data-weak={lowSignal || undefined} onClick={onToggle}>
      {channel.thumbnail ? <img className="fs-avatar" src={channel.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="fs-avatar">{channel.title.slice(0, 1)}</span>}
      <span className="fs-grow">
        <span className="fs-truncate fs-channel-name">{channel.title}</span>
        {/* Why this creator, in the same words for every row: what matched, how big, whether it is already yours. */}
        <span className="fs-caption fs-truncate fs-channel-why">{reasons.join(' · ')}</span>
      </span>
      <span className={`fs-pick${picked ? ' fs-pick-on' : ''}`} aria-hidden>
        {picked ? <Check size={15} /> : <Plus size={15} />}
      </span>
    </button>
  );
}
