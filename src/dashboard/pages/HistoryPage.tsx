import { useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import type { WatchEntry } from '@/types/domain';
import type { DashboardData } from '../DashboardApp';
import { openYouTube } from '../DashboardApp';
import { findMode } from '@/modes/service';
import { updateItem } from '@/storage/storage';
import { thumbnailUrl, watchUrl } from '@/integrations/youtube/urls';
import { useStorage } from '@/ui/hooks';
import { Button, EmptyState } from '@/ui/components/primitives';
import { Modal } from '@/ui/components/Modal';
import { latestPerVideo } from './HomePage';

/** What the learner watched with Focus Mode on, newest first, by day — each video once, where they left it. */
export function HistoryPage({ data }: { data: DashboardData }) {
  const store = useStorage(['watchHistory'] as const);
  const [clearing, setClearing] = useState(false);
  const entries = latestPerVideo(store?.watchHistory ?? []);

  return (
    <>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">History</h1>
          <p>Videos you watched with Focus Mode on, and how far you got. Kept only in this browser.</p>
        </div>
        {entries.length > 0 && (
          <Button variant="ghost" icon={<Trash2 />} onClick={() => setClearing(true)}>
            Clear history
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={<History />} title="Nothing watched yet" actions={<Button onClick={() => openYouTube()}>Open YouTube</Button>}>
          Videos you watch with Focus Mode on appear here, with where you stopped.
        </EmptyState>
      ) : (
        byDay(entries).map(([day, list]) => (
          <section key={day} className="fs-home-section">
            <header>
              <h2>{day}</h2>
            </header>
            <div className="fs-card fs-list">
              {list.map((e) => (
                <button key={e.videoId} type="button" className="fs-list-item fs-lib-row" onClick={() => openYouTube(watchUrl(e.videoId))}>
                  <span className="fs-list-thumb">
                    <img src={thumbnailUrl(e.videoId)} alt="" loading="lazy" />
                  </span>
                  <span className="fs-grow fs-lib-text">
                    <span className="fs-lib-title">{e.title}</span>
                    <span className="fs-caption">{[e.channelTitle, findMode(data.modes, e.modeId)?.name].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="fs-history-progress" title={`${Math.round(e.progress * 100)}% watched`}>
                    <span className="fs-mini-bar">
                      <span style={{ width: `${Math.round(e.progress * 100)}%` }} />
                    </span>
                    <span className="fs-caption">{e.progress >= 0.9 ? 'Finished' : `${Math.round(e.progress * 100)}%`}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      <Modal
        open={clearing}
        onClose={() => setClearing(false)}
        title="Clear your watch history?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setClearing(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await updateItem('watchHistory', () => []);
                setClearing(false);
              }}
            >
              Clear history
            </Button>
          </>
        }
      >
        <p>Continue watching and course progress start again from nothing. Notes and mind maps are kept.</p>
      </Modal>
    </>
  );
}

/** "Today", "Yesterday", then dates — the way people remember when they watched something. */
export function byDay(entries: WatchEntry[], now = Date.now()): [string, WatchEntry[]][] {
  const startOf = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const today = startOf(now);
  const groups = new Map<string, WatchEntry[]>();
  for (const e of entries) {
    const day = startOf(e.watchedAt);
    const label = day === today ? 'Today' : day === today - 86_400_000 ? 'Yesterday' : new Date(day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    groups.set(label, [...(groups.get(label) ?? []), e]);
  }
  return [...groups.entries()];
}
