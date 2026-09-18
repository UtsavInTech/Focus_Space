import { describe, expect, it } from 'vitest';
import { prepareForSpeech } from './voice';

describe('prepareForSpeech: the only voice-specific logic (everything else is the shared chat pipeline)', () => {
  it('strips markdown notation that would read oddly aloud', () => {
    expect(prepareForSpeech('**Insertion** is `O(1)` at the head.')).toBe('Insertion is O(1) at the head.');
    expect(prepareForSpeech('## Insertion\n- one\n- two')).toBe('Insertion one two');
  });

  it('replaces a code block with a spoken placeholder instead of reading the code aloud', () => {
    const text = 'Here it is:\n```js\nhead.next = node;\n```\nThat is the whole change.';
    const spoken = prepareForSpeech(text);
    expect(spoken).toContain('Code block omitted');
    expect(spoken).not.toContain('head.next');
  });

  it('collapses whitespace so multi-paragraph notes read as one clean utterance', () => {
    expect(prepareForSpeech('Line one.\n\n\nLine two.')).toBe('Line one. Line two.');
  });
});
