import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '../knowledge/types';
import { buildOutlinePrompt, condenseTranscript, outlineBlock, outlineSource, OUTLINE_SOURCE_MAX_CHARS, parseOutline, transcriptKey } from './outline';

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
    expect(block).toContain('5:00–15:00 Binary search — Halving  ← learner is here');
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
