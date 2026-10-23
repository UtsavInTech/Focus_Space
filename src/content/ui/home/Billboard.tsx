import { useEffect, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Info, Play } from 'lucide-react';
import { watchUrl } from '@/integrations/youtube/urls';
import { YtLink } from '@/ui/nav';
import { formatDuration } from '../FeedCard';
import { thumbnailUrl } from './PosterCard';

/**
 * The billboard: the one video FocusSpace is most sure about, full width, the way a streaming service
 * opens. It cycles through a few top picks on its own (never with reduced motion, never while the
 * pointer rests on it), and the dots pick one directly.
 */

export interface Featured {
  id: string;
  title: string;
  channelTitle: string;
  durationSec: number | null;
  /** "#1 in UPSC today", "Continue · 40% watched". */
  eyebrow: string;
  /** Why it is here, in a sentence. */
  why: string;
  tierLabel: string | null;
  progress: number | null;
  topicId: string | null;
  topicName: string | null;
}

const ROTATE_MS = 9000;
const EASE = [0.2, 0, 0, 1] as const;

export function Billboard({ items, onTopic }: { items: Featured[]; onTopic: (topicId: string) => void }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;
  const item = items[Math.min(index, count - 1)];

  useEffect(() => {
    if (reduce || paused || count < 2) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, reduce, count]);

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (!item) return null;
  const duration = formatDuration(item.durationSec);
  const url = watchUrl(item.id);

  return (
    <section className="fs-billboard" aria-label="Featured" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <AnimatePresence initial={false}>
        <m.div
          key={item.id}
          className="fs-billboard-art"
          initial={reduce ? false : { opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          <BillboardImage id={item.id} />
        </m.div>
      </AnimatePresence>
      <div className="fs-billboard-shade" aria-hidden />

      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={item.id}
          className="fs-billboard-body"
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -10 }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          <span className="fs-billboard-eyebrow">{item.eyebrow}</span>
          <h1 className="fs-billboard-title">{item.title}</h1>
          <div className="fs-billboard-meta">
            {item.tierLabel && <span className="fs-match is-strong is-best">{item.tierLabel}</span>}
            <span>{item.channelTitle}</span>
            {duration && <span>{duration}</span>}
          </div>
          <p className="fs-billboard-why">{item.why}</p>
          {item.progress !== null && item.progress > 0.02 && (
            <div className="fs-billboard-progress" aria-label={`${Math.round(item.progress * 100)}% watched`}>
              <span style={{ width: `${Math.min(100, item.progress * 100)}%` }} />
            </div>
          )}
          <div className="fs-billboard-actions">
            <YtLink href={url} className="fs-cta fs-cta-play">
              <Play size={22} fill="currentColor" aria-hidden />
              {item.progress !== null && item.progress > 0.02 ? 'Resume' : 'Play'}
            </YtLink>
            {item.topicId && item.topicName && (
              <button type="button" className="fs-cta fs-cta-ghost" onClick={() => onTopic(item.topicId!)}>
                <Info size={20} aria-hidden />
                More {item.topicName}
              </button>
            )}
          </div>
        </m.div>
      </AnimatePresence>

      {count > 1 && (
        <div className="fs-billboard-dots" role="tablist" aria-label="Featured videos">
          {items.map((it, i) => (
            <button key={it.id} type="button" role="tab" aria-selected={i === index} aria-label={it.title} className="fs-billboard-dot" onClick={() => setIndex(i)}>
              {i === index && !reduce && !paused && <m.span className="fs-billboard-dot-fill" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: ROTATE_MS / 1000, ease: 'linear' }} />}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** maxres when YouTube has it; it serves a 120 px grey placeholder when not, so fall back on size. */
function BillboardImage({ id }: { id: string }) {
  const [src, setSrc] = useState(() => thumbnailUrl(id, 'maxres'));
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth <= 120 && src !== thumbnailUrl(id, 'hq')) setSrc(thumbnailUrl(id, 'hq'));
      }}
      onError={() => src !== thumbnailUrl(id, 'hq') && setSrc(thumbnailUrl(id, 'hq'))}
    />
  );
}
