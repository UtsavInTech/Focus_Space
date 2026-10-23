import { useMemo } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { ArrowUpRight, History, Library, Network, NotebookPen } from 'lucide-react';
import type { WatchEntry } from '@/types/domain';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { PosterCard, thumbnailUrl } from './PosterCard';
import { Row } from './Row';

/**
 * FocusSpace's own History and Library, on YouTube's home: what you watched *with FocusSpace* (not
 * YouTube's history) and the notes and mind maps you kept. A video plays where it is; the heading, the
 * last tile and every note open FocusSpace's own page for the full list.
 */

const open = (route: string) => void sendMessage('dashboard/open', { route }).catch(() => undefined);

const SPRING = { type: 'spring', stiffness: 360, damping: 28, mass: 0.6 } as const;

/** Each video once, at its latest progress, newest first. */
function latest(history: readonly WatchEntry[]): WatchEntry[] {
  const byVideo = new Map<string, WatchEntry>();
  for (const e of history) {
    const seen = byVideo.get(e.videoId);
    if (!seen || e.watchedAt > seen.watchedAt) byVideo.set(e.videoId, e);
  }
  return [...byVideo.values()].sort((a, b) => b.watchedAt - a.watchedAt);
}

function OpenTile({ label, icon, route }: { label: string; icon: JSX.Element; route: string }) {
  const reduce = useReducedMotion();
  return (
    <m.button type="button" className="fs-open-tile" onClick={() => open(route)} whileHover={reduce ? undefined : { y: -6, scale: 1.03 }} transition={SPRING}>
      <span className="fs-open-tile-icon">{icon}</span>
      <b>{label}</b>
      <small>
        Open in FocusSpace <ArrowUpRight size={13} aria-hidden />
      </small>
    </m.button>
  );
}

export function FocusSpaceHistoryRow() {
  const store = useStorage(['watchHistory', 'modes'] as const);
  const entries = useMemo(() => latest(store?.watchHistory ?? []).slice(0, 12), [store?.watchHistory]);
  if (!store || entries.length === 0) return null;
  const spaceName = (id: string) => store.modes.find((m) => m.id === id)?.name;
  return (
    <Row
      title="Your FocusSpace history"
      subtitle="What you watched with FocusSpace on"
      icon={<History size={20} aria-hidden />}
      action={
        <button type="button" className="fs-shelf-more" onClick={() => open('/history')}>
          See all <ArrowUpRight size={14} aria-hidden />
        </button>
      }
    >
      {entries.map((e) => (
        <PosterCard
          key={e.videoId}
          card={{
            id: e.videoId,
            title: e.title,
            channelTitle: e.channelTitle,
            views: null,
            time: [spaceName(e.modeId), e.progress >= 0.9 ? 'Finished' : `${Math.round(e.progress * 100)}% watched`].filter(Boolean).join(' · '),
            durationSec: e.durationSec,
            progress: e.progress,
            tier: 'none',
            source: 'subscription',
            why: 'From your FocusSpace history',
          }}
          plain
        />
      ))}
      <OpenTile label="All your history" icon={<History size={26} aria-hidden />} route="/history" />
    </Row>
  );
}

export function FocusSpaceLibraryRow() {
  const reduce = useReducedMotion();
  const store = useStorage(['notes'] as const);
  const notes = useMemo(
    () =>
      Object.values(store?.notes.byVideo ?? {})
        .flat()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12),
    [store?.notes],
  );
  if (!store || notes.length === 0) return null;
  return (
    <Row
      title="Your FocusSpace library"
      subtitle="Notes and mind maps you saved"
      icon={<Library size={20} aria-hidden />}
      action={
        <button type="button" className="fs-shelf-more" onClick={() => open('/library')}>
          See all <ArrowUpRight size={14} aria-hidden />
        </button>
      }
    >
      {notes.map((n) => (
        <m.button key={n.id} type="button" className="fs-poster fs-note-card" onClick={() => open(`/library/note/${encodeURIComponent(n.id)}`)} whileHover={reduce ? undefined : { y: -6, scale: 1.045 }} transition={SPRING}>
          <span className="fs-poster-art">
            <img src={thumbnailUrl(n.videoId)} alt="" loading="lazy" decoding="async" />
            <span className="fs-poster-shade" aria-hidden />
            <span className="fs-note-kind">
              {n.format === 'mindmap' ? <Network size={12} aria-hidden /> : <NotebookPen size={12} aria-hidden />}
              {n.format === 'mindmap' ? 'Mind map' : 'Notes'}
            </span>
          </span>
          <span className="fs-poster-info">
            <span className="fs-poster-title">{n.provenance.videoTitle}</span>
            <span className="fs-poster-meta">{[n.provenance.space?.name, n.provenance.topic].filter(Boolean).join(' · ') || n.provenance.channel}</span>
          </span>
        </m.button>
      ))}
      <OpenTile label="Your whole library" icon={<Library size={26} aria-hidden />} route="/library" />
    </Row>
  );
}
