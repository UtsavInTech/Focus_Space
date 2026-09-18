import type { LearningMode } from '@/types/domain';
import { FEED_MIN_SCORE } from '@/learning/classifier';
import { getClassifier } from '@/ai/registry';
import { CHIP, ITEMS, queryAll, queryFirst } from '../selectors';

/**
 * Marks search results with data-fs-rel="on|weak|off" so CSS can hide or dim
 * the ones unrelated to the active space. YouTube recycles result elements, so
 * each mark stores the key it was computed for; already-marked items with an
 * unchanged key cost one attribute read.
 */

export interface MarkStats {
  total: number;
  off: number;
}

function readItem(el: Element) {
  const link = el.querySelector<HTMLAnchorElement>(ITEMS.link);
  const titleEl = queryFirst(ITEMS.title, el);
  const title = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();
  const channelTitle = (queryFirst(ITEMS.channel, el)?.textContent || '').trim();
  const href = link?.getAttribute('href') ?? '';
  const videoId = href.match(/[?&]v=([\w-]{11})/)?.[1] ?? '';
  return { videoId, title, channelTitle };
}

export function markSearchResults(mode: LearningMode, debug = false): MarkStats {
  const classifier = getClassifier();
  const stats: MarkStats = { total: 0, off: 0 };
  for (const el of queryAll(ITEMS.search)) {
    const item = readItem(el);
    if (!item.title) continue; // not rendered yet
    stats.total++;
    const key = `${mode.id}:${mode.updatedAt}:${item.videoId}:${item.title.length}:${debug ? 1 : 0}`;
    if (el.getAttribute('data-fs-key') !== key) {
      const cls = classifier.classify({ videoId: item.videoId || item.title, title: item.title, channelTitle: item.channelTitle }, mode);
      const verdict = cls.strength === 'blocked' || (cls.relevance < 0.3 && cls.topical < 0.3) ? 'off' : cls.relevance >= FEED_MIN_SCORE ? 'on' : 'weak';
      el.setAttribute('data-fs-rel', verdict);
      el.setAttribute('data-fs-key', key);
      if (debug) el.setAttribute('data-fs-score', `${cls.relevance.toFixed(2)} ${cls.strength} ${cls.matchedTerms.join(',')}`);
      else el.removeAttribute('data-fs-score');
    }
    if (el.getAttribute('data-fs-rel') === 'off') stats.off++;
  }
  return stats;
}

export function clearMarks(): void {
  document.querySelectorAll('[data-fs-rel]').forEach((el) => {
    el.removeAttribute('data-fs-rel');
    el.removeAttribute('data-fs-key');
    el.removeAttribute('data-fs-score');
  });
}

/** The "Shorts" filter chip on search can't be matched by CSS alone (text label). */
export function markShortsChips(): void {
  document.querySelectorAll(CHIP.selector).forEach((chip) => {
    const isShorts = CHIP.shortsLabel.test(chip.textContent?.trim() ?? '');
    if (isShorts && !chip.hasAttribute('data-fs-shorts-chip')) chip.setAttribute('data-fs-shorts-chip', '');
    if (!isShorts && chip.hasAttribute('data-fs-shorts-chip')) chip.removeAttribute('data-fs-shorts-chip');
  });
}
