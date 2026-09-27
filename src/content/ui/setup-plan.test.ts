import { describe, expect, it } from 'vitest';
import { findChannel, modeFromPlan, NO_CHANNEL, offlineTurn, pickByName, spokenList } from './setup-plan';
import type { SetupSpacePlan } from '@/types/setup';

const plan = (over: Partial<SetupSpacePlan>): SetupSpacePlan => ({
  name: 'Pottery',
  templateId: null,
  icon: 'palette',
  kind: 'learning',
  description: 'Making things from clay.',
  topics: [
    { name: 'Wheel Throwing', keywords: ['wheel throwing'] },
    { name: 'Glazing', keywords: ['glaze'] },
  ],
  keywords: ['pottery'],
  searchHint: 'pottery',
  avoid: ['vlog'],
  ...over,
});

describe('modeFromPlan', () => {
  it('builds a new Space from the subtopics the assistant worked out', () => {
    const mode = modeFromPlan(plan({}), []);
    expect(mode).toMatchObject({ id: 'pottery', name: 'Pottery', icon: 'palette', searchHint: 'pottery', blockedKeywords: ['vlog'] });
    expect(mode.topics.map((t) => t.name)).toEqual(['Wheel Throwing', 'Glazing']);
  });

  it('uses the curated template for a built-in subject, adding the assistant’s extra subtopics', () => {
    const curated = modeFromPlan(plan({ name: 'Learn Spanish', templateId: 'spanish', topics: [] }), []);
    expect(curated.id).toBe('spanish');
    expect(curated.topics.length).toBeLessThan(10);
    const mode = modeFromPlan(plan({ name: 'Learn Spanish', templateId: 'spanish', topics: [{ name: curated.topics[0].name, keywords: [] }, { name: 'Spanish Slang', keywords: ['spanish slang'] }] }), []);
    expect(mode.topics.slice(0, curated.topics.length)).toEqual(curated.topics);
    expect(mode.topics.map((t) => t.name)).toContain('Spanish Slang');
    expect(mode.topics.filter((t) => t.name === curated.topics[0].name)).toHaveLength(1);
    expect(mode.topics.length).toBeLessThanOrEqual(10);
  });

  it('never reuses an id that is taken, and never trusts an unknown icon', () => {
    expect(modeFromPlan(plan({ icon: 'skull' }), ['pottery'])).toMatchObject({ id: 'pottery-2', icon: 'book-open' });
  });
});

describe('the way the assistant talks', () => {
  it('lists naturally', () => {
    expect(spokenList(['A'])).toBe('A');
    expect(spokenList(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('hears "no" in the ways people say it — and not in a name', () => {
    for (const no of ['no', 'Nope.', 'skip', 'nahi', 'not really', 'I don’t know'.replace('’', "'")]) expect(NO_CHANNEL.test(no), no).toBe(true);
    expect(NO_CHANNEL.test('Striver')).toBe(false);
    expect(NO_CHANNEL.test('No Boring Code channel')).toBe(false);
  });
});

describe('finding the creator someone means', () => {
  const titles = ['CodeHelp - by Babbar', 'Apna College', 'India Telescope Shop'];
  it('matches exactly, then loosely — the way people say names', () => {
    expect(findChannel(titles, 'apna college')).toBe(1);
    expect(findChannel(titles, 'Telescope')).toBe(2);
    expect(findChannel(titles, 'codehelp')).toBe(0);
    expect(findChannel(titles, 'Telusko')).toBe(-1);
  });

  it('only picks a search result by name when the name is really there', () => {
    expect(pickByName('Telusko', ['Telusko', 'Telusko Shorts'])).toBe(0);
    expect(pickByName('Gaurav Sen', ['Some Other Channel'])).toBeNull();
  });
});

describe('a turn without the server', () => {
  const none = () => [];
  it('answers the open creator question with skip or a name', () => {
    expect(offlineTurn('nope', { kind: 'channels', space: 'DSA' }, none).actions).toEqual([{ type: 'no_channels', space: 'DSA' }]);
    expect(offlineTurn('Telusko', { kind: 'channels', space: 'DSA' }, none).actions).toEqual([{ type: 'add_channels', space: 'DSA', names: ['Telusko'] }]);
  });

  it('reads subjects otherwise, and asks when there are none', () => {
    expect(offlineTurn('hmm', { kind: 'subjects' }, none)).toMatchObject({ actions: [] });
    expect(offlineTurn('cooking', null, () => [plan({ name: 'Cooking' })]).actions).toMatchObject([{ type: 'create_space', space: { name: 'Cooking' } }]);
  });
});

