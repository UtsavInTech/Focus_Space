import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildLearningContext } from '../context/context';
import { createAiService, pickProvider, type ActionRequest, type AiAvailability, type AiProvider } from './service';
import { createUsageLog } from './usage';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const ctx = buildLearningContext({ video: { id: 'v1', title: 'Intro', channelTitle: 'x' }, mode: dsa, topicId: null, path: null, map: null, transcript: null, currentTime: 10 });

function fakeProvider(id: AiProvider['id'], availability: AiAvailability = 'available', reply = 'answer') {
  const calls: unknown[] = [];
  const provider: AiProvider = {
    id,
    label: id,
    availability: async () => availability,
    complete: async (_prompt, request) => {
      calls.push(request);
      return reply;
    },
  };
  return { provider, calls };
}

describe('pickProvider (shared by run(), chat() and notes generation)', () => {
  it('a widened AiProvider.id does not break selection of the two existing providers', async () => {
    const chrome = fakeProvider('chrome');
    const endpoint = fakeProvider('endpoint');
    expect((await pickProvider([chrome.provider]))?.provider.id).toBe('chrome');
    expect((await pickProvider([endpoint.provider]))?.provider.id).toBe('endpoint');
    expect((await pickProvider([chrome.provider, endpoint.provider]))?.provider.id).toBe('chrome'); // first available wins
  });

  it('falls back to a downloadable/downloading provider over nothing, never over an available one', async () => {
    const downloadable = fakeProvider('chrome', 'downloadable');
    const available = fakeProvider('endpoint', 'available');
    expect((await pickProvider([downloadable.provider]))?.availability).toBe('downloadable');
    expect((await pickProvider([downloadable.provider, available.provider]))?.provider.id).toBe('endpoint');
    expect(await pickProvider([])).toBeNull();
  });

  it('a new provider id (openrouter/openai, forwarded through the endpoint) is selectable like any other', async () => {
    const openrouter = fakeProvider('openrouter');
    expect((await pickProvider([openrouter.provider]))?.provider.id).toBe('openrouter');
  });
});

describe('usage accounting (docs/V5_CONTRACT.md §F/§I)', () => {
  it('records a usage entry on a fresh answer and on a cached hit, never when no provider is available', async () => {
    const { provider } = fakeProvider('chrome', 'available', 'the answer');
    const { sink, entries } = createUsageLog();
    const ai = createAiService({ providers: () => [provider], usage: sink });
    const request: ActionRequest = { action: 'explain', context: ctx };

    await ai.run(request);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ provider: 'chrome', action: 'explain', cached: false });
    expect(entries()[0].approxTokens).toBeGreaterThan(0);

    await ai.run(request); // same key → cache hit
    expect(entries()).toHaveLength(2);
    expect(entries()[1]).toMatchObject({ provider: 'chrome', cached: true });
  });

  it('never records usage for a locally-answered "what" when no provider is set up', async () => {
    const { sink, entries } = createUsageLog();
    const ai = createAiService({ providers: () => [], usage: sink });
    const result = await ai.run({ action: 'what', context: ctx });
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
    expect(entries()).toHaveLength(0);
  });

  it('records chat and voice turns distinctly, never on an unavailable provider', async () => {
    const { provider } = fakeProvider('chrome', 'available', 'chat answer');
    const { sink, entries } = createUsageLog();
    const ai = createAiService({ providers: () => [provider], usage: sink });
    await ai.chat({ context: ctx, history: [], question: 'Why?' });
    await ai.chat({ context: ctx, history: [], question: 'Why again?', voice: true });
    expect(entries().map((e) => e.action)).toEqual(['chat', 'voice']);

    const off = createAiService({ providers: () => [], usage: sink });
    const result = await off.chat({ context: ctx, history: [], question: 'Why?' });
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
    expect(entries()).toHaveLength(2); // unchanged
  });
});

describe('falling back to on-device AI', () => {
  const outOfCredits = (): AiProvider => ({
    id: 'endpoint',
    label: 'FocusSpace AI',
    availability: async () => 'available',
    complete: async () => {
      throw Object.assign(new Error('You have used today’s AI credits.'), { code: 'quota_exceeded' });
    },
  });

  it('answers on-device when the server is out of credits', async () => {
    const chrome = fakeProvider('chrome', 'available', 'free answer');
    const ai = createAiService({ providers: () => [outOfCredits(), chrome.provider] });
    const result = await ai.run({ action: 'explain', context: ctx });
    expect(result).toMatchObject({ ok: true, provider: 'chrome', answer: 'free answer' });
    const chat = await ai.chat({ context: ctx, history: [], question: 'Why?' });
    expect(chat).toMatchObject({ ok: true, provider: 'chrome' });
  });

  it('still reports the credit limit when there is nothing to fall back to', async () => {
    const ai = createAiService({ providers: () => [outOfCredits(), fakeProvider('chrome', 'downloadable').provider] });
    expect(await ai.run({ action: 'explain', context: ctx })).toMatchObject({ ok: false, code: 'quota_exceeded' });
  });
});
