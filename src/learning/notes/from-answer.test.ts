import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types/chat';
import { noteLabel } from './label';
import { noteFromAnswer } from './from-answer';

const answer: ChatMessage = { id: 'a2', role: 'assistant', text: 'A linked list is a chain of nodes.', at: 5, videoId: 'v1', currentTime: 1100.7 };
const base = {
  answer,
  question: 'Explain it like I am five',
  video: { id: 'v1', title: 'Linked Lists', channelTitle: 'Apna College' },
  space: { id: 'dsa', name: 'DSA' },
  topic: 'Linked Lists',
  language: 'en' as const,
  hasTranscript: true,
  now: 1_000,
};

describe('keeping an Ask AI answer as a note', () => {
  it('keeps the question with the answer — a reply alone reads like it is about nothing', () => {
    const note = noteFromAnswer(base);
    expect(note.markdown).toContain('Explain it like I am five');
    expect(note.markdown).toContain('A linked list is a chain of nodes.');
  });

  it('files it under the Space and video it came from', () => {
    const note = noteFromAnswer(base);
    expect(note.provenance.space).toEqual({ id: 'dsa', name: 'DSA' });
    expect(note.videoId).toBe('v1');
    expect(note.provenance.topic).toBe('Linked Lists');
  });

  it('is labelled by the moment it was asked about', () => {
    expect(noteLabel(noteFromAnswer(base))).toBe('Asked at 18:20 · English');
  });

  it('an answer with no question before it is still worth keeping', () => {
    const note = noteFromAnswer({ ...base, question: null });
    expect(note.markdown).toBe(answer.text);
  });

  it('outside a Space it is still kept, just unfiled', () => {
    expect(noteFromAnswer({ ...base, space: null }).provenance.space).toBeNull();
  });
});
