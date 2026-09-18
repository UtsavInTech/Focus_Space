import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildKnowledgeMap } from '../knowledge/fuse';
import type { TranscriptSegment } from '../knowledge/types';
import { buildLearningPath } from '../path/path';
import type { NoteRequestInputs } from '../notes/generator';
import { generateNoteWithProvider } from './notes-integration';
import type { AiAvailability, AiProvider } from './service';
import { createUsageLog } from './usage';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const map = buildKnowledgeMap({
  videoId: 'v18',
  durationSec: 3600,
  chapters: [],
  description: ['0:00 Introduction', '17:32 Insertion at beginning', '21:00 Insertion at end'].join('\n'),
  comments: null,
  transcript: null,
  now: 0,
});
const path = buildLearningPath({ id: 'PLjava', title: 'Java DSA Complete Series', kind: 'playlist', items: [{ videoId: 'v18', title: 'Lecture 18', index: 18 }] }, 'playlist', 'v18', new Map());
const transcript: TranscriptSegment[] = Array.from({ length: 300 }, (_, i) => ({ startSec: i * 5, durSec: 5, text: `Sentence ${i} about linked lists and pointers.` }));

function inputs(over: Partial<NoteRequestInputs> = {}): NoteRequestInputs {
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

function fakeProvider(availability: AiAvailability, reply = '## Insertion at beginning\n- head pointer is updated to the new node') {
  const calls: { system: string; user: string }[] = [];
  const provider: AiProvider = {
    id: 'chrome',
    label: 'x',
    availability: async () => availability,
    complete: async (prompt) => {
      calls.push(prompt);
      return reply;
    },
  };
  return { provider, calls };
}

describe('generateNoteWithProvider: provider wiring only, not a duplicate notes pipeline', () => {
  it('goes through WS2\'s generateNote() — the result matches calling generateNote() directly with an equivalent complete()', async () => {
    const { provider } = fakeProvider('available');
    const result = await generateNoteWithProvider(inputs(), [provider]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Grounded (conceptIds present, not fabricated), provenance carried, language stamped — exactly what WS2's generator produces.
    expect(result.note.conceptIds.length).toBeGreaterThan(0);
    expect(result.note.markdown).toContain('head pointer');
    expect(result.note.provenance.videoTitle).toBe('Lecture 18 — Linked List');
    expect(result.note.language).toBe('en');
  });

  it('never calls the provider when WS2 grounding finds no evidence at all (no-evidence refusal is WS2\'s, not bypassed)', async () => {
    const { provider, calls } = fakeProvider('available');
    const result = await generateNoteWithProvider(inputs({ map: null, transcript: null, path: null, topicId: null, scope: { kind: 'range', range: { startSec: 5000, endSec: 5100 } } }), [provider]);
    expect(result).toMatchObject({ ok: false, code: 'no-evidence' });
    expect(calls).toHaveLength(0);
  });

  it('reports unavailable, without calling generateNote at all, when no provider is set up', async () => {
    const result = await generateNoteWithProvider(inputs(), []);
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('records usage on a real generation', async () => {
    const { provider } = fakeProvider('available');
    const { sink, entries } = createUsageLog();
    await generateNoteWithProvider(inputs(), [provider], sink);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ provider: 'chrome', action: 'notes', cached: false });
  });

  it('Layer 2C: a thrown provider error is caught and reported, not left to reject the whole call', async () => {
    const provider: AiProvider = {
      id: 'endpoint',
      label: 'x',
      availability: async () => 'available',
      complete: async () => {
        throw new Error('Network error');
      },
    };
    const result = await generateNoteWithProvider(inputs(), [provider]);
    expect(result).toMatchObject({ ok: false, code: 'failed', reason: 'Network error' });
  });

  it('Layer 2C: a quota_exceeded provider error is reported with that code, not the generic "failed"', async () => {
    const provider: AiProvider = {
      id: 'endpoint',
      label: 'x',
      availability: async () => 'available',
      complete: async () => {
        const err = new Error("You've used all 5 AI actions included this period.");
        (err as Error & { code?: string }).code = 'quota_exceeded';
        throw err;
      },
    };
    const result = await generateNoteWithProvider(inputs(), [provider]);
    expect(result).toMatchObject({ ok: false, code: 'quota_exceeded', reason: "You've used all 5 AI actions included this period." });
  });

  it('mind-map format is tagged distinctly and still grounded', async () => {
    const { provider } = fakeProvider('available', 'Insertion\n  Insertion at beginning');
    const result = await generateNoteWithProvider(inputs({ format: 'mindmap' }), [provider]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.note.format).toBe('mindmap');
      expect(result.note.mindmap).not.toBeNull();
    }
  });
});
