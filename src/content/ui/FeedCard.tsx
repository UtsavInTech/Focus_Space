import { CheckCircle2 } from 'lucide-react';
import { TIER_LABEL, type Tier } from '@/learning/classifier';
import { compactNumber } from '@/learning/library';
import type { NextLearningItem } from '@/learning/next';
import { watchUrl } from '@/integrations/youtube/urls';
import { YtLink } from '@/ui/nav';

/** YouTube-style video cards: familiar layout, one quiet line explaining why FocusSpace shows it. */

export type CardSource = 'subscription' | 'added' | 'discovery';

export interface CardData {
  id: string;
  title: string;
  channelTitle: string;
  views: number | null;
  time: string;
  durationSec: number | null;
  progress: number | null;
  tier: Tier;
  source: CardSource;
  why: string;
  url?: string;
}

const SOURCE_LABEL: Record<CardSource, string> = { subscription: 'Subscribed', added: 'Your channel', discovery: 'Discovery' };

export function formatDuration(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const thumb = (id: string, size: 'hq' | 'mq' = 'hq') => `https://i.ytimg.com/vi/${id}/${size}default.jpg`;

function Thumb({ id, url, durationSec, progress, size = 'hq' }: { id: string; url: string; durationSec: number | null; progress: number | null; size?: 'hq' | 'mq' }) {
  const duration = formatDuration(durationSec);
  return (
    <YtLink href={url} className="fs-thumb" tabIndex={-1} aria-hidden="true">
      <img src={thumb(id, size)} alt="" loading="lazy" decoding="async" />
      {duration && <span className="fs-duration">{duration}</span>}
      {progress !== null && progress > 0.02 && (
        <span className="fs-watched">
          <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </span>
      )}
    </YtLink>
  );
}

export function FeedCard({ card }: { card: CardData }) {
  const url = card.url ?? watchUrl(card.id);
  const meta = [card.views !== null ? `${compactNumber(card.views)} views` : '', card.time].filter(Boolean).join(' • ');
  return (
    <article className="fs-vcard" title={card.why}>
      <Thumb id={card.id} url={url} durationSec={card.durationSec} progress={card.progress} />
      <div className="fs-vcard-meta">
        <YtLink href={url} className="fs-vcard-title">
          {card.title}
        </YtLink>
        <div className="fs-vcard-sub">{card.channelTitle}</div>
        {meta && <div className="fs-vcard-sub">{meta}</div>}
        <div className="fs-vcard-tags">
          <span className={`fs-tier fs-tier-${card.tier}`}>{TIER_LABEL[card.tier]}</span>
          <span className={`fs-source fs-source-${card.source}`}>{SOURCE_LABEL[card.source]}</span>
        </div>
      </div>
    </article>
  );
}

/** "Best match we found" — an exceptionally relevant video from outside the user's channels. */
export function SpotlightCard({ card, reasons }: { card: CardData; reasons: string[] }) {
  const url = card.url ?? watchUrl(card.id);
  const meta = [card.channelTitle, card.views !== null ? `${compactNumber(card.views)} views` : '', card.time].filter(Boolean).join(' • ');
  return (
    <article className="fs-spotlight">
      <Thumb id={card.id} url={url} durationSec={card.durationSec} progress={card.progress} />
      <div className="fs-spotlight-body">
        <span className="fs-spotlight-eyebrow">Best match we found</span>
        <YtLink href={url} className="fs-vcard-title fs-spotlight-title">
          {card.title}
        </YtLink>
        <div className="fs-vcard-sub">{meta}</div>
        <ul className="fs-reasons" aria-label="Why we're showing this">
          {reasons.map((r) => (
            <li key={r}>
              <CheckCircle2 size={15} aria-hidden /> {r}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

const KIND_LABEL: Record<NextLearningItem['kind'], string> = { missed: 'Missed', resume: 'Resume', next: 'Up next' };

export function ContinueCard({ item }: { item: NextLearningItem }) {
  return (
    <article className="fs-vcard fs-continue" title={item.reason}>
      <Thumb id={item.videoId} url={item.url} durationSec={null} progress={item.progress} />
      <div className="fs-vcard-meta">
        <YtLink href={item.url} className="fs-vcard-title">
          {item.title}
        </YtLink>
        <div className="fs-vcard-sub">{item.channelTitle}</div>
        <div className="fs-vcard-tags">
          <span className={`fs-next fs-next-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
          <span className="fs-vcard-sub fs-truncate">{item.reason}</span>
        </div>
      </div>
    </article>
  );
}

export function CardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="fs-vcard" aria-hidden>
          <div className="fs-skeleton fs-thumb-skeleton" />
          <div className="fs-vcard-meta">
            <div className="fs-skeleton" style={{ height: 16, width: '92%' }} />
            <div className="fs-skeleton" style={{ height: 13, width: '55%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </>
  );
}
