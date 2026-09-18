import { slugify } from '../text';
import { commentEvidence } from './comments';
import { descriptionEvidence } from './description';
import { firstMention, segmentTranscript, transcriptSupports } from './segment';
import { conceptTokens, hashString, labelSimilarity, sentenceCase } from './text';
import {
  KNOWLEDGE_VERSION,
  SOURCE_CONFIDENCE,
  type ChapterInput,
  type CommentInput,
  type KnowledgeEvidence,
  type KnowledgeMap,
  type KnowledgeNode,
  type KnowledgeSource,
  type OutlineCandidate,
  type Transcript,
} from './types';

/**
 * Builds the Knowledge Map by fusing evidence in priority order:
 *
 *   chapters → description timestamps → comments → transcript
 *
 * The strongest available source shapes the outline (the "backbone"). Weaker
 * sources either corroborate an existing item (raising its confidence) or add
 * finer concepts inside a backbone item, keeping their own grouping. Nothing is
 * invented where no source says anything.
 */

export interface KnowledgeInputs {
  videoId: string;
  durationSec: number | null;
  chapters: ChapterInput[];
  description: string;
  /** null = comments not loaded (as opposed to loaded and empty). */
  comments: CommentInput[] | null;
  transcript: Transcript | null;
  /** Topic names/keywords of the active space, preferred as transcript labels. */
  vocabulary?: string[];
  now?: number;
}

export function knowledgeSignature(inputs: KnowledgeInputs): string {
  const t = inputs.transcript;
  return hashString(
    [
      KNOWLEDGE_VERSION,
      Math.round((inputs.durationSec ?? 0) / 10),
      inputs.chapters.map((c) => `${c.startSec}:${c.title}`).join('|'),
      hashString(inputs.description),
      inputs.comments ? hashString(inputs.comments.map((c) => c.id).sort().join(',')) : 'no-comments',
      t ? `${t.languageCode}:${t.kind}:${t.segments.length}:${t.segments[t.segments.length - 1]?.startSec ?? 0}` : 'no-transcript',
      hashString((inputs.vocabulary ?? []).join('|')),
    ].join('#'),
  );
}

const combine = (a: number, b: number) => Math.min(0.99, 1 - (1 - a) * (1 - b * 0.5));
const round = (n: number) => Math.round(n * 100) / 100;

interface Draft {
  title: string;
  startSec: number;
  confidence: number;
  source: KnowledgeSource;
  evidence: KnowledgeEvidence[];
  children: Draft[];
}

const evidenceOf = (c: OutlineCandidate): KnowledgeEvidence => ({ source: c.source, startSec: c.startSec, confidence: c.confidence, support: c.support, note: c.note });
const draftOf = (c: OutlineCandidate): Draft => ({ title: c.title, startSec: c.startSec ?? 0, confidence: c.confidence, source: c.source, evidence: [evidenceOf(c)], children: [] });
const flatten = (nodes: Draft[]): Draft[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const byStart = (a: Draft, b: Draft) => a.startSec - b.startSec;

/** One source's candidates → its own tree (items nest under the header they were written under). */
function treeOf(candidates: OutlineCandidate[]): Draft[] {
  const roots: Draft[] = [];
  let lastRoot: { draft: Draft; title: string } | null = null;
  for (const c of [...candidates].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0) || a.depth - b.depth)) {
    if (c.startSec === null) continue;
    const node = draftOf(c);
    if (c.depth > 0 && lastRoot && (c.parent === undefined || c.parent === lastRoot.title)) lastRoot.draft.children.push(node);
    else {
      roots.push(node);
      lastRoot = { draft: node, title: c.title };
    }
  }
  return roots;
}

export function buildKnowledgeMap(inputs: KnowledgeInputs): KnowledgeMap {
  const duration = inputs.durationSec;
  const matchTol = Math.min(30, Math.max(10, (duration ?? 1800) * 0.004));
  const segments = inputs.transcript?.segments ?? [];
  const sources: Partial<Record<KnowledgeSource, number>> = {};

  const chapters: OutlineCandidate[] =
    inputs.chapters.length >= 2 ? inputs.chapters.map((c) => ({ title: c.title, startSec: c.startSec, source: c.auto ? 'auto-chapters' : 'chapters', confidence: SOURCE_CONFIDENCE[c.auto ? 'auto-chapters' : 'chapters'], depth: 0, support: 1 })) : [];
  const description = descriptionEvidence(inputs.description, duration);
  // Creator chapters are generated from the description: the same list is not independent evidence.
  const sameAsChapters = chapters.length > 0 && !inputs.chapters[0].auto && description.outline.filter((d) => chapters.some((c) => Math.abs((c.startSec ?? 0) - (d.startSec ?? 0)) <= 2)).length >= description.outline.length * 0.6;
  const descOutline = sameAsChapters ? [] : description.outline;
  const comments = inputs.comments ? commentEvidence(inputs.comments, duration) : { outline: [], mentions: [], readings: [] };
  const usableComments = comments.outline.length >= 3 || comments.outline.filter((c) => c.support > 1).length >= 2 ? comments.outline : [];
  const transcriptOutline = segments.length ? segmentTranscript(segments, { durationSec: duration, vocabulary: inputs.vocabulary }) : [];

  if (chapters.length) sources[chapters[0].source] = chapters.length;
  if (descOutline.length) sources.description = descOutline.length;
  if (comments.outline.length) sources.comments = comments.outline.length;
  if (transcriptOutline.length) sources.transcript = transcriptOutline.length;

  const ranked: [KnowledgeSource, OutlineCandidate[]][] = [
    [chapters[0]?.source ?? 'chapters', chapters],
    ['description', descOutline],
    ['comments', usableComments],
    ['transcript', transcriptOutline.length >= 2 ? transcriptOutline : []],
  ];
  const backbone = ranked.find(([, list]) => list.length >= 2) ?? null;
  const roots: Draft[] = backbone ? treeOf(backbone[1]) : [];

  /**
   * Where a draft goes: a leaf joins the deepest group (a node that already has
   * parts) containing t; a group of its own sits directly under the top-level node.
   */
  const groupFor = (list: Draft[], t: number, parentEnd: number | null, top: boolean, shallow = false): { node: Draft; end: number | null; top: boolean } | null => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const end = list[i + 1]?.startSec ?? parentEnd;
      if (t < n.startSec - 2 || (end !== null && t >= end - 2)) continue;
      const deeper = n.children.length && !(shallow && top) ? groupFor(n.children, t, end, false) : null;
      if (deeper) return deeper;
      return top || n.children.length ? { node: n, end, top } : null;
    }
    return null;
  };

  const findMatch = (title: string, startSec: number) =>
    flatten(roots).find((n) => {
      const gap = Math.abs(n.startSec - startSec);
      const sim = labelSimilarity(n.title, title);
      return (gap <= matchTol && sim >= 0.3) || (gap <= matchTol * 4 && sim >= 0.6);
    });

  const merge = (draft: Draft) => {
    const match = findMatch(draft.title, draft.startSec);
    if (match) {
      if (!match.evidence.some((e) => e.source === draft.source)) {
        match.evidence.push(...draft.evidence);
        match.confidence = combine(match.confidence, draft.confidence);
      }
      draft.children.forEach(merge);
      return;
    }
    const group = groupFor(roots, draft.startSec, duration, true, draft.children.length > 0);
    if (!group) return; // before anything the backbone covers: don't invent
    const span = group.end === null ? Infinity : group.end - group.node.startSec;
    if (draft.source === 'transcript' && (!group.top || group.node.children.length || span < 360 || draft.confidence < 0.75)) return;
    if (span < 150 && !group.node.children.length) return;
    group.node.children.push(draft);
    group.node.children.sort(byStart);
  };

  for (const [source, list] of ranked) {
    if (backbone && source === backbone[0]) continue;
    treeOf(list).forEach(merge);
  }

  // The transcript's topic shifts and wording back up comment-only items at that moment.
  if (segments.length)
    for (const n of flatten(roots)) {
      if (!n.evidence.every((e) => e.source === 'comments')) continue;
      const shift = transcriptOutline.some((t) => Math.abs((t.startSec ?? 0) - n.startSec) <= matchTol * 2);
      if (shift || transcriptSupports(n.title, n.startSec, segments)) {
        n.evidence.push({ source: 'transcript', startSec: n.startSec, confidence: 0.1, support: 1, note: shift ? 'the transcript changes topic here' : 'the transcript mentions it here' });
        n.confidence = Math.min(0.9, n.confidence + (shift ? 0.06 : 0.04));
      }
    }

  let tree = dedupe(groupSiblings(roots.sort(byStart)));

  // Concepts named without a time: place them from the transcript when possible, else keep as mentions.
  const mentions: string[] = [];
  const known = flatten(tree).map((n) => n.title);
  for (const m of [...description.mentions, ...comments.mentions]) {
    if (known.some((k) => labelSimilarity(k, m) >= 0.6) || mentions.some((k) => labelSimilarity(k, m) >= 0.6)) continue;
    const at = segments.length ? firstMention(m, segments) : null;
    const group = at !== null ? groupFor(tree, at, duration, true) : null;
    if (group && at !== null) {
      group.node.children.push(draftOf({ title: sentenceCase(m), startSec: at, source: 'transcript', confidence: 0.55, depth: 0, support: 1, note: 'first mentioned here' }));
      group.node.children.sort(byStart);
      continue;
    }
    mentions.push(m);
  }
  tree = tree.sort(byStart);

  return {
    videoId: inputs.videoId,
    version: KNOWLEDGE_VERSION,
    durationSec: duration,
    nodes: finalize(tree, duration, new Set()),
    mentions: mentions.slice(0, 12),
    backbone: backbone?.[0] ?? null,
    sources,
    signature: knowledgeSignature(inputs),
    builtAt: inputs.now ?? Date.now(),
  };
}

/** "Insertion at beginning", "Insertion at end", "Insertion in middle" → "Insertion" › parts. */
function groupSiblings(nodes: Draft[], parentHead = ''): Draft[] {
  const out: Draft[] = [];
  const head = (title: string) => conceptTokens(title)[0] ?? '';
  let i = 0;
  while (i < nodes.length) {
    const h = head(nodes[i].title);
    let j = i + 1;
    while (j < nodes.length && h && head(nodes[j].title) === h) j++;
    const run = nodes.slice(i, j);
    // Already grouped under this word: don't group again one level down.
    const generic = h === parentHead || /^(?:intro|introduct|overview|summary|question|example|conclus|recap|part|lecture|lesson|chapter|section|day|session|what|how|why|big|time|the|understand|learn|using|use|explor|work|build|creat|implement|appl|handl)$/.test(h);
    const exact = run.find((n) => conceptTokens(n.title).length === 1);
    if (run.length >= 3 && !generic && run.every((n) => !n.children.length)) {
      const word = run[0].title.split(/\s+/)[0].replace(/[:,-]$/, '');
      const confidence = Math.min(...run.map((n) => n.confidence));
      const parent: Draft = exact ?? { title: sentenceCase(word), startSec: run[0].startSec, confidence, source: run[0].source, evidence: [{ source: run[0].source, startSec: run[0].startSec, confidence, support: run.length, note: 'groups related items' }], children: [] };
      parent.children = run.filter((n) => n !== parent);
      out.push(parent);
    } else out.push(...run);
    i = j;
  }
  return out.map((n) => ({ ...n, children: groupSiblings(n.children, head(n.title)) }));
}

/** Merge consecutive duplicates and children that merely repeat their parent. */
function dedupe(nodes: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && labelSimilarity(prev.title, n.title) >= 0.8) {
      prev.evidence.push(...n.evidence);
      prev.confidence = Math.max(prev.confidence, n.confidence);
      prev.children.push(...n.children);
      continue;
    }
    out.push(n);
  }
  for (const n of out) {
    const same = n.children.filter((c) => Math.abs(c.startSec - n.startSec) < 5 && labelSimilarity(c.title, n.title) >= 0.8);
    for (const c of same) {
      n.evidence.push(...c.evidence);
      n.children.push(...c.children);
    }
    n.children = dedupe(n.children.filter((c) => !same.includes(c)).sort(byStart));
  }
  return out;
}

function finalize(drafts: Draft[], parentEnd: number | null, taken: Set<string>): KnowledgeNode[] {
  return drafts.map((d, i) => {
    let id = `${Math.round(d.startSec)}-${slugify(d.title)}`;
    while (taken.has(id)) id += '-2';
    taken.add(id);
    const endSec = drafts[i + 1]?.startSec ?? parentEnd;
    // The source that carries the item, not one that merely backs it up.
    const best = d.evidence.reduce((a, b) => (b.confidence > a.confidence ? b : a), d.evidence[0]);
    return { id, title: d.title, startSec: Math.round(d.startSec), endSec: endSec === null ? null : Math.round(endSec), confidence: round(d.confidence), source: best.source, evidence: d.evidence, children: finalize(d.children, endSec, taken) };
  });
}
