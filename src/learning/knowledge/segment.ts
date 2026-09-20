import { conceptTokens, labelSimilarity, sentenceCase, stem, words } from './text';
import type { OutlineCandidate, TranscriptSegment } from './types';

/**
 * Transcript segmentation without AI: a TextTiling-style lexical cohesion
 * curve (where vocabulary shifts), reinforced by spoken transition cues
 * ("now let's talk about binary search"). Labels come from the cue, the
 * space's vocabulary, or the section's most distinctive terms — in that order,
 * with confidence to match. It proposes a handful of meaningful sections, never
 * one per sentence.
 */

const FILLER = new Set(
  'so okay ok right now going gonna just like actually basically here there thing things want need get got one two three know see look also well really yeah um uh us we you i it this that these those very much can will would could should make sure first next then kind sort way lot little bit say said mean go goes going come back take good great time let lets'.split(' '),
);

/**
 * The same everyday words in Hindi — spoken and romanised. An auto-dubbed lecture is mostly these, and
 * without them a section's "most distinctive term" came out as करना or "karenge": true of the speech,
 * useless as a concept.
 */
const HINDI_FILLER =
  'है हैं था थे थी हो होता होती होते हुआ करना करता करती करते करेंगे किया कर के का की को में से पर और या तो कि जो यह वह ये वो हम हमने आप आपने मैं मैंने उस उसने इस इसे अब यहाँ यहां वहाँ वहां क्या कैसे क्यों जब तब अगर लेकिन बहुत सब कुछ एक दो तीन भी ही नहीं ना गया गयी दिया देते देखो देखते समझ समझते चलो चलिए मतलब बात बार साथ लिए वाला वाली जैसे ठीक अच्छा फिर अंदर बाहर ऊपर नीचे' +
  ' hai hain tha thi hota hoti hote hua karna karta karti karte karenge kiya mein aur yeh woh humne aapne maine usne ise yahan wahan kya kaise kyun agar lekin bahut kuch teen bhi nahi gaya gayi diya dete dekho dekhte samajh samajhte chalo chaliye matlab liye wala wali jaise theek accha phir andar bahar niche';
for (const w of HINDI_FILLER.split(' ')) if (w) FILLER.add(w);

/** Scripts the stemmer and the filler lists actually understand; elsewhere a one-word title is a guess. */
const hasLatin = (s: string) => /\p{Script=Latin}/u.test(s);

const CUE = /\b(?:let'?s|let us|we(?:'ll| will| are going to|'re going to| can now)|now we(?:'ll| will)?|next(?:,)? we(?:'ll| will)?|moving on|in this (?:section|part|lesson)|the next (?:topic|thing|concept|section) is)\b[^.?!]{0,24}?\b(?:talk about|look at|learn about|learn|discuss|cover|start with|move (?:on )?to|dive into|get into|understand|implement|introduce|explore|define|evaluate|build|write)\s+([^.?!]{3,70})/i;
const HINGLISH_CUE = /\b(?:ab hum|chaliye|chalo|next topic)\b[^.?!]{0,20}?\b([^.?!]{3,40}?)\s+(?:dekhenge|samjhenge|padhenge|karenge|seekhenge)\b/i;
const STOP_TITLE = /\s+(?:and then|so that|which|that is|because|where|in order|so we|and see|and how|in this|for this|right|okay)\b.*$/i;

interface Block {
  startSec: number;
  endSec: number;
  text: string;
  tf: Map<string, number>;
}

function buildBlocks(segments: TranscriptSegment[], blockSec: number): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const s of segments) {
    if (!cur || s.startSec - cur.startSec >= blockSec) {
      cur = { startSec: s.startSec, endSec: s.startSec + s.durSec, text: '', tf: new Map() };
      blocks.push(cur);
    }
    cur.text += ` ${s.text}`;
    cur.endSec = Math.max(cur.endSec, s.startSec + s.durSec);
    for (const t of conceptTokens(s.text)) if (!FILLER.has(t) && t.length > 2) cur.tf.set(t, (cur.tf.get(t) ?? 0) + 1);
  }
  return blocks;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function sumVectors(blocks: Block[], idf: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of blocks) for (const [k, v] of b.tf) out.set(k, (out.get(k) ?? 0) + v * (idf.get(k) ?? 0));
  return out;
}

const LEAD_JUNK = new Set('something simple very really quick quickly little bit basically actually so just how what is an a the this that our your my some about into at more another few'.split(' '));
const PRONOUN = new Set(["i", "i'm", 'im', 'you', "you're", 'we', "we're", 'he', 'she', 'it', "it's", 'they', 'me', 'us', 'them']);
const TAIL_JUNK = new Set('a an the of to for in on and or we as is are with that this by from at it so'.split(' '));

/** Spoken fragments make poor titles: "something simple what is an" → null, "efficiency of binary search we" → "Efficiency of binary search". */
export function tidySpokenTitle(fragment: string): string | null {
  const raw = fragment.replace(STOP_TITLE, '').toLowerCase().split(/\s+/).filter(Boolean);
  // A pronoun or a verb like "is" ends the noun phrase: "what an algorithm is" → "algorithm".
  const cut = raw.findIndex((w, i) => PRONOUN.has(w) || (i > 0 && /^(?:is|are|was|were|means|does|do|has|have)$/.test(w)));
  const seen = new Set<string>();
  // Speech repeats itself ("what an algorithm is an algorithm"): keep each word once.
  const list = (cut === -1 ? raw : raw.slice(0, cut)).filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
  while (list.length && LEAD_JUNK.has(list[0])) list.shift();
  const title = list.slice(0, 4);
  while (title.length && TAIL_JUNK.has(title[title.length - 1])) title.pop();
  const content = conceptTokens(title.join(' ')).filter((t) => !FILLER.has(t) && !TAIL_JUNK.has(t) && t.length >= 5);
  return content.length ? sentenceCase(title.join(' ')) : null;
}

function cueTitle(text: string): { title: string | null } | null {
  const m = text.match(CUE) ?? text.match(HINGLISH_CUE);
  return m ? { title: tidySpokenTitle(m[1]) } : null;
}

/** Most distinctive phrase of a stretch of transcript, as the speaker says it. */
function termTitle(text: string, idf: Map<string, number>): string | null {
  const surface = words(text);
  const score = new Map<string, { score: number; form: string }>();
  const bump = (key: string, form: string, s: number) => {
    const cur = score.get(key);
    score.set(key, { score: (cur?.score ?? 0) + s, form: cur?.form ?? form });
  };
  for (let i = 0; i < surface.length; i++) {
    const w = surface[i];
    const st = stem(w);
    if (FILLER.has(st) || FILLER.has(w) || w.length < 3 || !idf.has(st)) continue;
    bump(st, w, idf.get(st)!);
    const n = surface[i + 1];
    if (n && n.length >= 3 && !FILLER.has(n) && idf.has(stem(n))) bump(`${st} ${stem(n)}`, `${w} ${n}`, (idf.get(st)! + idf.get(stem(n))!) * 0.8);
  }
  const best = [...score.entries()].filter(([k]) => k.includes(' ') || (score.get(k)?.score ?? 0) > 0).sort((a, b) => b[1].score - a[1].score)[0];
  if (!best || best[1].score <= 4) return null;
  // A single word in a script we cannot stem (Devanagari, and anything else non-Latin) is too weak to name a
  // section by: only a phrase earns a title there.
  const form = best[1].form;
  if (!form.includes(' ') && !hasLatin(form)) return null;
  return sentenceCase(form);
}

function vocabularyTitle(text: string, vocabulary: string[]): string | null {
  const normalized = ` ${words(text).map(stem).join(' ')} `;
  let best: { phrase: string; count: number } | null = null;
  for (const phrase of vocabulary) {
    const key = conceptTokens(phrase).join(' ');
    if (!key) continue;
    // Multi-word topic names are far more telling than a single common word.
    const count = (normalized.split(` ${key} `).length - 1) * key.split(' ').length;
    if (count >= 2 && (!best || count > best.count || (count === best.count && phrase.length > best.phrase.length))) best = { phrase, count };
  }
  return best ? sentenceCase(best.phrase) : null;
}

export interface SegmentOptions {
  durationSec?: number | null;
  /** Topic names and keywords of the active space: preferred as labels. */
  vocabulary?: string[];
}

export function segmentTranscript(segments: TranscriptSegment[], options: SegmentOptions = {}): OutlineCandidate[] {
  if (segments.length < 8) return [];
  const span = (options.durationSec ?? segments[segments.length - 1].startSec + segments[segments.length - 1].durSec) - segments[0].startSec;
  if (span < 240) return [];
  const blockSec = Math.max(20, Math.min(45, span / 150));
  const blocks = buildBlocks(segments, blockSec);
  if (blocks.length < 8) return [];

  const df = new Map<string, number>();
  for (const b of blocks) for (const k of b.tf.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [k, n] of df) if (n >= 2 && n < blocks.length * 0.6) idf.set(k, Math.log(blocks.length / n));

  // Cohesion between the k blocks before and after each gap.
  const k = 3;
  const sims: number[] = [];
  for (let g = 1; g < blocks.length; g++) sims.push(cosine(sumVectors(blocks.slice(Math.max(0, g - k), g), idf), sumVectors(blocks.slice(g, g + k), idf)));
  const depth = sims.map((s, i) => {
    let left = s;
    for (let j = i - 1; j >= 0 && sims[j] >= left; j--) left = sims[j];
    let right = s;
    for (let j = i + 1; j < sims.length && sims[j] >= right; j++) right = sims[j];
    return left - s + (right - s);
  });
  const mean = depth.reduce((a, b) => a + b, 0) / depth.length;
  const sd = Math.sqrt(depth.reduce((a, b) => a + (b - mean) ** 2, 0) / depth.length);

  // Candidate gaps: deep valleys, or moderate ones where the speaker announces a new topic.
  const gaps = depth
    .map((d, i) => {
      const block = blocks[i + 1];
      const near = segments.filter((s) => s.startSec >= block.startSec - blockSec * 0.5 && s.startSec < block.startSec + blockSec).map((s) => s.text).join(' ');
      const cue = cueTitle(near);
      return { index: i + 1, depth: d, cue, strong: d > mean + 0.5 * sd, score: d + (cue ? sd * 0.75 : 0) };
    })
    .filter((g) => g.strong || (!!g.cue && g.depth > mean));

  const maxTopics = Math.max(1, Math.min(24, Math.round(span / 360)));
  const minGap = Math.max(150, span / 30);
  const chosen: typeof gaps = [];
  for (const g of [...gaps].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= maxTopics) break;
    if (chosen.some((c) => Math.abs(blocks[c.index].startSec - blocks[g.index].startSec) < minGap)) continue;
    if (blocks[g.index].startSec - blocks[0].startSec < minGap * 0.5) continue;
    chosen.push(g);
  }
  chosen.sort((a, b) => a.index - b.index);

  const bounds = [0, ...chosen.map((c) => c.index), blocks.length];
  const vocabulary = options.vocabulary ?? [];
  const out: OutlineCandidate[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const section = blocks.slice(bounds[i], bounds[i + 1]);
    const text = section.map((b) => b.text).join(' ');
    const gap = i === 0 ? null : chosen[i - 1];
    const cue = gap?.cue?.title ?? null;
    const announced = !!gap?.cue;
    const vocab = vocabularyTitle(text, vocabulary);
    const terms = termTitle(text, idf);
    const title = cue && (!vocab || labelSimilarity(cue, vocab) > 0) ? cue : vocab ?? cue ?? terms;
    if (!title) continue;
    const previous = out[out.length - 1];
    if (previous && labelSimilarity(previous.title, title) >= 0.8) continue; // same topic continues
    // An opening section named only by frequent words ("Course") stays below the visible threshold.
    const named = !!(cue || vocab);
    const confidence = i === 0 ? (vocab ? 0.6 : 0.45) : announced && gap?.strong && named ? 0.9 : announced && named ? 0.75 : vocab ? 0.7 : 0.58;
    out.push({ title, startSec: Math.round(section[0].startSec), source: 'transcript', confidence, depth: 0, support: 1, note: announced ? 'spoken transition' : vocab ? 'topic vocabulary' : 'vocabulary shift' });
  }
  return out;
}

/** Where a named concept is first discussed (for concepts listed without timestamps). */
export function firstMention(concept: string, segments: TranscriptSegment[]): number | null {
  const need = conceptTokens(concept);
  if (!need.length) return null;
  for (let i = 0; i < segments.length; i++) {
    const window = new Set(conceptTokens(`${segments[i].text} ${segments[i + 1]?.text ?? ''}`));
    if (need.every((t) => window.has(t))) return Math.round(segments[i].startSec);
  }
  return null;
}

/** Does the transcript talk about `title` close to `startSec`? */
export function transcriptSupports(title: string, startSec: number, segments: TranscriptSegment[], windowSec = 90): boolean {
  const need = conceptTokens(title).filter((t) => !FILLER.has(t) && t.length > 2);
  if (!need.length) return false;
  const nearby = new Set(conceptTokens(segments.filter((s) => s.startSec >= startSec - 30 && s.startSec <= startSec + windowSec).map((s) => s.text).join(' ')));
  const hits = need.filter((t) => nearby.has(t)).length;
  return hits >= Math.min(2, need.length);
}
