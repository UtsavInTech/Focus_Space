import { describe, expect, it } from 'vitest';
import { speechChunks } from './voice';

describe('speech, as it should be heard', () => {
  it('drops markdown, code and links', () => {
    expect(speechChunks('**Two pointers** — see [this](https://x.y). Use `i < n`.')).toEqual(['Two pointers — see this.', 'Use i < n.']);
  });

  it('starts with one short sentence, then groups the rest into fewer pieces', () => {
    const chunks = speechChunks('Okay. This is the first real sentence. Here is another one. And a third one here.');
    expect(chunks[0]).toBe('Okay.');
    expect(chunks.length).toBe(2);
    expect(chunks.slice(1).join(' ')).toBe('This is the first real sentence. Here is another one. And a third one here.');
  });

  it('never makes a piece longer than the limit', () => {
    expect(speechChunks('word '.repeat(200) + '.', 120).every((c) => c.length <= 120)).toBe(true);
    expect(speechChunks('   ')).toEqual([]);
  });
});
