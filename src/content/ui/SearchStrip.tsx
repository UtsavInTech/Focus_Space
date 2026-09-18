import { useMemo } from 'react';
import type { LearningMode } from '@/types/domain';
import { searchFeedView } from '@/learning/feed-view';
import { searchQueryWithContext } from '@/learning/library';
import { searchUrl, watchUrl } from '@/integrations/youtube/urls';
import { SpaceIcon } from '@/ui/icons';
import { YtLink } from '@/ui/nav';
import type { MarkStats } from '../youtube/filters/relevance-marker';
import { useFeedView } from '../data/hooks';

/** Search keeps the space: library matches first, unrelated results hidden, one click to add context. */
export function SearchStrip({ mode, query, stats, revealed, onToggleReveal }: { mode: LearningMode; query: string; stats: MarkStats | null; revealed: boolean; onToggleReveal: () => void }) {
  const { view } = useFeedView(mode);
  const hits = useMemo(() => (view && query ? searchFeedView(view, mode, query, 4) : []), [view, mode, query]);
  const contextual = useMemo(() => searchQueryWithContext(mode, query), [mode, query]);

  return (
    <div className="fs-strip">
      <div className="fs-strip-bar">
        <SpaceIcon name={mode.icon} size={16} />
        <b>{mode.name}</b>
        <span className="fs-strip-status">{stats && stats.off > 0 ? `${stats.off} unrelated ${stats.off === 1 ? 'result' : 'results'} ${revealed ? 'shown' : 'hidden'}` : 'Results checked for this space'}</span>
        {stats && stats.off > 0 && (
          <button type="button" className="fs-link" onClick={onToggleReveal}>
            {revealed ? 'Hide them' : 'Show all'}
          </button>
        )}
        {contextual !== query && (
          <YtLink href={searchUrl(contextual)} className="fs-link">
            Search “{contextual}”
          </YtLink>
        )}
      </div>
      {hits.length > 0 && (
        <div className="fs-strip-hits">
          <span className="fs-subhead">In your {mode.name} library</span>
          <div className="fs-strip-grid">
            {hits.map((v) => (
              <YtLink key={v.id} href={watchUrl(v.id)} className="fs-strip-item">
                <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
                <span>
                  <b>{v.title}</b>
                  <small>{v.channelTitle}</small>
                </span>
              </YtLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
