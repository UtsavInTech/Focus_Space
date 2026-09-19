import type { NoteLanguage, SavedNote } from '@/types/notes';
import { formatTimestamp } from '../knowledge/timestamps';

/**
 * How a saved note or mind map describes itself to a learner — in the Library and in the watch-page
 * panel alike. Built only from what the note already stores (scope, range, language, provenance); no
 * internal names ("full-video", "en") ever reach the screen.
 *
 *   Entire video · English
 *   Up to 18:20 · Hinglish
 *   18:20–24:45 · English
 *   Revision · 0:00–18:20 · हिंदी
 */

export const LANGUAGE_NAME: Record<NoteLanguage, string> = { en: 'English', hi: 'हिंदी', hinglish: 'Hinglish' };

const span = (start: number, end: number) => `${formatTimestamp(start)}–${formatTimestamp(end)}`;

/** Which part of the video the note covers, in words. */
export function noteCoverage(note: Pick<SavedNote, 'range' | 'provenance'>): string {
  const range = note.range;
  switch (note.provenance.scope) {
    case 'full-video':
      // A full-video note stores no range (docs/V5_CONTRACT.md §E): it covers the whole video.
      return range ? span(range.startSec, range.endSec) : 'Entire video';
    case 'watched-so-far':
      return range ? `Up to ${formatTimestamp(range.endSec)}` : 'Watched so far';
    case 'revision':
      return range ? `Revision · ${span(range.startSec, range.endSec)}` : 'Revision';
    case 'current-section':
    case 'range':
      return range ? span(range.startSec, range.endSec) : 'Part of the video';
  }
}

/** The one-line label: coverage and language. */
export function noteLabel(note: Pick<SavedNote, 'range' | 'provenance' | 'language'>): string {
  return `${noteCoverage(note)} · ${LANGUAGE_NAME[note.language] ?? note.language}`;
}

export const FORMAT_NAME = { notes: 'Notes', mindmap: 'Mind map' } as const;

/** Where the note starts in the video, for "open at…" links: its range start, or the beginning. */
export const noteStartSec = (note: Pick<SavedNote, 'range'>): number => Math.floor(note.range?.startSec ?? 0);

/** Every saved note and mind map, newest first — the Library's list. */
export function allSavedNotes(byVideo: Record<string, SavedNote[]>): SavedNote[] {
  return Object.values(byVideo)
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt);
}
