import { describe, expect, it } from 'vitest';
import { parseSetupAnswer, setupPrompt, validateSetupRequest, validateSpeechText } from './service';
import type { SetupRequest } from '@/types/setup';

const spacesRequest: SetupRequest = { task: 'spaces', text: 'system design, spanish', existing: ['DSA'], catalog: [{ id: 'spanish', name: 'Learn Spanish' }] };

describe('validateSetupRequest', () => {
  it('accepts the two tasks and trims what was said', () => {
    expect(validateSetupRequest({ task: 'spaces', text: '  I want   DSA ', existing: ['Java'], catalog: [{ id: 'dsa', name: 'DSA' }] })).toEqual({ task: 'spaces', text: 'I want DSA', existing: ['Java'], catalog: [{ id: 'dsa', name: 'DSA' }] });
    expect(validateSetupRequest({ task: 'channels', text: 'striver', space: 'DSA' })).toEqual({ task: 'channels', text: 'striver', space: 'DSA' });
  });

  it('rejects empty text and unknown tasks', () => {
    expect(() => validateSetupRequest({ task: 'spaces', text: '   ' })).toThrow();
    expect(() => validateSetupRequest({ task: 'delete-everything', text: 'hi' })).toThrow();
    expect(() => validateSpeechText({ text: '' })).toThrow();
  });
});

describe('setupPrompt', () => {
  it('sends what was said, what already exists and the templates — nothing else', () => {
    const prompt = setupPrompt(spacesRequest);
    expect(JSON.parse(prompt.user)).toEqual({ said: 'system design, spanish', alreadyHas: ['DSA'], templates: [{ id: 'spanish', name: 'Learn Spanish' }] });
    expect(prompt.system).toMatch(/JSON/);
  });
});

describe('parseSetupAnswer', () => {
  it('keeps clean Spaces and drops duplicates, ones they already have and unknown templates', () => {
    const answer = parseSetupAnswer(spacesRequest, {
      reply: 'Got it — System Design and Learn Spanish.',
      spaces: [
        { name: 'System Design', templateId: 'made-up', icon: 'not-an-icon', kind: 'learning', topics: [{ name: 'Load balancing', keywords: ['load balancer'] }], keywords: ['system design'], searchHint: 'system design' },
        { name: 'system design', templateId: null },
        { name: 'DSA' },
        { name: 'Learn Spanish', templateId: 'spanish', icon: 'languages', kind: 'weird' },
        'garbage',
      ],
    });
    if (!('spaces' in answer)) throw new Error('expected spaces');
    expect(answer.spaces.map((s) => s.name)).toEqual(['System Design', 'Learn Spanish']);
    expect(answer.spaces[0]).toMatchObject({ templateId: null, icon: 'book-open', topics: [{ name: 'Load balancing', keywords: ['load balancer'] }] });
    expect(answer.spaces[1]).toMatchObject({ templateId: 'spanish', icon: 'languages', kind: 'learning' });
  });

  it('keeps creators named alongside a subject, and drops malformed ones', () => {
    const answer = parseSetupAnswer(spacesRequest, { reply: 'ok', spaces: [], channels: [{ space: 'DSA', names: ['take U forward', ''] }, { space: '', names: ['x'] }, { space: 'SQL', names: [] }, 'junk'] });
    expect('channels' in answer && answer.channels).toEqual([{ space: 'DSA', names: ['take U forward'] }]);
  });

  it('survives a reply that is not the expected shape', () => {
    expect(parseSetupAnswer(spacesRequest, null)).toEqual({ reply: 'What would you like to learn or watch?', spaces: [], channels: [] });
    expect(parseSetupAnswer({ task: 'channels', text: 'no', space: 'DSA' }, { channels: 'nope' })).toEqual({ reply: 'No problem.', channels: [] });
  });
});

describe('a setup turn', () => {
  const turn: SetupRequest = {
    task: 'turn',
    text: 'wait, in DSA I said Telusko',
    state: { spaces: [{ name: 'DSA', channels: ['India Telescope Shop'], isNew: true }], asking: { kind: 'channels', space: 'System Design' } },
    catalog: [{ id: 'dsa', name: 'DSA' }],
  };

  it('tells the model what is being asked and what each Space already has', () => {
    const user = JSON.parse(setupPrompt(turn).user);
    expect(user).toMatchObject({ said: 'wait, in DSA I said Telusko', answeringFor: 'System Design', spaces: [{ name: 'DSA', creators: ['India Telescope Shop'] }] });
  });

  it('keeps well-formed actions in order and drops the rest', () => {
    const answer = parseSetupAnswer(turn, {
      reply: 'Swapping it.',
      actions: [
        { type: 'remove_channels', space: 'DSA', names: ['India Telescope Shop'] },
        { type: 'add_channels', space: 'DSA', names: ['Telusko'] },
        { type: 'create_space', space: { name: 'DSA' } },
        { type: 'create_space', space: { name: 'Cooking', topics: [{ name: 'Knife Skills', keywords: [] }] } },
        { type: 'delete_everything' },
        { type: 'add_channels', space: 'DSA', names: [] },
        { type: 'no_channels', space: 'System Design' },
      ],
    });
    expect(answer).toMatchObject({
      reply: 'Swapping it.',
      actions: [
        { type: 'remove_channels', space: 'DSA', names: ['India Telescope Shop'] },
        { type: 'add_channels', space: 'DSA', names: ['Telusko'] },
        { type: 'create_space', space: { name: 'Cooking' } },
        { type: 'no_channels', space: 'System Design' },
      ],
    });
  });

  it('validates turns and picks', () => {
    expect(validateSetupRequest({ task: 'turn', text: 'hi', state: { spaces: [{ name: 'DSA', channels: ['x'], isNew: 1 }], asking: { kind: 'channels', space: 'DSA' } } })).toMatchObject({ state: { spaces: [{ name: 'DSA', channels: ['x'], isNew: false }], asking: { kind: 'channels', space: 'DSA' } } });
    expect(() => validateSetupRequest({ task: 'pick', text: 'x', space: 'DSA', items: [] })).toThrow();
  });
});

describe('choosing a channel from search results', () => {
  const pick: SetupRequest = { task: 'pick', text: 'telusko', space: 'DSA', items: [{ name: 'Telusko', candidates: [{ title: 'Telusko', handle: '@Telusko', subscribers: '2M', description: 'Java' }] }, { name: 'X', candidates: [{ title: 'Y', handle: null, subscribers: '', description: '' }] }] };
  it('accepts an index in range or null, nothing else', () => {
    expect(parseSetupAnswer(pick, { picks: [0, 3] })).toEqual({ picks: [0, null] });
    expect(parseSetupAnswer(pick, { picks: 'first' })).toEqual({ picks: [null, null] });
  });
});

