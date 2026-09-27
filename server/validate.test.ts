import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildLearningContext } from '@/learning/context/context';
import { buildHomepageContext } from '@/learning/ai/homepage-context';
import { ApiError } from './http';
import { validateAiApiRequest } from './validate';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const learningContext = buildLearningContext({ video: { id: 'v1', title: 'Intro', channelTitle: 'x' }, mode: dsa, topicId: null, path: null, map: null, transcript: null, currentTime: 10 });
const homepageContext = buildHomepageContext({ pageType: 'home', spaceName: 'DSA', activeCategory: null, topicNames: [], feedVideos: [], subscriptions: [], language: 'en' });

const badRequest = (body: unknown) => {
  try {
    validateAiApiRequest(body);
    throw new Error('expected validateAiApiRequest to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
};

describe('validateAiApiRequest', () => {
  it('accepts a valid action request (video-only, LearningContext)', () => {
    const req = validateAiApiRequest({ version: 1, action: 'explain', context: learningContext });
    expect(req.action).toBe('explain');
    expect(req.context).toBe(learningContext);
  });

  it('accepts a valid chat request with a question and either context kind', () => {
    expect(validateAiApiRequest({ action: 'chat', context: learningContext, question: 'Why?' }).question).toBe('Why?');
    expect(validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'What should I watch?' }).context).toBe(homepageContext);
  });

  it('accepts a chat/action request with a pre-built prompt instead of a question — today\'s extension wire format', () => {
    const req = validateAiApiRequest({ action: 'chat', context: homepageContext, prompt: { system: 's', user: 'u' } });
    expect(req.prompt).toEqual({ system: 's', user: 'u' });
  });

  it('rejects a non-object body (malformed request)', () => {
    expect(badRequest(null).code).toBe('invalid_request');
    expect(badRequest('a string').code).toBe('invalid_request');
    expect(badRequest([1, 2, 3]).code).toBe('invalid_request');
  });

  it('rejects an invalid action value', () => {
    const err = badRequest({ action: 'delete-everything', context: learningContext });
    expect(err.message).toMatch(/action/i);
  });

  it('rejects a missing action', () => {
    expect(badRequest({ context: learningContext }).code).toBe('invalid_request');
  });

  it('no longer accepts the removed "ask" action — questions go through chat', () => {
    expect(badRequest({ action: 'ask', context: learningContext, question: 'why?' }).message).toMatch(/action/);
  });

  it('rejects "chat" with neither a question nor a prompt', () => {
    const err = badRequest({ action: 'chat', context: learningContext });
    expect(err.message).toMatch(/question/i);
    expect(badRequest({ action: 'chat', context: homepageContext }).message).toMatch(/question/i);
  });

  it('rejects a context that matches neither LearningContext nor HomepageContext', () => {
    const err = badRequest({ action: 'chat', context: { foo: 'bar' }, question: 'hi' });
    expect(err.message).toMatch(/context/i);
  });

  it('rejects a missing context', () => {
    expect(badRequest({ action: 'chat', question: 'hi' }).code).toBe('invalid_request');
  });

  it('rejects a video-only action (e.g. "quiz") given a HomepageContext — the routing rule Layer 1.5 relies on', () => {
    const err = badRequest({ action: 'quiz', context: homepageContext });
    expect(err.message).toMatch(/LearningContext/);
  });

  it('rejects notes/mindmap without a pre-built prompt (Layer 2A does not reconstruct NoteRequestInputs server-side)', () => {
    expect(badRequest({ action: 'notes', context: learningContext }).message).toMatch(/prompt/i);
  });

  it('rejects an oversized context payload', () => {
    const huge = { ...homepageContext, visibleVideos: Array.from({ length: 5000 }, (_, i) => ({ videoId: `v${i}`, title: 'x'.repeat(200), channelTitle: 'y', durationSec: 1, views: 1, publishedText: '1d', position: i, reason: 'z' })) };
    expect(badRequest({ action: 'chat', context: huge, question: 'hi' }).message).toMatch(/context/i);
  });

  it('rejects an oversized question', () => {
    expect(badRequest({ action: 'chat', context: homepageContext, question: 'x'.repeat(5000) }).message).toMatch(/question/i);
  });

  it('rejects a malformed prompt object', () => {
    expect(badRequest({ action: 'chat', context: homepageContext, prompt: { system: 's' } }).message).toMatch(/prompt/i);
    expect(badRequest({ action: 'chat', context: homepageContext, prompt: 'not an object' }).message).toMatch(/prompt/i);
  });

  it('rejects a malformed history entry', () => {
    expect(badRequest({ action: 'chat', context: homepageContext, question: 'hi', history: [{ role: 'wizard', text: 'x' }] }).message).toMatch(/history/i);
    expect(badRequest({ action: 'chat', context: homepageContext, question: 'hi', history: 'not an array' }).message).toMatch(/history/i);
  });

  it('accepts an optional idempotencyKey (Layer 2C) and omits it when absent', () => {
    const withKey = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi', idempotencyKey: 'abc-123' });
    expect(withKey.idempotencyKey).toBe('abc-123');
    const withoutKey = validateAiApiRequest({ action: 'chat', context: homepageContext, question: 'hi' });
    expect(withoutKey.idempotencyKey).toBeUndefined();
  });

  it('rejects an empty, non-string, or oversized idempotencyKey', () => {
    expect(badRequest({ action: 'chat', context: homepageContext, question: 'hi', idempotencyKey: '' }).message).toMatch(/idempotencyKey/i);
    expect(badRequest({ action: 'chat', context: homepageContext, question: 'hi', idempotencyKey: 42 }).message).toMatch(/idempotencyKey/i);
    expect(badRequest({ action: 'chat', context: homepageContext, question: 'hi', idempotencyKey: 'x'.repeat(129) }).message).toMatch(/idempotencyKey/i);
  });
});

describe('question: null is "no question", not a bad request', () => {
  const context = {
    pageType: 'home',
    spaceName: 'DSA',
    activeCategory: null,
    categoryChips: [],
    visibleVideos: [],
    visibleSubscriptions: [],
    language: 'en',
  };

  it('accepts an explicit null question on a notes request with a prompt', () => {
    const request = validateAiApiRequest({
      version: 1,
      action: 'mindmap',
      context,
      question: null,
      prompt: { system: 's', user: 'u' },
    });
    expect(request.question).toBeUndefined();
  });

  it('still rejects a question that is neither a string nor null', () => {
    expect(() => validateAiApiRequest({ version: 1, action: 'mindmap', context, question: 42, prompt: { system: 's', user: 'u' } })).toThrow(/must be a string/);
  });
});
