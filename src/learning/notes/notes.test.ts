import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import type { NoteFormat, NoteLanguage } from '@/types/notes';
import { rangeBudget, transcriptWindow } from '../context/context';
import { buildKnowledgeMap } from '../knowledge/fuse';
import { conceptStops } from '../knowledge/locate';
import type { TranscriptSegment } from '../knowledge/types';
import { buildLearningPath } from '../path/path';
import { buildNoteRequest, generateNote, type NoteRequestInputs } from './generator';
import { auditNote } from './review';
import { termCoverage } from './language';

// Same fixture shape as src/learning/ai/ai.test.ts — reusing buildKnowledgeMap
// and buildLearningPath rather than a second way of constructing a map/path.
const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const map = buildKnowledgeMap({
  videoId: 'v18',
  durationSec: 3600,
  chapters: [],
  description: ['0:00 Introduction', '4:12 What is a Linked List', '12:40 Node structure', '17:32 Insertion at beginning', '21:00 Insertion at end', '25:10 Insertion in middle', '29:15 Deletion', '52:10 Reversal'].join('\n'),
  comments: null,
  transcript: null,
  now: 0,
});
const path = buildLearningPath(
  { id: 'PLjava', title: 'Java DSA Complete Series', kind: 'playlist', items: Array.from({ length: 22 }, (_, i) => ({ videoId: `v${i + 1}`, title: `Lecture ${i + 1}`, index: i + 1 })) },
  'playlist',
  'v18',
  new Map([['v17', 1]]),
);
/** A 3-hour transcript: a sentence every 5 seconds, so early and late content are distinguishable. */
const transcript: TranscriptSegment[] = Array.from({ length: 2160 }, (_, i) => ({ startSec: i * 5, durSec: 5, text: `Sentence ${i} about linked lists and pointers.` }));

const titleOf = (title: string) => conceptStops(map).find((s) => s.node.title === title)!.node.id;

function inputs(over: Partial<NoteRequestInputs>): NoteRequestInputs {
  return {
    video: { id: 'v18', title: 'Lecture 18 — Linked List', channelTitle: 'Apna College' },
    mode: dsa,
    topicId: 'linked-lists',
    path,
    map,
    transcript,
    currentTime: 1052,
    durationSec: 3600,
    scope: { kind: 'current-section' },
    format: 'notes',
    language: 'en',
    ...over,
  };
}

function mockComplete(replies: string[] | string) {
  const calls: { system: string; user: string }[] = [];
  const list = Array.isArray(replies) ? replies : [replies];
  const complete = async (prompt: { system: string; user: string }) => {
    calls.push(prompt);
    return list[Math.min(calls.length - 1, list.length - 1)];
  };
  return { complete, calls };
}

const REAL_NOTE = `## Insertion at beginning
- A new node's next pointer is set to the current head.
- The head pointer is then updated to the new node.
- This is O(1) because no traversal is needed.`;

describe('grounding: conceptIds always resolve to real Knowledge Map nodes', () => {
  it('every conceptId in a generated note exists in the source map, within the requested range', async () => {
    const { complete } = mockComplete(REAL_NOTE);
    const result = await generateNote(inputs({ scope: { kind: 'range', range: { startSec: 760, endSec: 1800 } } }), complete);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validIds = new Set(conceptStops(map).map((s) => s.node.id));
    expect(result.note.conceptIds.length).toBeGreaterThan(0);
    for (const id of result.note.conceptIds) expect(validIds.has(id)).toBe(true);
  });

  it('carries provenance: video, channel, playlist, topic, scope, sources, transcript availability', async () => {
    const { complete } = mockComplete(REAL_NOTE);
    const result = await generateNote(inputs({}), complete);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.provenance).toMatchObject({
      videoTitle: 'Lecture 18 — Linked List',
      channel: 'Apna College',
      playlist: { title: 'Java DSA Complete Series', position: 18, total: 22 },
      topic: dsa.topics.find((t) => t.id === 'linked-lists')!.name,
      scope: 'current-section',
      hasTranscript: true,
    });
    expect(result.note.provenance.sources.length).toBeGreaterThan(0);
    expect(result.note.provenance.generatedAt).toBeGreaterThan(0);
  });
});

describe('scopes', () => {
  it('current section: resolves to exactly the concept containing the current time', async () => {
    const request = buildNoteRequest(inputs({ currentTime: 1052, scope: { kind: 'current-section' } }));
    expect(request.scopeKind).toBe('current-section');
    expect(request.context.range).toEqual({ startSec: 1052, endSec: 1260 }); // 17:32 → 21:00 (next sibling)
    // "Insertion" (the synthetic group parent, fuse.ts groups the three "Insertion at …" siblings) starts at the same
    // second as its first child, so it legitimately overlaps too — both, not just the leaf.
    expect(request.grounding.conceptIds).toEqual([titleOf('Insertion'), titleOf('Insertion at beginning')]);
  });

  it('selected timestamp range: grounds only concepts overlapping the given range', async () => {
    const request = buildNoteRequest(inputs({ scope: { kind: 'range', range: { startSec: 760, endSec: 1700 } } })); // Node structure .. Insertion in middle, before Deletion starts at 1755
    expect(request.context.range).toEqual({ startSec: 760, endSec: 1700 });
    expect(request.grounding.conceptTitles).toEqual(['Node structure', 'Insertion', 'Insertion at beginning', 'Insertion at end', 'Insertion in middle']);
    expect(request.grounding.conceptTitles).not.toContain('Deletion');
  });

  it('watched-so-far: grounds 0 → currentTime, excluding what has not played yet', async () => {
    const request = buildNoteRequest(inputs({ currentTime: 1300, scope: { kind: 'watched-so-far' } }));
    expect(request.context.range).toEqual({ startSec: 0, endSec: 1300 });
    expect(request.grounding.conceptTitles).not.toContain('Deletion');
    expect(request.grounding.conceptTitles).not.toContain('Reversal');
    expect(request.grounding.conceptTitles).toContain('Insertion at end');
  });

  it('complete video: grounds the whole duration, and the saved note has range: null (whole-video contract semantics)', async () => {
    const { complete } = mockComplete(REAL_NOTE);
    const request = buildNoteRequest(inputs({ scope: { kind: 'full-video' } }));
    expect(request.context.range).toEqual({ startSec: 0, endSec: 3600 });
    expect(request.grounding.conceptTitles).toContain('Reversal');
    const result = await generateNote(inputs({ scope: { kind: 'full-video' } }), complete);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note.range).toBeNull();
  });

  it('"Full video" without a known length is honestly a watched-so-far note — never labelled the entire video', async () => {
    const { complete } = mockComplete(REAL_NOTE);
    for (const durationSec of [null, 0]) {
      const result = await generateNote(inputs({ scope: { kind: 'full-video' }, durationSec, currentTime: 1100 }), complete);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.note.provenance.scope).toBe('watched-so-far');
      expect(result.note.range).toEqual({ startSec: 0, endSec: 1100 });
    }
  });

  it('revision: defaults to watched-so-far and asks for a concise recap', async () => {
    const request = buildNoteRequest(inputs({ currentTime: 900, scope: { kind: 'revision' } }));
    expect(request.context.range).toEqual({ startSec: 0, endSec: 900 });
    expect(request.prompt.user).toMatch(/revision|concise|minimal elaboration/i);
    const { complete } = mockComplete(REAL_NOTE);
    const result = await generateNote(inputs({ currentTime: 900, scope: { kind: 'revision' } }), complete);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note.provenance.scope).toBe('revision');
  });
});

describe('language', () => {
  it.each<NoteLanguage>(['en', 'hi', 'hinglish'])('%s instructs the model correctly and is stamped on the note', async (language) => {
    const { complete } = mockComplete(REAL_NOTE);
    const request = buildNoteRequest(inputs({ language }));
    if (language === 'en') expect(request.prompt.user).toContain('Write the notes in English.');
    if (language === 'hi') expect(request.prompt.user).toMatch(/Hindi \(Devanagari/);
    if (language === 'hinglish') expect(request.prompt.user).toMatch(/Hinglish/);
    const result = await generateNote(inputs({ language }), complete);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note.language).toBe(language);
  });

  it('asks the model to keep the concept-title technical terms exactly as written, and the request carries them', () => {
    const request = buildNoteRequest(inputs({ language: 'hi', scope: { kind: 'current-section' } }));
    expect(request.terms).toContain('Insertion at beginning');
    expect(request.prompt.user).toContain('Keep these terms exactly as written');
    expect(request.prompt.user).toContain('Insertion at beginning');
  });

  it('technical terms are checked for literal preservation in generated (Hindi) output', async () => {
    const request = buildNoteRequest(inputs({ language: 'hi', scope: { kind: 'current-section' } }));
    expect(request.terms).toEqual(expect.arrayContaining(['Insertion', 'Insertion at beginning', 'Linked Lists']));
    const hindiWithTerms = 'यह भाग समझाता है कि Insertion at beginning और Insertion कैसे काम करते हैं, जो कि Linked Lists का हिस्सा है। Head pointer को नए node की तरफ अपडेट किया जाता है।';
    const { complete } = mockComplete(hindiWithTerms);
    const coverage = termCoverage(hindiWithTerms, request.terms);
    expect(coverage.missing).toEqual([]);
    expect(coverage.present).toEqual(request.terms);

    // Negative control: a translated/garbled term is detected as missing.
    const badCoverage = termCoverage('यह भाग समझाता है इन्सर्शन के बारे में।', request.terms);
    expect(badCoverage.missing.length).toBeGreaterThan(0);
    void complete;
  });
});

describe('no fabrication when evidence is missing', () => {
  it('refuses to call the provider at all when there is no evidence whatsoever', async () => {
    const { complete, calls } = mockComplete('anything');
    const result = await generateNote(inputs({ map: null, transcript: null, path: null, topicId: null, currentTime: 500, scope: { kind: 'range', range: { startSec: 500, endSec: 600 } } }), complete);
    expect(result).toMatchObject({ ok: false, code: 'no-evidence' });
    expect(calls).toHaveLength(0);
  });

  it('when only chapter/description structure exists (no transcript), the prompt says so honestly instead of pretending', () => {
    const request = buildNoteRequest(inputs({ transcript: null, scope: { kind: 'current-section' } }));
    expect(request.grounding.hasTranscript).toBe(false);
    expect(request.grounding.hasStructure).toBe(true);
    expect(request.prompt.user).toMatch(/no transcript is available/i);
    expect(request.prompt.user).toMatch(/do not invent/i);
  });

  it('an empty provider reply is reported, not silently accepted as a note', async () => {
    const { complete } = mockComplete('   ');
    const result = await generateNote(inputs({}), complete);
    expect(result).toMatchObject({ ok: false, code: 'empty' });
  });
});

describe('Knowledge Map metadata is context, not content (docs/V5_CONTRACT.md content-quality rule)', () => {
  it('flags a note that just restates position/chapters/navigation', () => {
    const metadataOnly = ['Video #18 of 22', 'Chapter 3: Insertion', 'Next video: Lecture 19', 'Course: Java DSA Complete Series'].join('\n');
    const issues = auditNote(metadataOnly, ['Insertion at beginning']);
    expect(issues.map((i) => i.code)).toContain('metadata-only');
  });

  it('does not flag a note that actually explains the concept', () => {
    const issues = auditNote(REAL_NOTE, ['Insertion at beginning']);
    expect(issues.map((i) => i.code)).not.toContain('metadata-only');
  });

  it('the prompt itself tells the model chapter/course info is context, never the notes', () => {
    const request = buildNoteRequest(inputs({}));
    expect(request.prompt.system).toMatch(/context only/i);
    expect(request.prompt.user).toMatch(/do not write notes about this list itself/i);
  });
});

describe('instructor emphasis is offered, comparative claims are not', () => {
  it('the prompt offers "Instructor emphasis" / "Notable explanation" / "Useful intuition" as labels', () => {
    const request = buildNoteRequest(inputs({}));
    expect(request.prompt.system).toContain('Instructor emphasis:');
    expect(request.prompt.system).toContain('Notable explanation:');
    expect(request.prompt.system).toContain('Useful intuition:');
    expect(request.prompt.system).toMatch(/never claim other teachers do not cover it/i);
  });

  it('flags an unsupported "only teacher who..." claim', () => {
    const overclaim = `## Insertion\nThis is the only teacher who explains insertion this way. Nobody else teaches recursion like this.`;
    const issues = auditNote(overclaim, ['Insertion']);
    expect(issues.map((i) => i.code)).toContain('comparative-claim');
  });

  it('does not flag a legitimate "Instructor emphasis" label with no comparison', () => {
    const fine = `Instructor emphasis: the professor stresses that the head pointer must be updated before the old head is lost.`;
    expect(auditNote(fine, ['head pointer']).map((i) => i.code)).not.toContain('comparative-claim');
  });
});

describe('long video / range handling and context limits', () => {
  it('a range too long to fit verbatim is sampled across the whole span, not truncated to the start', () => {
    const w = transcriptWindow(transcript, 0, { range: { startSec: 0, endSec: 10800 } })!; // full 3-hour transcript
    expect(w.text.length).toBeLessThan(transcript.map((s) => s.text).join(' ').length);
    expect(w.text.length).toBeLessThanOrEqual(rangeBudget({ startSec: 0, endSec: 10800 }) * 1.05);
    expect(w.text).toContain('Sentence 0 '); // start of the range
    expect(w.text).toContain('[…]'); // non-contiguous — honestly marked as sampled, not pretended continuous
    const numbers = [...w.text.matchAll(/Sentence (\d+) /g)].map((m) => Number(m[1]));
    expect(Math.max(...numbers)).toBeGreaterThan(1900); // reaches well past the opening minutes
  });

  it('a range that fits within budget is kept verbatim (no sampling markers)', () => {
    const w = transcriptWindow(transcript, 0, { range: { startSec: 0, endSec: 60 } })!;
    expect(w.text).not.toContain('[…]');
    expect(w.text).toContain('Sentence 0 ');
    expect(w.text).toContain('Sentence 11 ');
  });

  it('full-video notes on a long course still ground across the whole map, within the character budget', () => {
    const request = buildNoteRequest(inputs({ scope: { kind: 'full-video' }, durationSec: 3600 }));
    expect(request.context.transcriptWindow!.text.length).toBeLessThanOrEqual(rangeBudget({ startSec: 0, endSec: 3600 }) * 1.05);
    expect(request.grounding.conceptTitles).toEqual(expect.arrayContaining(['Introduction', 'Reversal']));
    // The whole prompt must still fit the API's limit on a user message (server/validate.ts).
    expect(request.prompt.user.length).toBeLessThanOrEqual(24_000);
  });

  it('the transcript budget grows with the span — a long lecture is not squeezed into a short one’s budget', () => {
    expect(rangeBudget({ startSec: 0, endSec: 120 })).toBe(6000);
    expect(rangeBudget({ startSec: 0, endSec: 3600 })).toBeGreaterThan(rangeBudget({ startSec: 0, endSec: 600 }));
    expect(rangeBudget({ startSec: 0, endSec: 36_000 })).toBe(16_000);
  });

  it('a long lecture is sampled from more points across it than a short one', () => {
    const sampled = transcriptWindow(transcript, 0, { range: { startSec: 0, endSec: 10800 } })!;
    expect(sampled.text.split('[…]').length).toBeGreaterThan(12);
  });
});

describe('mind maps scale with the evidence', () => {
  it('a whole long lecture asks for a deep map rooted in the video; a section asks for a small one rooted in its concept', () => {
    const whole = buildNoteRequest(inputs({ scope: { kind: 'full-video' }, format: 'mindmap', durationSec: 3600 })).prompt.user;
    expect(whole).toMatch(/single root line: the subject of the whole video/);
    expect(whole).toMatch(/three to four levels deep/);
    const section = buildNoteRequest(inputs({ scope: { kind: 'current-section' }, format: 'mindmap', currentTime: 1100 })).prompt.user;
    expect(section).toMatch(/single root line: the concept this section teaches/);
    expect(section).toMatch(/Two to three levels deep/);
  });

  it('asks for no filler — a thin map is right when the evidence is thin', () => {
    const prompt = buildNoteRequest(inputs({ scope: { kind: 'full-video' }, format: 'mindmap', durationSec: 3600 })).prompt.user;
    expect(prompt).toMatch(/no filler/);
    expect(prompt).toMatch(/If the evidence is thin, a smaller map is the right answer/);
  });

  it('a whole-video map is titled with the video, not the concept playing when it was made', async () => {
    const outline = 'Linked lists\n  Insertion\n  Deletion';
    const result = await generateNote(inputs({ scope: { kind: 'full-video' }, format: 'mindmap', durationSec: 3600, currentTime: 1100 }), async () => outline);
    expect(result.ok && result.note.mindmap?.title).toBe('Linked lists'); // the model's single root is kept
    const multi = await generateNote(inputs({ scope: { kind: 'full-video' }, format: 'mindmap', durationSec: 3600, currentTime: 1100 }), async () => 'Insertion\nDeletion');
    expect(multi.ok && multi.note.mindmap?.title).toBe(inputs({}).video.title);
  });
});

describe('mindmap format', () => {
  const OUTLINE = ['Insertion', '  Insertion at beginning', '  Insertion at end', '  Insertion in middle'].join('\n');

  it('parses the constrained outline into a MindMapNode tree', async () => {
    const { complete } = mockComplete(OUTLINE);
    const result = await generateNote(inputs({ format: 'mindmap' as NoteFormat, scope: { kind: 'range', range: { startSec: 760, endSec: 1800 } } }), complete);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note.markdown).toBeNull();
    expect(result.note.mindmap).toEqual({
      title: 'Insertion',
      children: [{ title: 'Insertion at beginning', children: [] }, { title: 'Insertion at end', children: [] }, { title: 'Insertion in middle', children: [] }],
    });
  });
});
