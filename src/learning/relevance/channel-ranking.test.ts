import { describe, expect, it } from 'vitest';
import type { YtChannel } from '@/integrations/youtube/innertube-parse';
import { DEFAULT_MODES } from '@/modes/templates';
import { audienceWeight, formatSubscribers, rankChannels } from './channel-ranking';

/**
 * These fixtures are shaped like real channel-search responses (title + description snippet +
 * subscriber count + badge — everything YouTube's channel filter actually returns) but the channels are
 * invented, so nothing here encodes a list of famous creators. What is asserted is the *shape* of the
 * ordering: evidence beats a bare name match, and audience size only ever modulates evidence.
 */

const channel = (over: Partial<YtChannel> & { id: string; title: string }): YtChannel => ({
  handle: null,
  thumbnail: null,
  subscribersText: '',
  subscribers: null,
  description: '',
  verified: false,
  subscribed: false,
  ...over,
});

const titles = (ranked: ReturnType<typeof rankChannels>) => ranked.map((r) => r.channel.title);
const modeFor = (id: string) => DEFAULT_MODES.find((m) => m.id === id)!;

describe('rankChannels — the reported DSA case', () => {
  /** Exactly the failure from manual testing: three namesake channels with single-digit subscribers. */
  const results = [
    channel({ id: 'UCecho1', title: 'Data Structures and Algorithms', subscribers: 8 }),
    channel({ id: 'UCecho2', title: 'Data Structures And Algorithms', subscribers: 13 }),
    channel({ id: 'UCecho3', title: 'Data structures & algorithms', subscribers: 6 }),
    channel({
      id: 'UCteacher',
      title: 'Algo Academy',
      description: 'Free DSA course — arrays, graphs, dynamic programming and coding interview preparation, explained step by step.',
      subscribers: 1_400_000,
      verified: true,
    }),
    channel({
      id: 'UCsmall',
      title: 'Byte Sized Algorithms',
      description: 'Weekly walkthroughs of leetcode problems and data structures for interview preparation.',
      subscribers: 4200,
    }),
  ];

  it('puts the evidence-backed educators above the namesake channels', () => {
    const ranked = rankChannels(results, { query: 'Data Structures and Algorithms', mode: modeFor('dsa') });
    expect(titles(ranked).slice(0, 2)).toEqual(['Algo Academy', 'Byte Sized Algorithms']);
  });

  it('marks the namesake channels as low signal rather than removing them', () => {
    const ranked = rankChannels(results, { query: 'Data Structures and Algorithms', mode: modeFor('dsa') });
    expect(ranked).toHaveLength(4); // the two near-identical "and"/"And" names collapse into one
    const echoes = ranked.filter((r) => r.lowSignal);
    expect(echoes.length).toBe(2);
    expect(echoes.every((r) => r.reasons.some((reason) => /very small channel/i.test(reason)))).toBe(true);
    // Never dropped: someone who genuinely wants a tiny channel can still find it, at the end of the list.
    expect(echoes.every((r) => /data structures/i.test(r.channel.title))).toBe(true);
    expect(ranked.slice(-2)).toEqual(echoes);
  });

  it('keeps a small but clearly relevant creator ahead of the namesakes', () => {
    const ranked = rankChannels(results, { query: 'Data Structures and Algorithms', mode: modeFor('dsa') });
    const small = ranked.findIndex((r) => r.channel.id === 'UCsmall');
    const firstEcho = ranked.findIndex((r) => r.lowSignal);
    expect(small).toBeGreaterThanOrEqual(0);
    expect(small).toBeLessThan(firstEcho);
  });
});

describe('rankChannels — audience is a multiplier, not the ranking', () => {
  it('prefers a mid-sized channel about the subject over a huge one that merely mentions it', () => {
    const ranked = rankChannels(
      [
        channel({ id: 'UCbig', title: 'Daily Tech News', description: 'Tech news, gadget reviews and the occasional programming video.', subscribers: 8_000_000, verified: true }),
        channel({ id: 'UCfocused', title: 'Graph Theory School', description: 'Data structures and algorithms, graph theory and dynamic programming for competitive programming.', subscribers: 90_000 }),
      ],
      { query: 'data structures and algorithms', mode: modeFor('dsa') },
    );
    expect(titles(ranked)[0]).toBe('Graph Theory School');
  });

  it('breaks a tie between equally relevant channels with audience size', () => {
    const description = 'Photography tutorials: aperture, shutter speed and composition for beginners.';
    const ranked = rankChannels(
      [
        channel({ id: 'UCsmall', title: 'Lens Notes', description, subscribers: 3000 }),
        channel({ id: 'UCbig', title: 'Lens Craft', description, subscribers: 900_000 }),
      ],
      { query: 'photography tutorial', mode: modeFor('photography') },
    );
    expect(titles(ranked)).toEqual(['Lens Craft', 'Lens Notes']);
  });

  it('puts a creator the learner already follows ahead of an equally relevant, larger one', () => {
    const description = 'Recipes and cooking technique, one dish at a time.';
    const ranked = rankChannels(
      [
        channel({ id: 'UCother', title: 'Weeknight Table', description, subscribers: 300_000 }),
        channel({ id: 'UCmine', title: 'Second Helpings', description, subscribers: 20_000, subscribed: true }),
      ],
      { query: 'cooking recipe', mode: modeFor('cooking') },
    );
    expect(ranked[0].channel.id).toBe('UCmine');
    expect(ranked[0].reasons).toContain('You’re subscribed');
  });

  it('caps a bare name match below a channel whose description backs it up', () => {
    const ranked = rankChannels(
      [
        channel({ id: 'UCname', title: 'Photography Tutorial', subscribers: 400_000 }),
        channel({ id: 'UCreal', title: 'Aperture Notes', description: 'Photography tutorials: aperture, shutter speed, composition and lightroom editing.', subscribers: 40_000 }),
      ],
      { query: 'photography tutorial', mode: modeFor('photography') },
    );
    expect(titles(ranked)[0]).toBe('Aperture Notes');
  });
});

describe('rankChannels — across subjects', () => {
  it('surfaces the teaching channel for English learning', () => {
    const ranked = rankChannels(
      [
        channel({ id: 'UCvlog', title: 'English Family Vlogs', description: 'Our family life in England. New vlogs every Sunday!', subscribers: 500_000 }),
        channel({ id: 'UCteach', title: 'Speak Clear', description: 'Learn English: grammar, pronunciation and IELTS speaking practice lessons.', subscribers: 250_000 }),
      ],
      { query: 'learn english', mode: modeFor('english') },
    );
    expect(titles(ranked)[0]).toBe('Speak Clear');
  });

  it('works with no mode at all, on the query alone', () => {
    const ranked = rankChannels(
      [
        channel({ id: 'UCecho', title: 'Video Editing', subscribers: 11 }),
        channel({ id: 'UCreal', title: 'Cut & Colour', description: 'Video editing tutorials for Premiere Pro and DaVinci Resolve.', subscribers: 140_000 }),
      ],
      { query: 'video editing' },
    );
    expect(titles(ranked)[0]).toBe('Cut & Colour');
  });

  it('is stable and empty-safe', () => {
    expect(rankChannels([], { query: 'anything' })).toEqual([]);
    const one = rankChannels([channel({ id: 'UCa', title: 'A Channel' })], { query: '' });
    expect(one).toHaveLength(1);
    expect(one[0].score).toBeGreaterThanOrEqual(0);
  });
});

describe('rankChannels — every row explains itself, honestly', () => {
  it('does not call a channel relevant for using generic teaching words', () => {
    // TEACHING_CUES are subject-agnostic, so a bootcamp ad in a cooking search must not score at all.
    const [only] = rankChannels(
      [channel({ id: 'UCoff', title: 'Devstart Bootcamp', description: 'A complete course: learn to code, step by step, explained for beginners.', subscribers: 700_000 })],
      { query: 'cooking recipe', mode: modeFor('cooking') },
    );
    expect(only.relevance).toBe(0);
    expect(only.reasons).not.toContain('Describes itself as teaching this');
    expect(only.reasons.some((r) => /matches/i.test(r))).toBe(false);
  });

  it('still credits teaching once something ties the channel to the topic', () => {
    const [only] = rankChannels(
      [channel({ id: 'UCon', title: 'Pan & Plate', description: 'Cooking tutorials: a complete course in technique, explained step by step.', subscribers: 700_000 })],
      { query: 'cooking recipe', mode: modeFor('cooking') },
    );
    expect(only.reasons).toContain('Describes itself as teaching this');
  });

  it('never leaves a row with a blank explanation', () => {
    const ranked = rankChannels(
      [
        channel({ id: 'UCnone', title: 'Quiet Studio', description: 'A place for things we make, whenever we get round to making them.' }),
        channel({ id: 'UCbare', title: 'Untitled' }),
      ],
      { query: 'photography tutorial', mode: modeFor('photography') },
    );
    expect(ranked.every((r) => r.reasons.length > 0 && r.reasons.every((reason) => reason.trim() !== ''))).toBe(true);
  });

  it('does not tell the learner a channel is small when the count is simply hidden', () => {
    const [hidden] = rankChannels([channel({ id: 'UChidden', title: 'Someone' })], { query: 'photography tutorial' });
    expect(hidden.lowSignal).toBe(true);
    expect(hidden.reasons).not.toContain('Very small channel, little to go on');
    expect(hidden.reasons).toContain('Nothing here but the name');

    const [small] = rankChannels([channel({ id: 'UCsmall', title: 'Someone', subscribers: 12 })], { query: 'photography tutorial' });
    expect(small.reasons).toContain('Very small channel, little to go on');
  });
});

describe('audienceWeight / formatSubscribers', () => {
  it('rises with subscribers and saturates at a million', () => {
    expect(audienceWeight(1000)).toBeCloseTo(0.5, 2);
    expect(audienceWeight(100_000)).toBeCloseTo(0.833, 2);
    expect(audienceWeight(1_000_000)).toBe(1);
    expect(audienceWeight(50_000_000)).toBe(1);
    expect(audienceWeight(8)).toBeLessThan(0.2);
  });

  it('treats a hidden count as mid-range, not as zero', () => {
    expect(audienceWeight(null)).toBe(0.5);
  });

  it('formats counts the way YouTube does', () => {
    expect(formatSubscribers(1_400_000)).toBe('1.4M subscribers');
    expect(formatSubscribers(90_000)).toBe('90K subscribers');
    expect(formatSubscribers(4200)).toBe('4.2K subscribers');
    expect(formatSubscribers(1)).toBe('1 subscriber');
    expect(formatSubscribers(null)).toBeNull();
  });
});
