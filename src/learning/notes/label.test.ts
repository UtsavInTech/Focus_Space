import { describe, expect, it } from 'vitest';
import type { SavedNote } from '@/types/notes';
import { allSavedNotes, noteCoverage, noteLabel, noteStartSec } from './label';

const note = (over: Partial<SavedNote> & { scope?: SavedNote['provenance']['scope'] } = {}): SavedNote =>
  ({
    id: over.id ?? 'n',
    videoId: 'v',
    format: 'notes',
    language: over.language ?? 'en',
    range: over.range === undefined ? null : over.range,
    markdown: 'x',
    mindmap: null,
    conceptIds: [],
    contextVersion: 1,
    createdAt: over.createdAt ?? 1,
    updatedAt: 1,
    provenance: { videoTitle: 'Linked Lists', channel: 'Apna College', space: { id: 'dsa', name: 'DSA' }, playlist: null, topic: null, scope: over.scope ?? 'full-video', sources: [], hasTranscript: true, generatedAt: 1 },
  }) as SavedNote;

describe('saved-note labels speak to people, not to the code', () => {
  it('a whole video reads "Entire video"', () => {
    expect(noteLabel(note())).toBe('Entire video · English');
  });

  it('a section reads as its time range', () => {
    expect(noteLabel(note({ scope: 'current-section', range: { startSec: 1100, endSec: 1485 } }))).toBe('18:20–24:45 · English');
  });

  it('watched-so-far says where it stops — never "Entire video"', () => {
    expect(noteLabel(note({ scope: 'watched-so-far', range: { startSec: 0, endSec: 1100 }, language: 'hinglish' }))).toBe('Up to 18:20 · Hinglish');
  });

  it('revision and Hindi', () => {
    expect(noteLabel(note({ scope: 'revision', range: { startSec: 0, endSec: 900 }, language: 'hi' }))).toBe('Revision · 0:00–15:00 · हिंदी');
  });

  it('never leaks an internal name', () => {
    for (const scope of ['full-video', 'watched-so-far', 'current-section', 'range', 'revision'] as const) {
      for (const language of ['en', 'hi', 'hinglish'] as const) {
        const label = noteLabel(note({ scope, language, range: scope === 'full-video' ? null : { startSec: 60, endSec: 120 } }));
        expect(label).not.toMatch(/full-video|watched-so-far|current-section|\ben\b|\bhi\b|\bhinglish\b/);
      }
    }
    expect(noteCoverage(note({ scope: 'current-section', range: null }))).toBe('Part of the video');
  });

  it('opens a note where it starts', () => {
    expect(noteStartSec(note({ scope: 'range', range: { startSec: 75.6, endSec: 90 } }))).toBe(75);
    expect(noteStartSec(note())).toBe(0);
  });

  it('the Library lists every note across videos, newest first', () => {
    const list = allSavedNotes({ a: [note({ id: 'a1', createdAt: 5 }), note({ id: 'a2', createdAt: 1 })], b: [note({ id: 'b1', createdAt: 3 })] });
    expect(list.map((n) => n.id)).toEqual(['a1', 'b1', 'a2']);
  });
});
