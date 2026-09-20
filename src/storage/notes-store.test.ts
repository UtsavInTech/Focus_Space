import { beforeEach, describe, expect, it } from 'vitest';
import type { GeneratedNote } from '@/types/notes';
import { deleteNote, listNotes, saveNote } from './notes-store';

/** Minimal chrome.storage.local shim — the same get/set surface src/storage/storage.ts calls. */
function fakeChromeStorage() {
  const data: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in data) out[k] = data[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          Object.assign(data, obj);
        },
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
  return data;
}

const note = (over: Partial<GeneratedNote> = {}): GeneratedNote => ({
  format: 'notes',
  language: 'en',
  videoId: 'v18',
  range: { startSec: 1052, endSec: 1260 },
  markdown: '## Insertion at beginning\n- head pointer is updated',
  mindmap: null,
  conceptIds: ['1052-insertion-at-beginning'],
  contextVersion: 2,
  provenance: {
    space: { id: 'dsa', name: 'DSA' },
    videoTitle: 'Lecture 18',
    channel: 'Apna College',
    playlist: { id: 'PLjava', title: 'Java DSA Complete Series', position: 18, total: 22 },
    topic: 'Linked Lists',
    scope: 'current-section',
    sources: ['description'],
    hasTranscript: true,
    generatedAt: 1_700_000_000_000,
  },
  ...over,
});

beforeEach(() => {
  fakeChromeStorage();
});

describe('SavedNote persistence (WS3-owned; wraps WS2\'s GeneratedNote, never regenerates it)', () => {
  it('save → list round-trips, most recent first, with stable ids and timestamps', async () => {
    const a = await saveNote(note({ videoId: 'v18' }));
    const b = await saveNote(note({ videoId: 'v18', markdown: 'second note' }));
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBeGreaterThan(0);
    expect(a.updatedAt).toBe(a.createdAt);

    const list = await listNotes('v18');
    expect(list.map((n) => n.id)).toEqual([b.id, a.id]); // most recent first
  });

  it('exact timestamp/range and provenance survive persistence unchanged', async () => {
    const original = note({ range: { startSec: 4200, endSec: 4530 } });
    const saved = await saveNote(original);
    const [reloaded] = await listNotes('v18');
    expect(reloaded.range).toEqual({ startSec: 4200, endSec: 4530 });
    expect(reloaded.provenance).toEqual(original.provenance);
    expect(reloaded.videoId).toBe('v18');
    expect(reloaded.id).toBe(saved.id);
  });

  it('keeps notes separated per video', async () => {
    await saveNote(note({ videoId: 'v18' }));
    await saveNote(note({ videoId: 'v19' }));
    expect(await listNotes('v18')).toHaveLength(1);
    expect(await listNotes('v19')).toHaveLength(1);
    expect(await listNotes('v-unknown')).toEqual([]);
  });

  it('delete removes exactly the targeted note and nothing else', async () => {
    const a = await saveNote(note({ videoId: 'v18' }));
    const b = await saveNote(note({ videoId: 'v18' }));
    await deleteNote('v18', a.id);
    const remaining = await listNotes('v18');
    expect(remaining.map((n) => n.id)).toEqual([b.id]);
  });

  it('does not regenerate — listing returns exactly the persisted GeneratedNote content, byte for byte', async () => {
    const original = note({ markdown: '## Exact content\n- must not be regenerated or altered' });
    await saveNote(original);
    const [reloaded] = await listNotes('v18');
    expect(reloaded.markdown).toBe(original.markdown);
    expect(reloaded.conceptIds).toEqual(original.conceptIds);
  });
});
