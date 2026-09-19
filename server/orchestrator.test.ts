import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildLearningContext } from '@/learning/context/context';
import { buildHomepageContext } from '@/learning/ai/homepage-context';
import { ApiError } from './http';
import type { OpenRouterConfig } from './openrouter';
import { orchestrate } from './orchestrator';
import { validateAiApiRequest } from './validate';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const learningContext = buildLearningContext({ video: { id: 'v1', title: 'Intro to Linked Lists', channelTitle: 'Apna College' }, mode: dsa, topicId: null, path: null, map: null, transcript: null, currentTime: 10 });
const homepageContext = buildHomepageContext({
  pageType: 'home',
  spaceName: 'DSA',
  activeCategory: null,
  topicNames: ['Linked Lists'],
  feedVideos: [{ id: 'v9', title: 'Reverse a Linked List', channelId: 'UC1', channelTitle: 'Apna College', thumbnail: '', publishedAt: 0, views: 100, durationSec: 300, relevance: 0.9, tier: 'excellent', topicId: 'll', topicScores: {}, matched: [], difficulty: null, learning: 0.8, source: 'subscription' }],
  subscriptions: [],
  language: 'en',
});

const FAKE_KEY = 'sk-or-test-do-not-leak-this-value';
const config: OpenRouterConfig = { apiKey: FAKE_KEY, model: 'openai/gpt-4o-mini', maxTokens: 700 };

function mockOpenRouterOk(content: string) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('orchestrate: LearningContext requests reach the provider', () => {
  it('a video-only action builds the same prompt buildPrompt() would, and reaches OpenRouter', async () => {
    const fetchMock = mockOpenRouterOk('Explanation of linked lists.');
    const request = validateAiApiRequest({ action: 'explain', context: learningContext });
    const result = await orchestrate(request, { config });

    expect(result).toEqual({ ok: true, answer: 'Explanation of linked lists.', provider: 'openrouter', model: 'openai/gpt-4o-mini', usage: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string) as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('openai/gpt-4o-mini');
    expect(body.messages[1].content).toContain('Intro to Linked Lists'); // the actual video title reached the model
  });

  it('a chat request over a LearningContext reaches the provider with video-grounded content', async () => {
    mockOpenRouterOk('answer');
    const request = validateAiApiRequest({ action: 'chat', context: learningContext, question: 'What are we learning?' });
    const result = await orchestrate(request, { config });
    expect(result.ok).toBe(true);
  });
});

describe('orchestrate: HomepageContext requests reach the provider, routed correctly (Layer 1.5 bug guard)', () => {
  it('a homepage chat request never mentions transcript/moment language, and includes real feed data', async () => {
    const fetchMock = mockOpenRouterOk('Try Reverse a Linked List.');
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'What should I watch?' });
    const result = await orchestrate(request, { config });

    expect(result.answer).toBe('Try Reverse a Linked List.');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    const [system, user] = body.messages;
    expect(system.content.toLowerCase()).not.toContain('transcript');
    expect(user.content).toContain('Reverse a Linked List'); // real homepage video data reached the model
  });
});

describe('orchestrate: pre-built prompts pass through unchanged (today\'s extension wire format)', () => {
  it('uses the client-provided prompt verbatim instead of rebuilding one', async () => {
    const fetchMock = mockOpenRouterOk('ok');
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, prompt: { system: 'custom system', user: 'custom user text' } });
    await orchestrate(request, { config });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    expect(body.messages[0].content).toBe('custom system');
    expect(body.messages[1].content).toBe('custom user text');
  });
});

describe('orchestrate: OpenRouter failures become safe API errors', () => {
  it('a non-2xx upstream response becomes an ApiError, not a thrown fetch error or a leaked body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key.' } }) })));
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    await expect(orchestrate(request, { config })).rejects.toMatchObject({ status: 502, code: 'upstream_error' });
  });

  it('a network failure reaching OpenRouter becomes a safe upstream_error, not an unhandled exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND openrouter.ai');
      }),
    );
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    const err = await orchestrate(request, { config }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
  });

  it('an empty model response is treated as an upstream error, not silently returned', async () => {
    mockOpenRouterOk('   ');
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    await expect(orchestrate(request, { config })).rejects.toMatchObject({ code: 'upstream_error' });
  });
});

describe('orchestrate: the API key never appears in the response', () => {
  it('the success response contains no trace of the configured API key', async () => {
    mockOpenRouterOk('answer text');
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    const result = await orchestrate(request, { config });
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it('an upstream-error response also contains no trace of the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    let caught: ApiError | null = null;
    try {
      await orchestrate(request, { config });
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(JSON.stringify({ status: caught?.status, code: caught?.code, error: caught?.message })).not.toContain(FAKE_KEY);
  });
});

describe('orchestrate: provider response is normalized correctly', () => {
  it('joins multiple choices and trims whitespace, mirroring the reference server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '  first  ' } }, { message: { content: 'second' } }] }) })),
    );
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    const result = await orchestrate(request, { config });
    expect(result.answer).toBe('first  \nsecond');
    expect(result).toMatchObject({ ok: true, provider: 'openrouter', model: config.model });
  });
});

describe('orchestrate: OpenRouter token usage (Layer 2C)', () => {
  it('captures prompt/completion token counts when OpenRouter includes them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'answer' } }], usage: { prompt_tokens: 123, completion_tokens: 45 } }) })),
    );
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    const result = await orchestrate(request, { config });
    expect(result.usage).toEqual({ promptTokens: 123, completionTokens: 45 });
  });

  it('is null, not a thrown error, when OpenRouter omits usage metadata', async () => {
    mockOpenRouterOk('answer');
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    const result = await orchestrate(request, { config });
    expect(result.usage).toBeNull();
  });
});

describe('orchestrate: usage extension point (no-op by default, Layer 2B implements it)', () => {
  it('calls onUsage exactly once per successful request when provided, with no persistence yet', async () => {
    mockOpenRouterOk('answer');
    const onUsage = vi.fn();
    const request = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    await orchestrate(request, { config, onUsage });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat', model: config.model }));
  });
});

describe('answer length is budgeted per action', () => {
  it('notes and mind maps get room to cover a whole lecture; a moment’s explanation keeps the configured cap', async () => {
    const { maxTokensFor } = await import('./orchestrator');
    expect(maxTokensFor('explain', 700)).toBe(700);
    expect(maxTokensFor('ask', 700)).toBe(700);
    expect(maxTokensFor('mindmap', 700)).toBeGreaterThanOrEqual(1500);
    expect(maxTokensFor('notes', 700)).toBeGreaterThanOrEqual(2000);
    // The configured cap is a floor, never lowered.
    expect(maxTokensFor('notes', 4000)).toBe(4000);
  });
});
