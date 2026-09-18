import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import type { YtChannel } from '@/integrations/youtube/innertube-parse';
import { useYouTubeData } from '../data';
import { Spinner } from './primitives';

export interface PickedChannel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
}

const toPicked = (c: YtChannel): PickedChannel => ({ id: c.id, title: c.title, handle: c.handle, thumbnail: c.thumbnail });

/**
 * Search YouTube channels and add them to a space — no subscription needed.
 * Results are real YouTube channel search results; nothing is suggested
 * that YouTube didn't return.
 */
export function ChannelPicker({ selected, onChange, suggestQuery, knownIds }: { selected: PickedChannel[]; onChange: (next: PickedChannel[]) => void; suggestQuery?: string; knownIds?: ReadonlySet<string> }) {
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
          setResults(channels.slice(0, 8));
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
      .then((channels) => alive && setSuggested(channels.slice(0, 5)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [suggestQuery, data]);

  const isSelected = (id: string) => selected.some((c) => c.id === id);
  const toggle = (c: YtChannel) => onChange(isSelected(c.id) ? selected.filter((s) => s.id !== c.id) : [...selected, toPicked(c)]);
  const list = query.trim().length >= 2 ? results : suggested;

  return (
    <div className="fs-channel-picker">
      {selected.length > 0 && (
        <div className="fs-row-wrap" style={{ gap: 6 }}>
          {selected.map((c) => (
            <span className="fs-tag" key={c.id}>
              {c.title}
              <button type="button" aria-label={`Remove ${c.title}`} onClick={() => onChange(selected.filter((s) => s.id !== c.id))}>
                <X />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="fs-search">
        <Search aria-hidden />
        <input className="fs-input" style={{ height: 40, fontSize: 14 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search YouTube channels…" aria-label="Search YouTube channels" />
        {status === 'loading' && (
          <span className="fs-search-hint">
            <Spinner label="Searching" />
          </span>
        )}
      </div>
      {status === 'error' && <span className="fs-caption">Channel search is unavailable right now.</span>}
      {list.length > 0 && (
        <div className="fs-channel-results" role="listbox" aria-label="Channels">
          {query.trim().length < 2 && <span className="fs-eyebrow">Suggested from YouTube</span>}
          {list.map((c) => {
            const picked = isSelected(c.id);
            return (
              <button key={c.id} type="button" role="option" aria-selected={picked} className="fs-channel-result" onClick={() => toggle(c)}>
                {c.thumbnail ? <img className="fs-avatar" src={c.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="fs-avatar">{c.title.slice(0, 1)}</span>}
                <span className="fs-grow">
                  <span className="fs-truncate" style={{ display: 'block', fontWeight: 560 }}>
                    {c.title}
                  </span>
                  <span className="fs-caption fs-truncate" style={{ display: 'block' }}>
                    {[c.handle, c.subscribersText].filter(Boolean).join(' · ')}
                    {(c.subscribed || knownIds?.has(c.id)) && ' · Subscribed'}
                  </span>
                </span>
                <span className={`fs-pick${picked ? ' fs-pick-on' : ''}`}>{picked ? <Check size={15} /> : <Plus size={15} />}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
