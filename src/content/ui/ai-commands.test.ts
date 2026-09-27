import { describe, expect, it } from 'vitest';
import { looksLikeCommand } from './ai-commands';

describe('telling a command from a question', () => {
  it('sends instructions to be carried out', () => {
    for (const said of [
      'Please change the mode to system design',
      'okay change mode to system design and play video of harkirat building the new app',
      'hey change the mood',
      'create one mood music and then play a song of karan aujla winning speech',
      'play karan aujla winning speech',
      'show me some videos on dynamic programming',
      'mode badlo music pe',
    ])
      expect(looksLikeCommand(said), said).toBe(true);
  });

  it('leaves questions to the ordinary chat', () => {
    for (const said of ['what does this video say about recursion?', 'explain the two pointer approach', 'is this video good for beginners?', 'summarise this', 'which topic should I study next?'])
      expect(looksLikeCommand(said), said).toBe(false);
  });
});
