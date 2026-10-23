import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Play, Sparkles } from 'lucide-react';
import { TIER_LABEL } from '@/learning/classifier';
import { compactNumber } from '@/learning/library';
import { watchUrl } from '@/integrations/youtube/urls';
import { YtLink } from '@/ui/nav';
import { formatDuration, type CardData } from '../FeedCard';

/**
 * The home page's card: a cinema poster rather than a list row. The thumbnail carries it; hovering lifts
 * the card, darkens the art and brings up a play button, the way a streaming shelf does. Everything a
 * learner needs to choose — title, teacher, how well it fits — stays readable without hovering.
 */

export const SOURCE_LABEL: Record<CardData['source'], string> = { subscription: 'Your channel', added: 'Your channel', discovery: 'Fresh pick' };

const SPRING = { type: 'spring', stiffness: 360, damping: 28, mass: 0.6 } as const;

export function thumbnailUrl(id: string, size: 'maxres' | 'sd' | 'hq' | 'mq' = 'hq') {
  return `https://i.ytimg.com/vi/${id}/${size}default.jpg`;
}

export function PosterCard({ card, rank }: { card: CardData; rank?: number }) {
  const reduce = useReducedMotion();
  const url = card.url ?? watchUrl(card.id);
  const duration = formatDuration(card.durationSec);
  const meta = [card.channelTitle, card.views !== null ? `${compactNumber(card.views)} views` : '', card.time].filter(Boolean).join(' · ');
  const strong = card.tier === 'excellent' || card.tier === 'strong';

  return (
    <motion.article
      className={`fs-poster${rank ? ' fs-poster-ranked' : ''}`}
      title={card.why}
      whileHover={reduce ? undefined : { y: -6, scale: 1.045 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={SPRING}
    >
      {rank !== undefined && (
        <span className="fs-poster-rank" aria-hidden>
          {rank}
        </span>
      )}
      <YtLink href={url} className="fs-poster-link">
        <span className="fs-poster-art">
          <img src={thumbnailUrl(card.id)} alt="" loading="lazy" decoding="async" />
          <span className="fs-poster-shade" aria-hidden />
          <span className="fs-poster-play" aria-hidden>
            <Play size={18} fill="currentColor" />
          </span>
          {card.source === 'discovery' && (
            <span className="fs-poster-flag">
              <Sparkles size={11} aria-hidden /> {SOURCE_LABEL.discovery}
            </span>
          )}
          {duration && <span className="fs-poster-duration">{duration}</span>}
          {card.progress !== null && card.progress > 0.02 && (
            <span className="fs-poster-progress" aria-label={`${Math.round(card.progress * 100)}% watched`}>
              <span style={{ width: `${Math.min(100, card.progress * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="fs-poster-info">
          <span className="fs-poster-title">{card.title}</span>
          <span className="fs-poster-meta">{meta}</span>
          <span className="fs-poster-tags">
            <span className={`fs-match${strong ? ' is-strong' : ''}${card.tier === 'excellent' ? ' is-best' : ''}`}>{TIER_LABEL[card.tier]}</span>
            {card.source !== 'discovery' && <span className="fs-poster-src">{SOURCE_LABEL[card.source]}</span>}
          </span>
        </span>
      </YtLink>
    </motion.article>
  );
}

/** A shimmer in the shape of a poster, for rows still loading. */
export function PosterSkeletons({ count = 5 }: { count?: number }) {
  const [items] = useState(() => Array.from({ length: count }, (_, i) => i));
  return (
    <>
      {items.map((i) => (
        <div key={i} className="fs-poster fs-poster-skeleton" aria-hidden>
          <span className="fs-poster-art fs-skeleton" />
          <span className="fs-skeleton" style={{ height: 14, width: '86%', marginTop: 10, borderRadius: 6 }} />
          <span className="fs-skeleton" style={{ height: 12, width: '52%', marginTop: 8, borderRadius: 6 }} />
        </div>
      ))}
    </>
  );
}
