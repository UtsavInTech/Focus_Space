import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWatchNext } from '@/integrations/youtube/innertube-parse';
import { parseChapters, parseCommentsPage, parseCommentsToken, parseDescriptionPlaylists } from '@/integrations/youtube/knowledge-parse';
import { compactSegments, parseTimedText } from '@/integrations/youtube/transcript-parse';
import { commentEvidence, readComment } from './comments';
import { descriptionEvidence } from './description';
import { buildKnowledgeMap, knowledgeSignature, type KnowledgeInputs } from './fuse';
import { conceptStops, locateConcept } from './locate';
import { firstMention, segmentTranscript, tidySpokenTitle } from './segment';
import { isProgressNoise, isTopicLabel, parseTimestamp, timestampLines } from './timestamps';
import type { CommentInput, KnowledgeNode, Transcript } from './types';

/** Real responses captured from youtube.com on 2026-09-13 (trimmed). */
const yt = (name: string) => JSON.parse(readFileSync(new URL(`../../integrations/youtube/__fixtures__/innertube/${name}.json`, import.meta.url), 'utf8'));
const local = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'));
const commentsOf = (name: string): CommentInput[] => yt(name).pages.flatMap((p: unknown) => parseCommentsPage(p).comments);
const comment = (text: string, extra: Partial<CommentInput> = {}): CommentInput => ({ id: `c${Math.abs([...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7))}`, text, likes: 3, isCreator: false, replyLevel: 0, ...extra });
const titles = (nodes: KnowledgeNode[]) => nodes.map((n) => n.title);
const find = (nodes: KnowledgeNode[], title: string): KnowledgeNode | undefined => {
  for (const n of nodes) {
    if (n.title === title) return n;
    const inner = find(n.children, title);
    if (inner) return inner;
  }
  return undefined;
};
const inputs = (patch: Partial<KnowledgeInputs>): KnowledgeInputs => ({ videoId: 'vid', durationSec: 3600, chapters: [], description: '', comments: null, transcript: null, now: 0, ...patch });

const LINKED_LIST_DESCRIPTION = [
  '0:00 Introduction',
  '4:12 What is a Linked List',
  '12:40 Node structure',
  '17:32 Insertion at beginning',
  '21:00 Insertion at end',
  '25:10 Insertion in middle',
  '29:15 Deletion',
  '41:20 Searching',
  '52:10 Reversal',
].join('\n');

describe('YouTube evidence extraction (real responses)', () => {
  it('reads creator chapters', () => {
    const chapters = parseChapters(yt('nextChapters'));
    expect(chapters).toHaveLength(20);
    expect(chapters[0]).toEqual({ title: 'course introduction', startSec: 0, auto: false });
    expect(chapters[1].startSec).toBe(210);
    expect(chapters.every((c, i) => i === 0 || c.startSec > chapters[i - 1].startSec)).toBe(true);
    expect(parseChapters(yt('nextDescriptionTimestamps'))).toEqual([]);
  });

  it('finds the course playlist the creator links in the description', () => {
    const json = yt('nextDescriptionTimestamps');
    expect(parseDescriptionPlaylists(json)).toContain('PLfqMhTWNBTe3LtFWcvwpqTkUSlB32kJop');
    expect(parseWatchNext(json, 'oAja8-Ulz6o').description).toContain('16:20 - Insert in a Linked List');
  });

  it('reads comment pages with likes, creator flags and the next-page token', () => {
    expect(parseCommentsToken(yt('nextChapters'))).toMatch(/^[\w-%=]{20,}$/);
    const page = parseCommentsPage(yt('commentsCourse').pages[0]);
    expect(page.comments).toHaveLength(20);
    expect(page.continuation).toMatch(/^[\w-%=]{20,}$/);
    expect(page.comments.some((c) => c.likes >= 1000)).toBe(true);
    expect(page.comments.every((c) => c.id && typeof c.text === 'string')).toBe(true);
  });

  it('parses the captions YouTube’s player loads (json3) and compacts them', () => {
    const segments = parseTimedText(JSON.stringify(yt('timedtext')));
    expect(segments[0].text).toBe('this is a full-length course from');
    expect(segments.every((s) => s.text.trim() && !s.text.includes('\n'))).toBe(true);
    const compact = compactSegments(segments);
    expect(compact.length).toBeLessThan(segments.length);
    expect(compact.every((s) => s.durSec <= 16)).toBe(true);
    expect(parseTimedText('<transcript><text start="1.5" dur="2">Hello &amp; welcome</text></transcript>')).toEqual([{ startSec: 1.5, durSec: 2, text: 'Hello & welcome' }]);
    expect(parseTimedText('')).toEqual([]);
  });
});

describe('timestamps in free text', () => {
  it('parses clock values', () => {
    expect(parseTimestamp('1:05:20')).toBe(3920);
    expect(parseTimestamp('75:30')).toBe(4530);
    expect(parseTimestamp('00:02')).toBe(2);
    expect(parseTimestamp('12:61')).toBeNull();
    expect(parseTimestamp('1:75:00')).toBeNull();
  });

  it('reads labels on either side, ranges and clip lengths', () => {
    expect(timestampLines('Worts Case Scenario - 25:21')[0]).toMatchObject({ startSec: 1521, label: 'Worts Case Scenario' });
    expect(timestampLines('00:06:50 ▶ Guess the Number — Early search intuition')[0]).toMatchObject({ startSec: 410, label: 'Guess the Number — Early search intuition' });
    expect(timestampLines('01:53:00 🔁 Recap — Recursion & Space Complexity (4:37)')[0]).toMatchObject({ startSec: 6780, label: 'Recap — Recursion & Space Complexity' });
    expect(timestampLines('day 1) 00:00 - 36:33')[0]).toMatchObject({ startSec: 0, endSec: 2193 });
  });

  it('recognises personal progress logs, dates and reactions', () => {
    expect(isProgressNoise(timestampLines('day 1) 00:00 - 36:33')[0])).toBe(true);
    expect(isProgressNoise(timestampLines('Feb 7 2:09:50')[0])).toBe(true);
    expect(isProgressNoise(timestampLines('12:34 Arrays')[0])).toBe(false);
    expect(isProgressNoise(timestampLines('11:00 Live on 13 June 2026 at')[0])).toBe(true);
    expect(isTopicLabel('Love the expression on his face')).toBe(false);
    expect(isTopicLabel('Linked List Insertion')).toBe(true);
  });
});

describe('description evidence', () => {
  it('uses timestamps YouTube did not turn into chapters (Apna College, Linked List)', () => {
    const desc = parseWatchNext(yt('nextDescriptionTimestamps'), 'oAja8-Ulz6o').description;
    const { outline } = descriptionEvidence(desc, 2700);
    expect(outline.map((o) => [o.startSec, o.title])).toEqual([
      [980, 'Insert in a Linked List (First & Last)'],
      [1610, 'Display/Print a Linked List'],
      [1850, 'Delete in a Linked List (First & Last)'],
      [2321, 'Size of a Linked List'],
      [2461, 'LinkedList class (Collections Framework)'],
    ]);
    expect(outline.every((o) => o.confidence === 0.9 && o.source === 'description')).toBe(true);
  });

  it('drops markdown emphasis and dates from outline titles', () => {
    const { outline } = descriptionEvidence('__Beginner Level__\n0:00 Intro\n7:38 **Introduction to SQL**\n11:00 This on 13 June 2026 at', 3600);
    expect(outline.map((o) => o.title)).toEqual(['Beginner Level', 'Intro', 'Introduction to SQL']);
  });

  it('collects topic lists without timestamps as mentions', () => {
    const { outline, mentions } = descriptionEvidence('In this video:\n- Arrays\n- Two pointers\n- Sliding window\n\nFollow me on X', 1800);
    expect(outline).toEqual([]);
    expect(mentions).toEqual(['Arrays', 'Two pointers', 'Sliding window']);
  });
});

describe('comment intelligence', () => {
  it('reads timestamped outlines written by viewers', () => {
    const r = readComment(comment('00:00 introduction\n05:20 what is linked list\n18:30 insertion\n35:10 deletion\n48:00 reversal'), 3600);
    expect(r.kind).toBe('outline');
    expect(r.candidates.map((c) => c.startSec)).toEqual([0, 320, 1110, 2110, 2880]);
    expect(r.candidates.every((c) => c.confidence >= 0.6 && c.confidence <= 0.7)).toBe(true);
  });

  it('does not turn list labels like "Topics covered:" into a concept', () => {
    const r = readComment(comment('Topics covered:\n00:00 Arrays\n12:15 Two pointer\n25:40 Sliding window'), 3600);
    expect(r.candidates.map((c) => [c.title, c.depth])).toEqual([
      ['Arrays', 0],
      ['Two pointer', 0],
      ['Sliding window', 0],
    ]);
  });

  it('reads "at 31:20 he starts explaining recursion" as a moment', () => {
    const r = readComment(comment('At 31:20 he starts explaining recursion'), 3600);
    expect(r.kind).toBe('moment');
    expect(r.candidates[0]).toMatchObject({ title: 'Recursion', startSec: 1880 });
  });

  it('ignores requests, jokes, progress logs and discussions', () => {
    expect(readComment(comment('Sir please make a separate video for binary trees after this'), 3600)).toMatchObject({ kind: 'noise', reason: 'request for another video' });
    expect(readComment(comment('Love the expression on his face when John says "Is it one?" 11:32'), 3600).kind).toBe('noise');
    expect(readComment(comment('day 1) 00:00 - 36:33\nday 2) 36:33 - 1:04:22\n\ni finished!!!! yey'), 20000)).toMatchObject({ kind: 'noise', reason: 'progress log' });
    expect(readComment(comment('Feb 7 2:09:50\nFeb 8 4:21:34\nFinished'), 20000)).toMatchObject({ kind: 'noise', reason: 'progress log' });
    expect(readComment(comment('8:56 this is similar in python usnig \\n for next line'), 3600).kind).toBe('noise');
  });

  it('picks up "today he covered…" summaries as mentions', () => {
    const r = readComment(comment('Today he covered linked list insertion, deletion and reversal.'), 3600);
    expect(r.kind).toBe('summary');
    expect(r.mentions).toEqual(['linked list insertion', 'deletion', 'reversal']);
  });

  it('independent comments agreeing on a moment are stronger than one', () => {
    const one = commentEvidence([comment('At 17:32 he starts insertion.')], 3600).outline;
    const two = commentEvidence([comment('At 17:32 he starts insertion.'), comment('17:30 insertion starts')], 3600).outline;
    expect(one[0].confidence).toBeLessThan(0.7);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ title: 'Insertion', support: 2, confidence: 0.76 });
    expect(two[0].note).toContain('2 comments agree');
  });

  it('resolves conflicting timestamps in favour of the majority, with less confidence', () => {
    const { outline } = commentEvidence([comment('At 17:32 he starts insertion.'), comment('17:30 insertion starts'), comment('insertion starts at 19:10')], 6000);
    const insertion = outline.filter((o) => o.title === 'Insertion');
    expect(insertion).toHaveLength(1);
    expect(insertion[0].startSec).toBeLessThan(1060);
    expect(insertion[0].confidence).toBeCloseTo(0.69, 2);
    expect(insertion[0].note).toContain('conflicting');
  });

  it('classifies real comments: two outlines, the rest noise', () => {
    const { readings, outline } = commentEvidence(commentsOf('commentsCourse'), 19330);
    expect(readings.filter((r) => r.kind === 'outline')).toHaveLength(2);
    expect(readings.find((r) => r.id === 'UgwhPEY6T5axCH9uEk14AaABAg')?.reason).toBe('progress log');
    expect(readings.find((r) => r.id === 'Ugy5WgasATLfdkNyXlR4AaABAg')?.reason).toBe('progress log');
    expect(readings.find((r) => r.id === 'UgwgRER9ZJ5GsolbQgR4AaABAg')?.kind).toBe('noise');
    // "Binary Search - 1:18:10" and "01:17:58 ▶ Binary Search in Code" are the same moment.
    expect(outline.find((o) => o.title === 'Binary Search in Code')).toMatchObject({ support: 2 });
    expect(commentEvidence([], 600).outline).toEqual([]);
  });
});

describe('transcript segmentation', () => {
  const transcript = local('transcript-8hly31xKli0') as Transcript;
  // Topic starts written by a viewer for the same 75 minutes (comment fixture) — an independent reference.
  const reference = [20, 410, 766, 1273, 1521, 1796, 2169, 2557, 2949, 3226, 3381, 3464, 3859, 4098, 4190];

  it('finds real topic changes in a real lecture, quickly, with few sections', () => {
    const started = performance.now();
    const sections = segmentTranscript(transcript.segments, { durationSec: 4500, vocabulary: ['Linear Search', 'Binary Search', 'Big O', 'Recursion'] });
    expect(performance.now() - started).toBeLessThan(300);
    expect(sections.length).toBeGreaterThanOrEqual(5);
    expect(sections.length).toBeLessThanOrEqual(15);
    const boundaries = sections.slice(1).map((s) => s.startSec ?? 0);
    const near = boundaries.filter((b) => reference.some((r) => Math.abs(r - b) <= 60));
    expect(near.length / boundaries.length).toBeGreaterThanOrEqual(0.6);
    expect(sections.every((s) => s.title.length <= 40)).toBe(true);
  });

  it('turns spoken fragments into short titles, or none', () => {
    expect(tidySpokenTitle('something simple what is an')).toBeNull();
    expect(tidySpokenTitle("you i'm thinking of a")).toBeNull();
    expect(tidySpokenTitle('efficiency of binary search we')).toBe('Efficiency of binary search');
    expect(tidySpokenTitle('what an algorithm is')).toBe('Algorithm');
  });

  it('needs enough transcript to say anything', () => {
    expect(segmentTranscript(transcript.segments.slice(0, 5))).toEqual([]);
  });

  it('places concepts named without a time where they are first discussed', () => {
    expect(firstMention('binary search', transcript.segments)).toBeGreaterThan(60);
    expect(firstMention('quantum entanglement', transcript.segments)).toBeNull();
  });
});

describe('knowledge map fusion', () => {
  it('official chapters are the backbone', () => {
    const map = buildKnowledgeMap(inputs({ durationSec: 18000, chapters: parseChapters(yt('nextChapters')) }));
    expect(map.backbone).toBe('chapters');
    expect(map.nodes).toHaveLength(20);
    expect(map.nodes[0]).toMatchObject({ title: 'course introduction', startSec: 0, endSec: 210, confidence: 0.98, source: 'chapters' });
  });

  it('description timestamps when there are no chapters; nothing invented before the first one', () => {
    const desc = parseWatchNext(yt('nextDescriptionTimestamps'), 'oAja8-Ulz6o').description;
    const map = buildKnowledgeMap(inputs({ durationSec: 2700, description: desc }));
    expect(map.backbone).toBe('description');
    expect(map.nodes[0].startSec).toBe(980);
    expect(titles(map.nodes)).toHaveLength(5);
  });

  it('viewer comments when neither exists, below chapter-level confidence', () => {
    const map = buildKnowledgeMap(inputs({ durationSec: 2800, comments: commentsOf('commentsLecture') }));
    expect(map.backbone).toBe('comments');
    expect(map.nodes.length).toBeGreaterThanOrEqual(10);
    expect(map.nodes.every((n) => n.confidence < 0.9 && n.source === 'comments')).toBe(true);
  });

  it('an empty map when no source has anything (no chapters, no comments, no transcript)', () => {
    const map = buildKnowledgeMap(inputs({ description: 'Subscribe for more!', comments: [] }));
    expect(map.backbone).toBeNull();
    expect(map.nodes).toEqual([]);
  });

  it('coarse chapters + a viewer outline + the transcript → a hierarchy (real course)', () => {
    const course = local('course-8hly31xKli0');
    const map = buildKnowledgeMap(
      inputs({
        videoId: course.videoId,
        durationSec: 19330,
        chapters: course.chapters.map((c: { title: string; startSec: number }) => ({ ...c, auto: false })),
        description: course.description,
        comments: commentsOf('commentsCourse'),
        transcript: local('transcript-8hly31xKli0'),
      }),
    );
    expect(map.backbone).toBe('chapters');
    expect(titles(map.nodes)).toEqual(['Introduction to Algorithms', 'Introduction to Data Structures', 'Algorithms: Sorting and Searching']);
    expect(titles(map.nodes[0].children)).toEqual(['Playing a Counting Game', 'Time Complexity', 'Algorithms in Code', 'Recursion & Space Complexity']);
    expect(titles(find(map.nodes, 'Playing a Counting Game')!.children)).toContain('Guess the Number');
    // Two viewers agree on this one.
    expect(find(map.nodes, 'Binary Search in Code')!.confidence).toBeGreaterThanOrEqual(0.75);
    // The transcript backs up comment items where it changes topic at the same moment.
    expect(find(map.nodes, 'Guess the Number')!.evidence.some((e) => e.source === 'transcript')).toBe(true);
    // A comment outline never outranks the official chapters.
    expect(map.nodes.every((n) => n.source === 'chapters')).toBe(true);
  });

  it('groups related concepts and merges duplicates', () => {
    const map = buildKnowledgeMap(inputs({ description: `${LINKED_LIST_DESCRIPTION}\n52:12 Reversal` }));
    expect(titles(map.nodes)).toEqual(['Introduction', 'What is a Linked List', 'Node structure', 'Insertion', 'Deletion', 'Searching', 'Reversal']);
    expect(titles(find(map.nodes, 'Insertion')!.children)).toEqual(['Insertion at beginning', 'Insertion at end', 'Insertion in middle']);
    expect(map.nodes.filter((n) => n.title === 'Reversal')).toHaveLength(1);
  });

  it('is cached by signature: same inputs, same signature; new evidence, new signature', () => {
    const base = inputs({ description: LINKED_LIST_DESCRIPTION });
    expect(knowledgeSignature(base)).toBe(knowledgeSignature({ ...base }));
    const withTranscript = { ...base, transcript: { videoId: 'vid', languageCode: 'en', kind: 'asr' as const, segments: [{ startSec: 0, durSec: 3, text: 'hello' }] } };
    expect(knowledgeSignature(withTranscript)).not.toBe(knowledgeSignature(base));
    expect(knowledgeSignature({ ...base, comments: [] })).not.toBe(knowledgeSignature(base));
  });
});

describe('current concept from the playback time', () => {
  const map = buildKnowledgeMap(inputs({ description: LINKED_LIST_DESCRIPTION }));
  const stops = conceptStops(map);

  it('maps a timestamp to the concept, its parents, what came before and what is next', () => {
    const at = locateConcept(stops, 1052); // 17:32
    expect(at.current?.title).toBe('Insertion at beginning');
    expect(titles(at.ancestors)).toEqual(['Insertion']);
    expect(titles(at.previous)).toEqual(['Introduction', 'What is a Linked List', 'Node structure']);
    expect(titles(at.upcoming)[0]).toBe('Insertion at end');
  });

  it('switches exactly at boundaries', () => {
    expect(locateConcept(stops, 1259).current?.title).toBe('Insertion at beginning');
    expect(locateConcept(stops, 1260).current?.title).toBe('Insertion at end');
    expect(locateConcept(stops, 0).current?.title).toBe('Introduction');
    expect(locateConcept(stops, 99_999).current?.title).toBe('Reversal');
  });

  it('knows nothing is being taught yet before the first concept', () => {
    const late = buildKnowledgeMap(inputs({ description: parseWatchNext(yt('nextDescriptionTimestamps'), 'x').description, durationSec: 2700 }));
    const before = locateConcept(conceptStops(late), 100);
    expect(before.current).toBeNull();
    expect(before.upcoming[0].title).toBe('Insert in a Linked List (First & Last)');
  });

  it('is cheap enough to run on every timeupdate', () => {
    const started = performance.now();
    for (let t = 0; t < 3600; t += 0.25) locateConcept(stops, t);
    // 14,400 lookups (an hour at 4 Hz); ~10 µs each even on a busy machine.
    expect(performance.now() - started).toBeLessThan(250);
  });
});
