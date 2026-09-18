import type { GeneratedNote, SavedNote } from '@/types/notes';
import { NOTES_VERSION } from '@/types/notes';
import { getItem, updateItem } from './storage';

/**
 * Persists WS2's `GeneratedNote` as a `SavedNote` — WS3's job per
 * docs/V5_CONTRACT.md §E ("WS2 never writes to storage"). A saved note keeps
 * `videoId` + `range` from `GeneratedNote` as-is, which is already enough to
 * jump back to the exact source (watch?v=<videoId>&t=<range.startSec>s) — no
 * extra fields invented for that.
 */

function makeId(videoId: string): string {
  return `${videoId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveNote(note: GeneratedNote): Promise<SavedNote> {
  const at = Date.now();
  const saved: SavedNote = { ...note, id: makeId(note.videoId), createdAt: at, updatedAt: at };
  await updateItem('notes', (store) => ({
    version: NOTES_VERSION,
    byVideo: { ...store.byVideo, [note.videoId]: [saved, ...(store.byVideo[note.videoId] ?? [])] },
  }));
  return saved;
}

export async function listNotes(videoId: string): Promise<SavedNote[]> {
  const store = await getItem('notes');
  return store.byVideo[videoId] ?? [];
}

export async function deleteNote(videoId: string, id: string): Promise<void> {
  await updateItem('notes', (store) => {
    const existing = store.byVideo[videoId];
    if (!existing) return store;
    return { version: NOTES_VERSION, byVideo: { ...store.byVideo, [videoId]: existing.filter((n) => n.id !== id) } };
  });
}
