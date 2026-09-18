import { textOutline } from './outline';
import { cleanLabel, isProgressNoise, isTopicLabel, timestampLines } from './timestamps';
import { labelSimilarity, sentenceCase } from './text';
import type { CommentInput, OutlineCandidate } from './types';

/**
 * Comment intelligence. Viewers often write the chapters a creator didn't:
 * "00:00 Intro / 05:20 Arrays / 14:30 Sliding window", or "at 31:20 he starts
 * recursion". Comments are also jokes, progress logs, requests and bug reports,
 * so each comment is read first (outline / moment / summary / noise), and what
 * remains is clustered: independent viewers agreeing on the same moment is
 * stronger than one comment. Comment evidence always ranks below chapters,
 * the description and the transcript.
 */

export type CommentKind = 'outline' | 'moment' | 'summary' | 'noise';

export interface CommentReading {
  id: string;
  kind: CommentKind;
  reason: string;
  candidates: OutlineCandidate[];
  mentions: string[];
}

const SPAM = /\b(?:check (?:out )?my|visit my|my channel|subscribe to (?:my|our)|telegram|whatsapp|dm me|join (?:my|our)|promo code|discount|giveaway)\b/i;
const REQUEST = /\b(?:please|pls|plz|kindly|request)\b[^.?!\n]{0,60}\b(?:make|upload|bring|create|cover|start)\b|\bcan you (?:please )?(?:make|upload|do|cover)\b|\bnext video (?:on|about)\b|\bwaiting for (?:the )?(?:next|part)\b/i;
const DISCUSSION = /\b(?:bug|mistake|wrong|error|typo|incorrect|correct answer|doubt|confus\w*|didn'?t understand|not able|issue|lost it|note that|i think|similar (?:in|to)|quiz|answer is)\b|\?/i;
const REACTION = /[😂🤣😭😆]|\b(?:lol|lmao|haha+|funny|expression|his face|her face|goosebumps|legend|frustrat\w*|crying)\b/i;
const MOMENT_CUE = /\b(?:starts?|begins?|started|explain(?:s|ed|ing)?|covers?|covered|teach(?:es|ing)?|talks? about|introduc(?:es|ed))\b/i;
const SUMMARY_CUE = /\b(?:covered|covers|taught|teaches|explained|topics? (?:covered|are|include)|(?:this|the) (?:video|lecture) (?:covers|explains|teaches))\b\s*:?\s*/i;
const LEAD_WORDS = /^(?:at|from|around|here|he|she|sir|mam|ma'am|they|the (?:instructor|teacher)|he's|she's|is|was)\s+/i;

const likeBoost = (likes: number) => Math.min(0.06, Math.log10(1 + Math.max(0, likes)) * 0.02);

function momentTitle(raw: string): string | null {
  const text = raw.replace(/@?(?:\d{1,2}:)?\d{1,3}:\d{2}/g, ' ').replace(/\s+/g, ' ').trim();
  const patterns = [
    /\b(?:starts?|begins?|started)\s+(?:explaining|teaching|discussing|talking about|with|on)?\s*([^.,!?\n]{3,50})/i,
    /\b(?:explain(?:s|ing)?|covers?|teach(?:es|ing)?|talks? about|introduc(?:es|ed))\s+([^.,!?\n]{3,50})/i,
    /^([^.,!?\n]{3,40}?)\s+(?:starts?|begins?)\b/i,
  ];
  for (const re of patterns) {
    let title = text.match(re)?.[1]?.trim();
    if (!title) continue;
    for (let i = 0; i < 3; i++) title = title.replace(LEAD_WORDS, '');
    title = cleanLabel(title.split(/\s+(?:and then|so|because|which|where|but)\s+/i)[0]).split(/\s+/).slice(0, 6).join(' ');
    if (title && isTopicLabel(title) && !/^(?:the|a|an|this|it|here|now|from|at)$/i.test(title)) return sentenceCase(title);
  }
  return null;
}

export function readComment(comment: CommentInput, durationSec: number | null): CommentReading {
  const reading = (kind: CommentKind, reason: string, candidates: OutlineCandidate[] = [], mentions: string[] = []): CommentReading => ({ id: comment.id, kind, reason, candidates, mentions });
  const text = comment.text;
  if (SPAM.test(text)) return reading('noise', 'promotion');

  const lines = timestampLines(text);
  const outline = textOutline(text, durationSec);
  const base = (comment.isCreator ? 0.85 : 0.6 + likeBoost(comment.likes)) - (comment.replyLevel > 0 ? 0.04 : 0);

  if (outline.items.length >= 3 && outline.ascending >= 0.8 && outline.items.filter((i) => i.depth === 0 || i.depth === 1).length >= 0.6 * (lines.length || 1)) {
    return reading(
      'outline',
      `${outline.items.length} timestamped topics`,
      outline.items.map((item) => ({ title: item.title, startSec: item.startSec, source: 'comments', confidence: base, depth: item.depth, parent: item.parent, support: 1, note: comment.isCreator ? 'pinned by the creator' : undefined })),
    );
  }
  if (lines.length && lines.filter(isProgressNoise).length >= Math.ceil(lines.length / 2)) return reading('noise', 'progress log');
  if (REQUEST.test(text)) return reading('noise', 'request for another video');

  if (lines.length >= 1 && lines.length <= 2) {
    if (REACTION.test(text)) return reading('noise', 'reaction');
    const line = lines[0];
    const inRange = durationSec === null || line.startSec <= durationSec + 5;
    const cue = MOMENT_CUE.test(text) ? momentTitle(line.raw) : null;
    const title = cue ?? (!DISCUSSION.test(text) && isTopicLabel(line.label) && line.label.split(/\s+/).length <= 5 ? sentenceCase(line.label) : null);
    if (title && inRange) return reading('moment', cue ? 'says where a topic starts' : 'labels a timestamp', [{ title, startSec: line.startSec, source: 'comments', confidence: base - 0.02, depth: 0, support: 1 }]);
    return reading('noise', DISCUSSION.test(text) ? 'discussion of a moment' : 'timestamp without a topic');
  }

  if (!lines.length && SUMMARY_CUE.test(text) && !REACTION.test(text)) {
    const after = text.split(SUMMARY_CUE)[1] ?? '';
    const mentions = after
      .split(/[\n.!?]/)[0]
      .split(/,|;|\band\b|&/)
      .map((s) => cleanLabel(s))
      .filter((s) => s && isTopicLabel(s) && s.split(/\s+/).length <= 5)
      .slice(0, 8);
    if (mentions.length) return reading('summary', 'lists what was covered', [], mentions);
  }
  return reading('noise', lines.length ? 'no usable structure' : 'no timestamps');
}

export interface CommentEvidence {
  /** Clustered, de-conflicted outline candidates. */
  outline: OutlineCandidate[];
  mentions: string[];
  readings: CommentReading[];
}

/** Read every comment, then merge agreeing timestamps and resolve conflicts. */
export function commentEvidence(comments: CommentInput[], durationSec: number | null): CommentEvidence {
  const readings = comments.map((c) => readComment(c, durationSec));
  const tol = Math.min(60, Math.max(15, (durationSec ?? 1800) * 0.01));
  const conflictWindow = Math.min(240, Math.max(60, (durationSec ?? 1800) * 0.02));

  interface Cluster {
    items: (OutlineCandidate & { commentId: string })[];
    startSec: number;
    title: string;
    conflict: boolean;
  }
  const items = readings.flatMap((r) => r.candidates.map((c) => ({ ...c, commentId: r.id }))).sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
  const clusters: Cluster[] = [];
  for (const item of items) {
    const home = clusters.find(
      (c) => Math.abs(c.startSec - (item.startSec ?? 0)) <= tol && !c.items.some((i) => i.commentId === item.commentId) && labelSimilarity(c.title, item.title) >= 0.3,
    );
    if (home) {
      home.items.push(item);
      const times = home.items.map((i) => i.startSec ?? 0).sort((a, b) => a - b);
      home.startSec = times[Math.floor((times.length - 1) / 2)];
    } else clusters.push({ items: [item], startSec: item.startSec ?? 0, title: item.title, conflict: false });
  }

  const supportOf = (c: Cluster) => new Set(c.items.map((i) => i.commentId)).size;
  const bestConfidence = (c: Cluster) => Math.max(...c.items.map((i) => i.confidence));
  // Same topic, slightly different times: someone is off. Far apart = the topic genuinely comes up twice.
  const dropped = new Set<Cluster>();
  for (const a of clusters)
    for (const b of clusters) {
      if (a === b || dropped.has(a) || dropped.has(b)) continue;
      const gap = Math.abs(a.startSec - b.startSec);
      if (gap <= tol || gap > conflictWindow || labelSimilarity(a.title, b.title) < 0.75) continue;
      const [winner, loser] = supportOf(a) > supportOf(b) || (supportOf(a) === supportOf(b) && bestConfidence(a) >= bestConfidence(b)) ? [a, b] : [b, a];
      dropped.add(loser);
      winner.conflict = true;
    }

  const outline = clusters
    .filter((c) => !dropped.has(c))
    .map((c): OutlineCandidate => {
      const support = supportOf(c);
      const best = c.items.reduce((x, y) => (y.confidence > x.confidence ? y : x));
      // Structure comes from the most structured comment (the one that nests items under headers).
      const structured = c.items.find((i) => i.parent !== undefined || i.depth > 0) ?? c.items.find((i) => i.depth === 0) ?? best;
      let confidence = support >= 3 ? Math.min(0.85, 0.76 + 0.03 * (support - 2)) : support === 2 ? 0.76 : best.confidence;
      confidence = Math.max(confidence, best.confidence) - (c.conflict ? 0.07 : 0);
      const notes = [support > 1 ? `${support} comments agree` : '', c.conflict ? 'conflicting times in comments' : '', best.note ?? ''].filter(Boolean);
      return { title: structured.title, startSec: c.startSec, source: 'comments', confidence: Math.round(confidence * 100) / 100, depth: structured.depth, parent: structured.parent, support, note: notes.join(' · ') || undefined };
    });

  const mentions = [...new Set(readings.flatMap((r) => r.mentions))];
  return { outline, mentions, readings };
}
