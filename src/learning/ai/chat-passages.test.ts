import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import type { ChatMessage } from '@/types/chat';
import { buildLearningContext, CONTEXT_VERSION } from '../context/context';
import type { TranscriptSegment } from '../knowledge/types';
import { MAX_RELATED_CHARS } from '../knowledge/passages';
import { AI_ACTIONS, buildPrompt, WINDOW_FOR } from './actions';
import { buildChatPrompt, createChatMessage } from './chat';

const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const video = { id: 'hashvid0001', title: 'Hashing — Complete Lecture', channelTitle: 'Apna College' };

/** `hours` of lecture, one caption line every 4 s; collisions are explained around 40:00, the playhead is far from there. */
function lecture(hours: number): TranscriptSegment[] {
  return Array.from({ length: (hours * 3600) / 4 }, (_, i) => ({
    startSec: i * 4,
    durSec: 4,
    text:
      i === 600
        ? 'When two keys hash to the same bucket that is a collision, and chaining resolves each collision with a list.'
        : `Line ${i}: we keep writing the loop over the array and printing each value.`,
  }));
}

const contextFor = (transcript: TranscriptSegment[], currentTime: number, question?: string) =>
  buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript, currentTime, question });

describe('chat: passages from elsewhere in the video', () => {
  it('bumps the context version, so answers cached from the old shape are dropped', () => {
    expect(CONTEXT_VERSION).toBe(4);
  });

  it('finds what was said 40 minutes earlier and puts it in its own block, with its time', () => {
    const ctx = contextFor(lecture(2), 5400, 'What did he say about collisions?');
    expect(ctx.relatedPassages?.length).toBeGreaterThan(0);
    const prompt = buildChatPrompt(ctx, [], 'What did he say about collisions?');
    expect(prompt.user).toContain('[From elsewhere in this video — transcript passages that match the question]');
    expect(prompt.user).toMatch(/\[3\d:\d\d–\d\d:\d\d\]\n"""[^"]*collision/);
    // Current moment first, then the passages, then the question.
    expect(prompt.user.indexOf('[Being taught now]')).toBeLessThan(prompt.user.indexOf('[From elsewhere in this video'));
    expect(prompt.user.indexOf('[From elsewhere in this video')).toBeLessThan(prompt.user.indexOf("Learner's question"));
  });

  it('tells the model to use only the times it was given, in brackets, and to say so when evidence is missing', () => {
    const { system } = buildChatPrompt(contextFor(lecture(1), 100, 'collisions'), [], 'collisions');
    expect(system).toContain('never invent or estimate one');
    expect(system).toContain('[mm:ss]');
    expect(system).toContain('When you use an excerpt, give its time');
    expect(system).toContain('name each place with its time');
    expect(system).toContain('trust the excerpt');
    expect(system).toContain('Never mention excerpts, passages, the outline or this context');
    expect(system).toContain('say so plainly instead of guessing');
  });

  it('labels passages from auto-generated captions as possibly misheard', () => {
    const ctx = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript: lecture(1), transcriptSource: 'asr', currentTime: 3000, question: 'collisions' });
    expect(buildChatPrompt(ctx, [], 'collisions').user).toContain('match the question (auto-generated captions');
  });

  it('adds nothing for a greeting or a general question — chat works exactly as before', () => {
    for (const q of ['hi', 'thanks!', 'can you explain that again?']) {
      const ctx = contextFor(lecture(1), 1200, q);
      expect(ctx.relatedPassages).toBeNull();
      expect(buildChatPrompt(ctx, [], q).user).not.toContain('From elsewhere in this video');
    }
  });

  it('never gives passages to the other AI actions, notes or mind maps', () => {
    for (const { id } of AI_ACTIONS) {
      const ctx = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript: lecture(1), currentTime: 3000, window: WINDOW_FOR[id] });
      expect(ctx.relatedPassages).toBeNull();
      expect(buildPrompt(id, ctx).user).not.toContain('From elsewhere in this video');
    }
    const notes = buildLearningContext({ video, mode: dsa, topicId: null, path: null, map: null, transcript: lecture(1), currentTime: 0, range: { startSec: 0, endSec: 3600 }, question: 'collisions' });
    expect(notes.relatedPassages).toBeNull();
  });

  it('keeps the prompt the same size for a 1-hour and a 12-hour video', () => {
    const short = buildChatPrompt(contextFor(lecture(1), 3300, 'what about collisions'), [], 'what about collisions');
    const long = buildChatPrompt(contextFor(lecture(12), 40_000, 'what about collisions'), [], 'what about collisions');
    expect(Math.abs(long.user.length - short.user.length)).toBeLessThan(400);
    const related = contextFor(lecture(12), 40_000, 'what about collisions').relatedPassages ?? [];
    expect(related.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(MAX_RELATED_CHARS);
  });

  it('drops the passages rather than push a turn past the API limit when a long conversation fills the prompt', () => {
    const q = 'What did he say about collisions?';
    const ctx = contextFor(lecture(2), 5400, q);
    expect(ctx.relatedPassages?.length).toBeGreaterThan(0);
    const without = { ...ctx, relatedPassages: null };
    const history = (chars: number): ChatMessage[] => Array.from({ length: 6 }, (_, i) => createChatMessage(i % 2 ? 'assistant' : 'learner', 'x'.repeat(chars), video.id, 0));
    // The longest conversation that still fits without passages — so with them it would not.
    let chars = 3900;
    while (buildChatPrompt(without, history(chars), q).user.length > 24_000) chars -= 10;
    const prompt = buildChatPrompt(ctx, history(chars), q);
    expect(prompt.user.length).toBeLessThanOrEqual(24_000);
    expect(prompt.user).toBe(buildChatPrompt(without, history(chars), q).user);
    expect(buildChatPrompt(ctx, [], q).user).toContain('From elsewhere in this video');
  });
});
