import { describe, expect, it } from 'vitest';
import type { SavedNote } from '@/types/notes';
import type { ChatSession } from '@/types/chat';
import { groupBySpace, NO_SPACE, spaceOf } from './grouping';

const note = (id: string, space: { id: string; name: string } | null): SavedNote =>
  ({
    id,
    videoId: 'v',
    format: 'notes',
    language: 'en',
    range: null,
    markdown: 'x',
    mindmap: null,
    conceptIds: [],
    contextVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    provenance: { videoTitle: 'Lecture', channel: 'Channel', space, playlist: null, topic: null, scope: 'full-video', sources: [], hasTranscript: true, generatedAt: 1 },
  }) as SavedNote;

const chat = (id: string, modeId: string): ChatSession => ({ id, videoId: 'v', modeId, messages: [], createdAt: 1, updatedAt: 1 });

const SPACES = [
  { id: 'dsa', name: 'DSA' },
  { id: 'sql', name: 'SQL' },
];

describe('the Library files work under its Space', () => {
  it('a note keeps the Space it was made in', () => {
    expect(spaceOf(note('n1', { id: 'sql', name: 'SQL' }), SPACES)).toEqual({ id: 'sql', name: 'SQL' });
  });

  it('a chat is named from the Space it happened in', () => {
    expect(spaceOf(chat('c1', 'dsa'), SPACES)).toEqual({ id: 'dsa', name: 'DSA' });
  });

  it('a Space deleted since keeps the work, under a name that says so', () => {
    expect(spaceOf(chat('c1', 'gone'), SPACES).name).toBe(NO_SPACE.name);
    expect(spaceOf(note('n1', null), SPACES)).toEqual(NO_SPACE);
  });

  it('groups by Space, busiest first, with unfiled work last', () => {
    const groups = groupBySpace([note('a', { id: 'sql', name: 'SQL' }), note('b', null), note('c', { id: 'dsa', name: 'DSA' }), note('d', { id: 'dsa', name: 'DSA' })], SPACES);
    expect(groups.map((g) => [g.space.name, g.items.length])).toEqual([
      ['DSA', 2],
      ['SQL', 1],
      [NO_SPACE.name, 1],
    ]);
  });

  it('keeps the order it was given inside a group — newest first, as the Library lists them', () => {
    const [group] = groupBySpace([note('new', { id: 'dsa', name: 'DSA' }), note('old', { id: 'dsa', name: 'DSA' })], SPACES);
    expect(group.items.map((n) => n.id)).toEqual(['new', 'old']);
  });

  it('notes and chats of one Space land together', () => {
    const groups = groupBySpace<SavedNote | ChatSession>([note('n', { id: 'dsa', name: 'DSA' }), chat('c', 'dsa')], SPACES);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(['n', 'c']);
  });
});
