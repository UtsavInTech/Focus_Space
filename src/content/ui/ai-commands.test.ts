import { describe, expect, it } from 'vitest';
import { localCreate, looksLikeCommand } from './ai-commands';

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

describe('voice: creating a learning Space with subtopics', () => {
  it('hears misheard "create" as a command', () => {
    for (const said of ['Creative mode for learning Japanese adds subtopics', 'crate a space for french', 'create a mode for learning japanese and add subtopics', 'add subtopics to japanese'])
      expect(looksLikeCommand(said), said).toBe(true);
  });

  it('builds the Space with its subtopics even without the AI', () => {
    const plan = localCreate('Creative mode for learning Japanese adds subtopics', []);
    const create = plan?.actions[0];
    expect(create?.type).toBe('create_space');
    if (create?.type !== 'create_space') return;
    expect(create.space.name).toMatch(/Japanese/);
    expect(create.space.topics.length).toBeGreaterThanOrEqual(4);
    expect(localCreate('create a space for system design please', [])?.actions[0]).toMatchObject({ type: 'create_space', space: { name: 'System Design' } });
  });

  it('switches instead of duplicating a Space they already have', () => {
    expect(localCreate('create a mode for system design', [{ id: 'sd', name: 'System Design' }])?.actions[0]).toEqual({ type: 'switch_space', space: 'System Design' });
  });
});
