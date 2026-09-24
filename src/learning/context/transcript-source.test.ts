import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import type { TranscriptSegment } from '@/learning/knowledge/types';
import { buildLearningContext } from './context';
import { buildPrompt } from '@/learning/ai/actions';

/**
 * Auto-generated captions are a genuine source and a lossy one, and the model has to be told which it
 * is reading — speech recognition turns "hnRNA" into "H. N. R. N. A." and "Dijkstra" into "Dexter", and
 * an assistant that treats those as what the instructor said will confidently explain the wrong thing.
 */

const dsa = DEFAULT_MODES.find((m) => m.id === 'dsa')!;
const transcript: TranscriptSegment[] = [
  { startSec: 0, durSec: 5, text: 'Today we look at linked lists.' },
  { startSec: 5, durSec: 5, text: 'A node holds a value and a pointer.' },
];

const contextAt = (source: 'manual' | 'asr' | null | undefined, segments: TranscriptSegment[] | null = transcript) =>
  buildLearningContext({ video: { id: 'v1', title: 'Lecture', channelTitle: 'x' }, mode: dsa, topicId: null, path: null, map: null, transcript: segments, transcriptSource: source, currentTime: 6 });

describe('transcript provenance', () => {
  it('records that a window came from speech recognition', () => {
    expect(contextAt('asr').transcriptSource).toBe('asr');
  });

  it('assumes uploaded captions when the caller does not say', () => {
    // The safer default: never imply words are machine-transcribed when we do not know that they are.
    expect(contextAt(undefined).transcriptSource).toBe('manual');
    expect(contextAt(null).transcriptSource).toBe('manual');
  });

  it('is null when there is no transcript window at all', () => {
    const ctx = contextAt('asr', null);
    expect(ctx.transcriptWindow).toBeNull();
    expect(ctx.transcriptSource).toBeNull();
  });

  it('warns the model in the prompt, but only for auto-generated captions', () => {
    const auto = buildPrompt('explain', contextAt('asr'));
    expect(auto.user).toContain('Auto-generated captions');
    expect(auto.user).toMatch(/misheard/i);

    const uploaded = buildPrompt('explain', contextAt('manual'));
    expect(uploaded.user).not.toContain('Auto-generated captions');
    expect(uploaded.user).toContain('Transcript');
  });

  it('still carries the words themselves either way', () => {
    for (const source of ['asr', 'manual'] as const) {
      expect(buildPrompt('explain', contextAt(source)).user).toContain('A node holds a value and a pointer.');
    }
  });

  it('says so plainly when there is nothing to read', () => {
    expect(buildPrompt('explain', contextAt(null, null)).user).toContain('Transcript: not available for this moment');
  });
});
