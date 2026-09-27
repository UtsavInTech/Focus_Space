import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '../knowledge/types';
import {
  buildOutlinePrompt,
  condenseForOutline,
  condenseTranscript,
  LONG_SOURCE_MAX_CHARS,
  MAX_LONG_SECTIONS,
  longGaps,
  mergeOutlineParts,
  outlineBlock,
  outlineParts,
  outlineSource,
  OUTLINE_SOURCE_MAX_CHARS,
  parseOutline,
  partBudget,
  segmentsInPart,
  spliceGap,
  transcriptKey,
} from './outline';

const lecture: TranscriptSegment[] = Array.from({ length: 360 }, (_, i) => ({ startSec: i * 10, durSec: 10, text: `line ${i} about arrays and binary search` }));

describe('outline source', () => {
  it('stamps the transcript every ~30 seconds so the model can place topics in time', () => {
    const source = outlineSource(lecture);
    expect(source.split('\n')[0]).toMatch(/^\[0:00\] line 0/);
    expect(source).toContain('[0:30] line 3');
    expect(source).toContain('[59:30]');
  });

  it('trims every line evenly when a lecture is over budget, so the end is still covered', () => {
    const source = outlineSource(lecture, 3000);
    expect(source.length).toBeLessThanOrEqual(3000);
    expect(source).toContain('[0:00]');
    // Evenly spaced lines survive, the last of them within the final few minutes.
    const last = source.split('\n').at(-1)!;
    expect(Number(last.match(/^\[(\d+):/)![1])).toBeGreaterThanOrEqual(55);
  });
});

describe('outline prompt', () => {
  it('asks for English titles from any transcript language, and passes the creator chapters as hints', () => {
    const prompt = buildOutlinePrompt({ videoId: 'abcdefghijk', title: 'Binary Search', channel: 'Apna College', durationSec: 3600, hints: [{ startSec: 600, title: 'Lower bound' }] }, 'x');
    expect(prompt.system).toMatch(/Hindi/);
    expect(prompt.system).toMatch(/in English/);
    expect(prompt.user).toContain('10:00 Lower bound');
    expect(prompt.user).toContain('about 15 consecutive sections');
  });
});

describe('parseOutline', () => {
  it('reads the requested format and ends each section where the next begins', () => {
    const sections = parseOutline(['0:00 | Introduction | What the lecture covers', '4:12 | Linear search | Scanning every element', '1:02:05 | Binary search | Halving a sorted array'].join('\n'), 4000);
    expect(sections).toEqual([
      { startSec: 0, endSec: 252, title: 'Introduction', summary: 'What the lecture covers' },
      { startSec: 252, endSec: 3725, title: 'Linear search', summary: 'Scanning every element' },
      { startSec: 3725, endSec: 4000, title: 'Binary search', summary: 'Halving a sorted array' },
    ]);
  });

  it('tolerates list markers, dashes and chatter, and sorts what the model put out of order', () => {
    const sections = parseOutline(['Here is the outline:', '2. 12:40 – Pointers | moving the head', '1. 0:20 - Setup | nodes', '- 30:00 | Deletion'].join('\n'), null)!;
    expect(sections.map((s) => [s.startSec, s.title])).toEqual([
      [0, 'Setup'],
      [760, 'Pointers'],
      [1800, 'Deletion'],
    ]);
  });

  it('drops times past the end of the video and refuses something that is not an outline', () => {
    expect(parseOutline('0:00 | A\n90:00 | Beyond the end', 600)).toBeNull();
    expect(parseOutline('This video is about arrays.', 600)).toBeNull();
  });
});

describe('outline block', () => {
  it('marks where the learner is', () => {
    const block = outlineBlock(
      [
        { startSec: 0, endSec: 300, title: 'Intro', summary: '' },
        { startSec: 300, endSec: 900, title: 'Binary search', summary: 'Halving' },
      ],
      400,
    );
    expect(block).toContain('5:00–15:00 Binary search, Halving  ← learner is here');
    expect(block).not.toMatch(/Intro.*learner is here/);
  });
});

describe('transcript key', () => {
  it('is stable for the same captions and changes with any edit', async () => {
    const a = await transcriptKey(lecture);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await transcriptKey(lecture.map((s) => ({ ...s })))).toBe(a);
    expect(await transcriptKey([...lecture.slice(0, -1), { ...lecture[lecture.length - 1], text: 'changed' }])).not.toBe(a);
  });
});

describe('condenseTranscript', () => {
  // The lecture from the bug report: 30 hours of auto-captions, a phrase every 3 seconds (~1.9M characters).
  const thirtyHours: TranscriptSegment[] = Array.from({ length: 36_000 }, (_, i) => ({ startSec: i * 3, durSec: 3, text: `phrase ${i} about langchain vector databases and prompt templates here` }));

  it('fits a 30-hour lecture into one request, covering it to the end', () => {
    const condensed = condenseTranscript(thirtyHours);
    expect(outlineSource(condensed).length).toBeLessThanOrEqual(OUTLINE_SOURCE_MAX_CHARS);
    expect(condensed[0].startSec).toBe(0);
    expect(condensed[condensed.length - 1].startSec).toBeGreaterThan(29 * 3600);
  });

  it('is deterministic and stable, so every viewer sends the same data and hits the same stored outline', async () => {
    const once = condenseTranscript(thirtyHours);
    expect(condenseTranscript(thirtyHours.map((s) => ({ ...s })))).toEqual(once);
    expect(condenseTranscript(once)).toEqual(once);
    expect(await transcriptKey(condenseTranscript(once))).toBe(await transcriptKey(once));
  });

  it('keeps a short lecture whole, merged into ~30-second lines', () => {
    const condensed = condenseTranscript(lecture);
    expect(condensed).toHaveLength(120);
    expect(condensed[1]).toEqual({ startSec: 30, durSec: 30, text: 'line 3 about arrays and binary search line 4 about arrays and binary search line 5 about arrays and binary search' });
  });
});

describe('long videos are outlined in parts', () => {
  const hours = (h: number, every = 3, text = (i: number) => `phrase ${i} about arrays graphs and dynamic programming here`): TranscriptSegment[] =>
    Array.from({ length: (h * 3600) / every }, (_, i) => ({ startSec: i * every, durSec: every, text: text(i) }));

  it('changes nothing up to three hours: the same captions upload as before, so stored outlines still match', async () => {
    for (const video of [lecture, hours(1), hours(3)]) {
      expect(outlineParts(video)).toBeNull();
      expect(condenseForOutline(video)).toEqual(condenseTranscript(video));
      expect(await transcriptKey(condenseForOutline(video))).toBe(await transcriptKey(condenseTranscript(video)));
    }
  });

  it('cuts equal ~1-hour parts, with no stub at the end', () => {
    const twelve = outlineParts(hours(12))!;
    expect(twelve).toHaveLength(12);
    expect(twelve[0]).toEqual({ startSec: 0, endSec: 3600 });
    expect(twelve[11].endSec).toBe(12 * 3600);
    // The 5h22m course this was tuned on: five parts of ~1:04, not five hours and a 22-minute stub.
    const course = outlineParts(hours(5 + 22 / 60))!;
    expect(course).toHaveLength(5);
    expect(new Set(course.map((p) => Math.round((p.endSec - p.startSec) / 60))).size).toBeLessThanOrEqual(2);
    expect(outlineParts(hours(30))).toHaveLength(30);
  });

  it('reads every part of a 12-hour video instead of a thin sample, within the upload budget', () => {
    const video = hours(12);
    const condensed = condenseForOutline(video);
    const parts = outlineParts(video)!;
    for (const [i, part] of parts.entries()) {
      const own = segmentsInPart(condensed, part, i === parts.length - 1);
      expect(own.length).toBeGreaterThan(100);
      expect(outlineSource(own).length).toBeLessThanOrEqual(partBudget(parts.length));
    }
    // Several times what one 90k request used to read of the same video.
    const chars = (segs: TranscriptSegment[]) => segs.reduce((n, seg) => n + seg.text.length, 0);
    expect(chars(condensed)).toBeGreaterThan(4 * chars(condenseTranscript(video)));
  });

  it('fits the API body limit even for 30 hours of Hindi captions', () => {
    const hindi = hours(30, 3, (i) => `अब हम ग्राफ और डायनामिक प्रोग्रामिंग को समझते हैं वाक्य ${i}`);
    const condensed = condenseForOutline(hindi);
    const body = JSON.stringify({ videoId: 'abcdefghijk', title: 'x', channel: 'y', durationSec: 108000, hints: [], segments: condensed });
    expect(new TextEncoder().encode(body).length).toBeLessThan(2 * 1024 * 1024);
    expect(condensed.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(LONG_SOURCE_MAX_CHARS + condensed.length * 12);
  });

  it('is deterministic, so every viewer of a long video uploads the same captions', async () => {
    const video = hours(12);
    expect(await transcriptKey(condenseForOutline(video.map((s) => ({ ...s }))))).toBe(await transcriptKey(condenseForOutline(video)));
  });

  it('tells the model which part it is reading, with only that part’s chapter markers', () => {
    const request = { videoId: 'abcdefghijk', title: 'DSA Marathon', channel: 'C', durationSec: 12 * 3600, hints: [{ startSec: 600, title: 'Arrays' }, { startSec: 8000, title: 'Graphs' }] };
    const { user } = buildOutlinePrompt(request, 'x', { startSec: 7200, endSec: 14400, index: 1, count: 6, maxSections: 30 });
    expect(user).toContain('part 2 of 6 of a long video: 2:00:00 to 4:00:00');
    expect(user).toContain('2:13:20 Graphs');
    expect(user).not.toContain('Arrays');
    expect(user).toContain('into about 30 consecutive sections');
    // What went wrong on the real course: topics placed where they were previewed, and the part's tail dropped.
    expect(user).toContain('not where it is first previewed or mentioned');
    expect(user).toContain('Cover the part all the way to 4:00:00');
    expect(buildOutlinePrompt(request, 'x', { startSec: 7200, endSec: 9000, maxSections: 10 }).user).toContain('one stretch of a long video: 2:00:00 to 2:30:00');
    // Without a part, the prompt is the one every short video has always had.
    expect(buildOutlinePrompt(request, 'x').user).not.toContain('part ');
  });

  it('merges parts: drops sections outside their part, joins a topic split by a boundary, and chains the ends', () => {
    const merged = mergeOutlineParts(
      [
        { part: { startSec: 7200, endSec: 14400 }, sections: [{ startSec: 5000, endSec: 7200, title: 'Restated from part one', summary: '' }, { startSec: 7200, endSec: 9000, title: 'Heap sort', summary: '' }, { startSec: 9000, endSec: 14400, title: 'Graphs', summary: '' }] },
        { part: { startSec: 0, endSec: 7200 }, sections: [{ startSec: 0, endSec: 3000, title: 'Arrays', summary: '' }, { startSec: 3000, endSec: 7200, title: 'Heap sort', summary: '' }] },
      ],
      14400,
    )!;
    expect(merged.map((s) => s.title)).toEqual(['Arrays', 'Heap sort', 'Graphs']);
    expect(merged.map((s) => [s.startSec, s.endSec])).toEqual([[0, 3000], [3000, 9000], [9000, 14400]]);
  });

  it('caps a 30-hour outline with an even spread, not just its first hours', () => {
    const parts = Array.from({ length: 15 }, (_, p) => ({
      part: { startSec: p * 7200, endSec: (p + 1) * 7200 },
      sections: Array.from({ length: 30 }, (_, i) => ({ startSec: p * 7200 + i * 240, endSec: p * 7200 + (i + 1) * 240, title: `Topic ${p}-${i}`, summary: '' })),
    }));
    const merged = mergeOutlineParts(parts, 108000)!;
    expect(merged).toHaveLength(MAX_LONG_SECTIONS);
    expect(merged[merged.length - 1].startSec).toBeGreaterThan(29 * 3600);
  });

  it('keeps a long outline in the chat prompt around the learner instead of cutting off its later hours', () => {
    const sections = Array.from({ length: 180 }, (_, i) => ({ startSec: i * 240, endSec: (i + 1) * 240, title: `Topic number ${i} of the marathon`, summary: 'One sentence on what is taught in this part of the lecture.' }));
    const late = outlineBlock(sections, 170 * 240 + 10);
    expect(late.length).toBeLessThanOrEqual(4700);
    expect(late).toContain('Topic number 170 of the marathon');
    expect(late).toContain('topics, the rest omitted for length');
    const early = outlineBlock(sections, 10);
    expect(early).toContain('Topic number 0 of the marathon');
    expect(early).not.toContain('Topic number 170 of the marathon');
  });
});

describe('repairing stretches a long outline skipped', () => {
  const section = (startSec: number, endSec: number, title: string) => ({ startSec, endSec, title, summary: '' });
  // The shape of the real 5h22m outline: short sections, then one that swallowed the last hour.
  const outline = [section(0, 180, 'A'), section(180, 360, 'B'), section(360, 540, 'C'), section(540, 700, 'D'), section(700, 4300, 'Summary and conclusion')];

  it('finds a section far longer than the rest', () => {
    expect(longGaps(outline)).toEqual([{ startSec: 700, endSec: 4300 }]);
    expect(longGaps(outline.slice(0, 4))).toEqual([]);
    // Uniformly long sections are a coarse outline, not a skipped stretch.
    expect(longGaps([section(0, 1500, 'A'), section(1500, 3000, 'B'), section(3000, 4500, 'C')])).toEqual([]);
  });

  it('splices the redone stretch in, keeping everything around it', () => {
    const redone = [section(650, 1200, 'Before the gap'), section(1300, 2500, 'Quicksort'), section(2500, 4300, 'Binary search'), section(5000, 5100, 'Past the gap')];
    const fixed = spliceGap(outline, { startSec: 700, endSec: 4300 }, redone);
    expect(fixed.map((s) => [s.startSec, s.endSec, s.title])).toEqual([
      [0, 180, 'A'],
      [180, 360, 'B'],
      [360, 540, 'C'],
      [540, 700, 'D'],
      [700, 2500, 'Quicksort'],
      [2500, 4300, 'Binary search'],
    ]);
  });

  it('keeps the original when the redo is unusable', () => {
    expect(spliceGap(outline, { startSec: 700, endSec: 4300 }, null)).toBe(outline);
    expect(spliceGap(outline, { startSec: 700, endSec: 4300 }, [section(800, 4300, 'Only one')])).toBe(outline);
  });
});

describe('times the model miswrites in a part of a long video', () => {
  it('re-reads an hourless time inside its part — the lines the 5h22m course actually got back', () => {
    // Part 4 of 5 (3:13:17–4:17:43) came back as "9:25", "12:40"… — the hour dropped.
    const part = { startSec: 11597, endSec: 15463 };
    const sections = parseOutline(['9:25 | Merge sort on linked lists | x', '12:40 | Split | y', '4:15:00 | Written in full | z'].join('\n'), part.endSec, part)!;
    expect(sections.map((s) => s.startSec)).toEqual([4 * 3600 + 565, 4 * 3600 + 760, 4 * 3600 + 900]);
  });

  it('reads "02:41" as 2:41:00 when that is the reading inside the stretch', () => {
    const gap = { startSec: 9687, endSec: 10954 };
    const sections = parseOutline(['02:41 | Creating a linked list | x', '02:50 | Searching a node | y'].join('\n'), gap.endSec, gap)!;
    expect(sections.map((s) => s.startSec)).toEqual([9660, 10200]);
  });

  it('skips a line no reading puts inside the part, and leaves whole-video parsing untouched', () => {
    const part = { startSec: 7200, endSec: 10800 };
    expect(parseOutline(['75:00 | Nowhere near | x', '2:10:00 | Real | y', '2:20:00 | Real too | z'].join('\n'), part.endSec, part)!.map((s) => s.title)).toEqual(['Real', 'Real too']);
    expect(parseOutline('9:25 | A\n12:40 | B', 3600)!.map((s) => s.startSec)).toEqual([565, 760]);
  });

  it('asks for hours in the time format once a part runs past the first hour', () => {
    const request = { videoId: 'abcdefghijk', title: 'x', channel: '', durationSec: 5 * 3600, hints: [] };
    expect(buildOutlinePrompt(request, 'x', { startSec: 3600, endSec: 7200, index: 1, count: 5, maxSections: 15 }).user).toContain('hours included (2:41:27, not 41:27)');
    expect(buildOutlinePrompt(request, 'x', { startSec: 0, endSec: 3600, index: 0, count: 5, maxSections: 15 }).user).toMatch(/\nmm:ss \| Section title/);
    expect(buildOutlinePrompt({ ...request, durationSec: 1800 }, 'x').user).toMatch(/\nmm:ss \| Section title/);
  });
});
