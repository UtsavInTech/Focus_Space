import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from '@/modes/templates';
import { buildLearningContext } from '../context/context';
import { buildKnowledgeMap } from '../knowledge/fuse';
import type { TranscriptSegment } from '../knowledge/types';
import { buildLearningPath } from '../path/path';
import { buildChatPrompt, createChatMessage } from './chat';
import { buildHomepageContext } from './homepage-context';
import { createAiService, type AiAvailability, type AiProvider } from './service';

// Same fixture shape as ai.test.ts / notes.test.ts — reusing buildKnowledgeMap/buildLearningPath, not a second context pipeline.
const dsa = structuredClone(DEFAULT_MODES.find((m) => m.id === 'dsa')!);
const map = buildKnowledgeMap({
  videoId: 'v18',
  durationSec: 3600,
  chapters: [],
  description: ['0:00 Introduction', '4:12 What is a Linked List', '17:32 Insertion at beginning', '21:00 Insertion at end'].join('\n'),
  comments: null,
  transcript: null,
  now: 0,
});
const path = buildLearningPath(
  { id: 'PLjava', title: 'Java DSA Complete Series', kind: 'playlist', items: Array.from({ length: 22 }, (_, i) => ({ videoId: `v${i + 1}`, title: `Lecture ${i + 1}`, index: i + 1 })) },
  'playlist',
  'v18',
  new Map([['v17', 1]]),
);
const transcript: TranscriptSegment[] = Array.from({ length: 400 }, (_, i) => ({ startSec: i * 5, durSec: 5, text: `Sentence ${i} about linked lists and pointers.` }));

const contextAt = (currentTime: number, language: 'en' | 'hi' | 'hinglish' = 'en') =>
  buildLearningContext({ video: { id: 'v18', title: 'Lecture 18 — Linked List', channelTitle: 'Apna College' }, mode: dsa, topicId: 'linked-lists', path, map, transcript, currentTime, language });

describe('chat prompt: reuses the same LearningContext pipeline as actions/notes', () => {
  it('carries current video, creator, timestamp, current concept, previous/upcoming concepts, course position, topic path and a transcript window', () => {
    const ctx = contextAt(1052); // 17:32 — inside "Insertion at beginning"
    const prompt = buildChatPrompt(ctx, [], 'Why do we update the head pointer?');
    expect(prompt.user).toContain('Lecture 18 — Linked List — Apna College');
    expect(prompt.user).toContain('Timestamp: 17:32');
    expect(prompt.user).toContain('Current concept: Insertion at beginning');
    expect(prompt.user).toContain('Course: Java DSA Complete Series, video #18 of 22');
    expect(prompt.user).toContain('Space: DSA (topic: Linked Lists)');
    expect(ctx.transcriptWindow?.text.length).toBeGreaterThan(0);
    expect(prompt.user).toContain(ctx.transcriptWindow!.text.slice(0, 30));
    expect(prompt.user).toContain('Why do we update the head pointer?');
  });

  it('folds recent history into the prompt for continuity, capped to the last few turns', () => {
    const ctx = contextAt(1052);
    const history = Array.from({ length: 10 }, (_, i) => createChatMessage(i % 2 === 0 ? 'learner' : 'assistant', `turn ${i}`, 'v18', 1000 + i));
    const prompt = buildChatPrompt(ctx, history, 'And after that?');
    expect(prompt.user).toContain('turn 9'); // most recent kept
    expect(prompt.user).not.toContain('turn 0'); // oldest dropped once capped
  });

  it('answers the subject, not the course, unless explicitly asked — same honesty rule as the point actions', () => {
    const prompt = buildChatPrompt(contextAt(1052), [], 'Explain this');
    expect(prompt.system).toMatch(/never invent/i);
    expect(prompt.system).toMatch(/explicitly ask/i);
  });

  it('applies the language rule (same rule family as WS2 notes) when the learner asks in Hindi/Hinglish', () => {
    const en = buildChatPrompt(contextAt(1052, 'en'), [], 'Why?');
    const hi = buildChatPrompt(contextAt(1052, 'hi'), [], 'Why?');
    const hinglish = buildChatPrompt(contextAt(1052, 'hinglish'), [], 'Why?');
    expect(en.user).not.toMatch(/Devanagari/);
    expect(en.user).toMatch(/language the learner's question is written in/);
    expect(hi.user).toMatch(/Hindi \(Devanagari/);
    expect(hi.user).toMatch(/keep technical terms/i);
    expect(hi.user).not.toMatch(/language the learner's question is written in/);
    expect(hinglish.user).toMatch(/Hinglish/);
  });

  it('keeps a long question whole, up to the API limit', () => {
    const long = `${'a'.repeat(1500)} END`;
    expect(buildChatPrompt(contextAt(1052), [], long).user).toContain(' END');
  });
});

describe('chat over a Hindi transcript', () => {
  const hindi: TranscriptSegment[] = Array.from({ length: 400 }, (_, i) => ({ startSec: i * 5, durSec: 5, text: `अब हम लिंक्ड लिस्ट में नया नोड जोड़ेंगे, पॉइंटर ${i} को अपडेट करके।` }));
  const hindiAt = (currentTime: number, language: 'en' | 'hi' = 'en') =>
    buildLearningContext({ video: { id: 'v18', title: 'Lecture 18 — Linked List', channelTitle: 'Apna College' }, mode: dsa, topicId: 'linked-lists', path, map, transcript: hindi, transcriptSource: 'asr', currentTime, language });

  it('names the transcript language and keeps the Hindi text as the evidence', () => {
    const prompt = buildChatPrompt(hindiAt(1052), [], 'What is being added here?');
    expect(prompt.user).toMatch(/Auto-generated captions.*, in Hindi \(Devanagari script\)/);
    expect(prompt.user).toContain('लिंक्ड लिस्ट');
    expect(prompt.system).toMatch(/never treat a non-English transcript as missing/i);
  });

  it('answers in the language of the question, not the transcript', () => {
    expect(buildChatPrompt(hindiAt(1052), [], 'What is being added here?').user).toMatch(/language the learner's question is written in/);
  });

  it('does not label an English transcript', () => {
    expect(buildChatPrompt(contextAt(1052), [], 'Why?').user).not.toMatch(/, in Hindi|other than English/);
  });
});

function fakeProvider(availability: AiAvailability, reply: string) {
  const provider: AiProvider = { id: 'chrome', label: 'x', availability: async () => availability, complete: async () => reply };
  return provider;
}

describe('voice reuses the exact same chat pipeline', () => {
  it('a voice turn produces the same ChatMessage shape as a text turn, only voice: true differs', () => {
    const text = createChatMessage('learner', 'Explain this', 'v18', 1052, false);
    const voice = createChatMessage('learner', 'Explain this', 'v18', 1052, true);
    expect({ ...text, id: '', at: 0 }).toEqual({ ...voice, id: '', at: 0, voice: false });
    expect(voice.voice).toBe(true);
  });

  it('a voice-flagged chat() call goes through the identical service method as text, with no separate voice architecture', async () => {
    const provider = fakeProvider('available', 'spoken answer');
    const ai = createAiService({ providers: () => [provider] });
    const ctx = contextAt(1052);
    const textResult = await ai.chat({ context: ctx, history: [], question: 'Explain this' });
    const voiceResult = await ai.chat({ context: ctx, history: [], question: 'Explain this', voice: true });
    expect(textResult).toEqual({ ok: true, answer: 'spoken answer', provider: 'chrome' });
    expect(voiceResult).toEqual(textResult); // identical result shape/content — voice only changes the usage tag (see provider.test.ts)
  });
});

describe('homepage chat: routes to HomepageContext instead of the video pipeline (docs bug fix)', () => {
  const homepage = buildHomepageContext({
    pageType: 'home',
    spaceName: 'DSA',
    activeCategory: null,
    topicNames: ['Arrays', 'Trees'],
    feedVideos: [
      { id: 'v1', title: 'Binary Search Trees Explained', channelId: 'UC1', channelTitle: 'Apna College', thumbnail: '', publishedAt: 0, views: 5000, durationSec: 600, relevance: 0.9, tier: 'excellent', topicId: 'trees', topicScores: {}, matched: [], difficulty: null, learning: 0.8, source: 'subscription' },
    ],
    subscriptions: [{ id: 'UC1', title: 'Apna College' }],
    language: 'en',
    now: 0,
  });

  it('never mentions a transcript or "this moment" — the bug the product brief called out', () => {
    const prompt = buildChatPrompt(homepage, [], 'Tell me what to watch, is there any news I should be aware of?');
    expect(prompt.system.toLowerCase()).not.toContain('transcript');
    expect(prompt.system.toLowerCase()).not.toContain('moment');
    expect(prompt.user.toLowerCase()).not.toContain('transcript');
  });

  it('lists the actually-available videos so "what should I watch" has something real to point to', () => {
    const prompt = buildChatPrompt(homepage, [], 'What should I watch?');
    expect(prompt.user).toContain('Binary Search Trees Explained');
    expect(prompt.user).toContain('Apna College');
    expect(prompt.user).toContain('Excellent match');
  });

  it('tells the model when videos or subscriptions are missing — but not to volunteer it', () => {
    const bare = buildHomepageContext({ pageType: 'home', spaceName: 'DSA', activeCategory: null, topicNames: [], feedVideos: [], subscriptions: [], language: 'en', now: 0 });
    const prompt = buildChatPrompt(bare, [], 'Is there anything from my subscriptions?');
    expect(prompt.user).toContain('cannot see any videos on this page yet');
    expect(prompt.user).toContain('Subscription data is not available here.');
    // An empty feed used to turn every message, "hi" included, into "there are no videos available".
    expect(prompt.system).toMatch(/if the list of videos is empty, do not announce that/i);
  });

  it('answers greetings and subject questions normally, while only recommending listed videos', () => {
    const prompt = buildChatPrompt(homepage, [], 'hi');
    expect(prompt.system).toMatch(/never invent a video that is not listed/i);
    expect(prompt.system).toMatch(/say so plainly instead of guessing/i);
    expect(prompt.system).toMatch(/limits what you may \*recommend\*, not what you may talk about/i);
    expect(prompt.system).toMatch(/if the learner only greets you/i);
  });

  it('a homepage chat() call reaches the provider exactly like a video one — same method, same result shape', async () => {
    const provider = fakeProvider('available', 'Try "Binary Search Trees Explained" from Apna College.');
    const ai = createAiService({ providers: () => [provider] });
    const result = await ai.chat({ context: homepage, history: [], question: 'What should I watch?' });
    expect(result).toEqual({ ok: true, answer: 'Try "Binary Search Trees Explained" from Apna College.', provider: 'chrome' });
  });
});

describe('chat with a whole-video outline', () => {
  const outline = [
    { startSec: 0, endSec: 252, title: 'Introduction', summary: 'What a linked list is' },
    { startSec: 252, endSec: 1260, title: 'Insertion', summary: 'At the head and the tail' },
    { startSec: 1260, endSec: 3600, title: 'Deletion', summary: 'Unlinking a node' },
  ];
  const withOutline = (currentTime: number) =>
    buildLearningContext({ video: { id: 'v18', title: 'Lecture 18 — Linked List', channelTitle: 'Apna College' }, mode: dsa, topicId: 'linked-lists', path, map, transcript, currentTime, language: 'en', outline });

  it('adds the outline, marks the current section, and asks for time ranges', () => {
    const prompt = buildChatPrompt(withOutline(1052), [], 'Where do they cover deletion?');
    expect(prompt.user).toContain('[Whole-video outline');
    expect(prompt.user).toContain('21:00–1:00:00 Deletion — Unlinking a node');
    expect(prompt.user).toMatch(/4:12–21:00 Insertion.*learner is here/);
    expect(prompt.system).toMatch(/time range/);
  });

  it('leaves the prompt as it was when there is no outline', () => {
    expect(buildChatPrompt(contextAt(1052), [], 'Why?').user).not.toContain('Whole-video outline');
  });
});
