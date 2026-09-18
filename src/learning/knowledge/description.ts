import { textOutline } from './outline';
import { cleanLabel, isTopicLabel } from './timestamps';
import { SOURCE_CONFIDENCE, type OutlineCandidate } from './types';

/**
 * Evidence from the video description: timestamped outlines (often present
 * even when YouTube didn't turn them into chapters, e.g. when the list doesn't
 * start at 0:00) and topic lists without timestamps.
 */

const LIST_HEADER = /\b(?:topics?(?: covered| discussed)?|what you(?:'ll| will) learn|in this (?:video|lecture|lesson|class)|contents|agenda|syllabus|we (?:will )?cover|timestamps|chapters)\b\s*[:\-]?\s*$/i;
const BULLET = /^\s*(?:[-–•·*✅✔️👉➡️►▶]|\d{1,2}[.)])\s*/u;

export interface DescriptionEvidence {
  outline: OutlineCandidate[];
  /** Concepts listed without timestamps. */
  mentions: string[];
}

export function descriptionEvidence(description: string, durationSec: number | null): DescriptionEvidence {
  const outline = textOutline(description, durationSec);
  const strong = outline.items.length >= 3 && outline.ascending >= 0.75;
  const candidates: OutlineCandidate[] =
    outline.items.length >= 2
      ? outline.items.map((item) => ({
          title: item.title,
          startSec: item.startSec,
          source: 'description' as const,
          confidence: strong ? SOURCE_CONFIDENCE.description : 0.78,
          depth: item.depth,
          parent: item.parent,
          support: 1,
        }))
      : [];
  return { outline: candidates, mentions: topicList(description) };
}

/** Bulleted topic lists under a header like "Topics covered:". */
function topicList(description: string): string[] {
  const out: string[] = [];
  let inList = false;
  for (const line of description.split(/\r?\n/)) {
    if (LIST_HEADER.test(line.trim())) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (!line.trim()) {
      if (out.length) inList = false;
      continue;
    }
    if (!BULLET.test(line) || /\d{1,2}:\d{2}/.test(line) || /https?:\/\//.test(line)) {
      inList = false;
      continue;
    }
    const label = cleanLabel(line.replace(BULLET, ''));
    if (label && isTopicLabel(label) && label.split(/\s+/).length <= 8 && !out.includes(label)) out.push(label);
    if (out.length >= 15) break;
  }
  return out;
}
