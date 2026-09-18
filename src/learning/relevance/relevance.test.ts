import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Channel, LearningMode, VideoRecord } from '@/types/domain';
import { DEFAULT_MODES, blankMode } from '@/modes/templates';
import { cacheMisses, clearClassificationCache, exportModeCache, fingerprintOf, hydrateModeCache, isRelevant, ruleClassifier } from '@/learning/classifier';
import { buildModeLibrary, filterLibrary, searchLibrary, searchQueryWithContext } from '@/learning/library';
import { cleanDescription, detectBoilerplate } from './scorer';

const mode = (id: string): LearningMode => structuredClone(DEFAULT_MODES.find((m) => m.id === id)!);
const MODES = Object.fromEntries(DEFAULT_MODES.map((m) => [m.id, mode(m.id)]));
const score = (title: string, modeId = 'ai-ml', description = '') => ruleClassifier.classify({ videoId: `t:${title}`, title, description }, MODES[modeId]);
const rel = (title: string, modeId = 'ai-ml') => score(title, modeId).relevance;

describe('the reported AI / ML problem', () => {
  const excellent = ['Transformers Explained From Scratch', 'RAG Tutorial for Beginners', 'Fine-Tuning LLMs', 'PyTorch Deep Learning Course', 'Attention Mechanism Explained', 'Build a Neural Network'];
  const medium = ['AI Engineering Interview Experience', 'How I Became an ML Engineer', 'AI Career Roadmap'];
  const weak = ['My New Laptop for AI', 'AI Changed My Life', "India's AI Future", 'Daily Vlog With AI', 'Funny AI Reaction', 'My AI Startup Journey'];

  it('ranks genuine lessons far above career talk, and career talk above accidental keyword matches', () => {
    const e = excellent.map((t) => rel(t));
    const m = medium.map((t) => rel(t));
    const w = weak.map((t) => rel(t));
    expect(Math.min(...e)).toBeGreaterThanOrEqual(0.6);
    expect(Math.min(...e) - Math.max(...m)).toBeGreaterThanOrEqual(0.3);
    expect(Math.min(...m)).toBeGreaterThan(Math.max(...w));
  });

  it('keeps every "excellent" example in the feed and every other example out', () => {
    for (const t of excellent) expect(isRelevant(score(t)), t).toBe(true);
    for (const t of [...medium, ...weak]) expect(isRelevant(score(t)), t).toBe(false);
  });

  it('does not treat a broad keyword as a topic', () => {
    for (const t of ['AI News Today', 'My AI Laptop Setup', 'AI Changed Everything About My Career']) {
      expect(score(t).tier, t).toBe('none');
    }
  });

  it('explains scores with signals and penalties', () => {
    const { signals } = ruleClassifier.explain({ videoId: 'x', title: 'My New Laptop for AI' }, MODES['ai-ml']);
    expect(signals.some((s) => s.kind === 'note' && s.label.includes('broad'))).toBe(true);
    expect(signals.some((s) => s.kind === 'penalty' && s.label.startsWith('lifestyle'))).toBe(true);
    const good = ruleClassifier.explain({ videoId: 'y', title: 'Attention Mechanism Explained' }, MODES['ai-ml']).signals;
    expect(good.some((s) => s.kind === 'exact')).toBe(true);
    expect(good.some((s) => s.kind === 'learning')).toBe(true);
  });
});

describe('scoring mechanics', () => {
  it('never double counts repeated or overlapping terms', () => {
    expect(rel('machine learning machine learning')).toBe(rel('Machine Learning'));
    expect(rel('LLMs and LLM transformer transformers')).toBe(rel('LLM transformer'));
    expect(score('Binary Search Tree Insertion', 'dsa').topicId).toBe('bst');
  });

  it('respects ambiguity guards', () => {
    expect(rel('Full Stack Web Development Course 2026', 'dsa')).toBeLessThan(0.3);
    expect(rel('Full Stack Web Development Course 2026', 'web-dev')).toBeGreaterThanOrEqual(0.9);
    expect(rel('Graph RAG Simply Explained', 'dsa')).toBeLessThan(0.3);
    expect(rel('Decision Tree Classifier Explained', 'ai-ml')).toBeGreaterThanOrEqual(0.75);
    expect(rel('Decision Tree Classifier Explained', 'dsa')).toBeLessThan(0.3);
  });

  it('treats noise as a penalty, not a block', () => {
    expect(rel('AI Engineering Podcast — RAG Architecture Deep Dive')).toBeGreaterThanOrEqual(0.6);
    // Same topic evidence, only the noise differs: the penalty applies, softened for a clear deep dive.
    const podcast = score('RAG Architecture Deep Dive Podcast');
    expect(podcast.categories).toContain('podcast');
    expect(podcast.relevance).toBeLessThan(rel('RAG Architecture Deep Dive'));
    expect(podcast.relevance).toBeGreaterThanOrEqual(0.6);
    expect(rel('Funny RAG Reaction Compilation')).toBeLessThan(0.45);
    expect(score('Funny RAG Reaction Compilation').strength).not.toBe('blocked');
  });

  it('only counts learning signals alongside topic evidence', () => {
    expect(rel('Cooking Tutorial for Beginners')).toBe(0);
    expect(rel('Neural Networks')).toBeLessThan(rel('Neural Networks Tutorial'));
  });

  it('keeps supporting (~) keywords from qualifying a video alone', () => {
    expect(isRelevant(score('Probability Basics'))).toBe(false);
    expect(isRelevant(score('Probability for Machine Learning Explained'))).toBe(true);
  });

  it('uses the description as corroboration only after removing channel boilerplate', () => {
    const repeated = 'Learn data structures and algorithms with our DSA course.';
    const descriptions = ['Episode one.', 'Episode two.', 'Episode three.'].map((d) => `${d}\n${repeated}\nhttps://example.com`);
    const boilerplate = detectBoilerplate(descriptions);
    expect(cleanDescription(descriptions[0], boilerplate)).toBe('Episode one.');
    const withBoilerplate = ruleClassifier.classify({ videoId: 'bp1', title: "Bresenham's Line Drawing Algorithm", description: descriptions[0] }, MODES.dsa);
    const cleaned = ruleClassifier.classify({ videoId: 'bp2', title: "Bresenham's Line Drawing Algorithm", description: descriptions[0] }, MODES.dsa, { boilerplate });
    expect(cleaned.relevance).toBeLessThan(withBoilerplate.relevance);
    expect(cleaned.tier).toBe('none');
  });

  it('does not penalise words a mode explicitly asks for', () => {
    const newsMode: LearningMode = { ...blankMode('ai-news', 1), name: 'AI News', keywords: ['ai news', 'openai', 'model release'], topics: [] };
    const cls = ruleClassifier.classify({ videoId: 'n', title: 'AI news: OpenAI model release this week' }, newsMode);
    expect(cls.categories).not.toContain('news');
    expect(cls.relevance).toBeGreaterThanOrEqual(0.6);
  });
});

describe('every built-in learning mode', () => {
  const cases: [string, string, string | null][] = [
    ['dsa', 'Dynamic Programming Explained with Examples', 'dynamic-programming'],
    ['dsa', 'Dijkstra Algorithm Tutorial', 'graphs'],
    ['web-dev', 'React Hooks Crash Course', 'react'],
    ['web-dev', 'Next.js 15 App Router Tutorial', 'nextjs'],
    ['ai-ml', 'PyTorch CNN from Scratch', 'deep-learning'],
    ['data-science', 'Pandas Tutorial for Data Analysis', 'pandas'],
    ['sql', 'SQL Joins Explained with Examples', 'joins'],
    ['sql', 'Window Functions in PostgreSQL Tutorial', 'window-functions'],
    ['java', 'Java Streams API Tutorial', 'streams'],
    ['java', 'Spring Boot Full Course', 'spring'],
  ];
  it.each(cases)('%s: “%s” is a strong match', (modeId, title, topic) => {
    const cls = score(title, modeId);
    expect(cls.relevance).toBeGreaterThanOrEqual(0.75);
    expect(cls.topicId).toBe(topic);
  });

  it.each([
    ['java', 'JavaScript Promises Explained'],
    ['sql', 'Select your next laptop wisely'],
    ['web-dev', 'How I React to Criticism'],
    ['data-science', 'Monty Python Best Scenes'],
    ['dsa', 'Planting Trees in My Backyard'],
  ])('%s: “%s” is not relevant', (modeId, title) => {
    expect(rel(title, modeId)).toBeLessThan(0.45);
  });

  it('ranks the same titles completely differently per mode', () => {
    expect(rel('Dynamic Programming Explained', 'dsa')).toBeGreaterThanOrEqual(0.9);
    expect(rel('Dynamic Programming Explained', 'ai-ml')).toBe(0);
    expect(rel('Transformers Explained From Scratch', 'ai-ml')).toBeGreaterThanOrEqual(0.75);
    expect(rel('Transformers Explained From Scratch', 'dsa')).toBe(0);
  });
});

/* ─── Library-level behaviour ──────────────────────────────────────────────── */

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-13T00:00:00Z');

function makeLibrary(modeId: string, spec: Record<string, string[]>, ages: Record<string, number> = {}) {
  const channels: Record<string, Channel> = {};
  const videos: Record<string, VideoRecord> = {};
  for (const [name, titles] of Object.entries(spec)) {
    const id = `UC_${name}`;
    channels[id] = { id, title: name, source: 'manual', addedAt: 0, lastFetchedAt: 0, lastError: null, ignored: false };
    titles.forEach((title, i) => {
      const vid = `${name}-${i}`;
      videos[vid] = { id: vid, channelId: id, channelTitle: name, title, description: '', publishedAt: NOW - (ages[title] ?? i) * DAY, thumbnail: '', views: null };
    });
  }
  return buildModeLibrary(MODES[modeId], videos, channels);
}

describe('feed quality over quantity', () => {
  it('shows only the genuinely relevant videos instead of filling the page', () => {
    const lib = makeLibrary('ai-ml', {
      teacher: ['Transformers Explained From Scratch', 'RAG Tutorial for Beginners', 'Fine-Tuning LLMs with LoRA', 'PyTorch Deep Learning Course', 'Attention Mechanism Explained', 'Build a Neural Network'],
      mixed: ['AI Engineering Interview Experience', 'How I Became an ML Engineer', 'AI Career Roadmap', 'Why AI Startups Fail'],
      noise: Array.from({ length: 20 }, (_, i) => ['My New Laptop for AI', 'AI Changed My Life', 'Daily Vlog With AI', 'Funny AI Reaction', 'AI News Today'][i % 5] + ` #${i}`),
    });
    expect(lib.items.map((i) => i.video.channelId)).toEqual(Array(6).fill('UC_teacher'));
    expect(lib.items).toHaveLength(6);
  });

  it('sorts by relevance first, recency last', () => {
    const lib = makeLibrary('ai-ml', { ch: ['Attention Mechanism Explained', 'Machine Learning'] }, { 'Attention Mechanism Explained': 400, 'Machine Learning': 1 });
    expect(lib.items[0].video.title).toBe('Attention Mechanism Explained');
  });

  it('topic view uses the topic’s own signals', () => {
    const lib = makeLibrary('ai-ml', {
      ch: ['BERT and Attention Explained', 'Fine-Tuning LLMs Tutorial', 'PyTorch CNN Tutorial', 'Random Forest Explained', 'RAG Pipeline from Scratch'],
    });
    const llm = filterLibrary(lib, 'llms', 'best').map((i) => i.video.title);
    expect(llm).toEqual(expect.arrayContaining(['Fine-Tuning LLMs Tutorial', 'RAG Pipeline from Scratch']));
    expect(llm).not.toContain('PyTorch CNN Tutorial');
    expect(llm).not.toContain('Random Forest Explained');
  });

  it('search keeps the mode: relevance and topic agreement, not just text', () => {
    const lib = makeLibrary('ai-ml', {
      a: ['Transformers Explained From Scratch', 'Self-Attention Tutorial', 'Transformers Movie Trailer Reaction', 'PyTorch CNN Tutorial'],
    });
    const hits = searchLibrary(lib, MODES['ai-ml'], 'transformers').map((h) => h.video.title);
    expect(hits[0]).toBe('Transformers Explained From Scratch');
    expect(hits).toContain('Self-Attention Tutorial');
    expect(hits).not.toContain('Transformers Movie Trailer Reaction');
    expect(searchQueryWithContext(MODES['ai-ml'], 'transformers')).toBe('transformers machine learning');
    expect(searchQueryWithContext(MODES['ai-ml'], 'attention mechanism')).toBe('attention mechanism');
    expect(searchQueryWithContext(MODES.dsa, 'binary search')).toBe('binary search');
  });
});

describe('channel relevance ranking', () => {
  const lesson = (i: number) =>
    ['PyTorch Tutorial: Build a CNN from Scratch', 'Transformers Explained Visually', 'Gradient Descent Explained', 'Fine-Tuning LLMs Step by Step', 'Random Forest Tutorial', 'RAG Tutorial for Beginners', 'Backpropagation Explained', 'Attention Mechanism Deep Dive', 'Logistic Regression from Scratch', 'NLP Tokenization Explained'][i % 10];

  it('orders education → often-relevant tech → news → occasional → entertainment from the scores alone', () => {
    const lib = makeLibrary('ai-ml', {
      E_entertainment: ['I Survived 100 Days in the Desert', 'Funny Pranks Compilation', '$1 vs $1,000,000 Hotel', 'Reacting to Viral Videos', 'Last to Leave the Circle Wins', 'My Morning Routine', 'Giving Away a House', 'Extreme Hide and Seek'],
      D_general_tech: ['iPhone 18 Review', 'Best Laptops of 2026', 'My Desk Setup Tour', 'Is This the Future of Phones?', 'What is Machine Learning? Explained', 'Smart Home Tour', 'Foldable Phone Review', 'Tech I Regret Buying', 'Budget Camera Test', 'Charging Speed Test'],
      C_ai_news: ['OpenAI announces new GPT model', 'Google launches Gemini LLM update', 'Breaking: new transformer model released', 'This Week in AI News', 'Meta unveils open LLM', 'NVIDIA announces AI chips', 'Anthropic releases new LLM', 'GPT leak rumors', 'AI news: LLM benchmarks drop', 'DeepSeek launches reasoning model'],
      B_mostly: [lesson(0), lesson(1), lesson(2), lesson(3), lesson(4), lesson(5), 'My Reading List', 'Channel Update', 'Studio Tour', 'Answering Your Comments'],
      A_teacher: [lesson(6), lesson(7), lesson(8), lesson(9), lesson(0), lesson(1), lesson(2), lesson(3), 'Channel Update', 'Holiday Special'],
    });
    const order = lib.channels.map((c) => c.channel.title);
    expect(order).toEqual(['A_teacher', 'B_mostly', 'C_ai_news', 'D_general_tech', 'E_entertainment']);
    const kinds = Object.fromEntries(lib.channels.map((c) => [c.channel.title, c.profile.kind]));
    expect(kinds.A_teacher).toBe('educational');
    expect(kinds.B_mostly).toBe('educational');
    expect(kinds.C_ai_news).toBe('news');
    expect(['occasional', 'general']).toContain(kinds.D_general_tech);
    expect(['entertainment', 'general']).toContain(kinds.E_entertainment);
    expect(lib.profiles.UC_A_teacher.score).toBeGreaterThan(lib.profiles.UC_B_mostly.score);
    // News stays out of the learning feed.
    expect(lib.items.every((i) => i.video.channelId !== 'UC_C_ai_news')).toBe(true);
    expect(lib.newsItems.length).toBeGreaterThan(0);
  });
});

describe('classification cache', () => {
  it('reuses results, invalidates on mode edits, and round-trips through a snapshot', () => {
    clearClassificationCache();
    const m = mode('ai-ml');
    const video = { videoId: 'cache-1', title: 'Transformers Explained From Scratch' };
    ruleClassifier.classify(video, m);
    const misses = cacheMisses();
    ruleClassifier.classify(video, m);
    expect(cacheMisses()).toBe(misses);

    const snapshot = exportModeCache(m, ['cache-1']);
    expect(snapshot.fingerprint).toBe(fingerprintOf(m));
    clearClassificationCache();
    expect(hydrateModeCache(m, snapshot)).toBe(true);
    ruleClassifier.classify(video, m);
    expect(cacheMisses()).toBe(misses);

    const edited = { ...m, topics: [...m.topics, { id: 'new', name: 'New Topic', keywords: [] }] };
    expect(fingerprintOf(edited)).not.toBe(fingerprintOf(m));
    expect(hydrateModeCache(edited, snapshot)).toBe(false);
    ruleClassifier.classify(video, edited);
    expect(cacheMisses()).toBe(misses + 1);
  });
});

describe('real subscription data (frozen public feeds, 18 channels)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/real-channels.json', import.meta.url), 'utf8')) as {
    channels: { id: string; handle: string; title: string; videos: { id: string; title: string; description: string; publishedAt: number }[] }[];
  };
  const channels: Record<string, Channel> = {};
  const videos: Record<string, VideoRecord> = {};
  for (const ch of fixture.channels) {
    channels[ch.id] = { id: ch.id, title: ch.title, handle: ch.handle, source: 'manual', addedAt: 0, lastFetchedAt: 0, lastError: null, ignored: false };
    for (const v of ch.videos) videos[v.id] = { ...v, channelId: ch.id, channelTitle: ch.title, thumbnail: '', views: null };
  }
  const handleOf = (channelId: string) => channels[channelId].handle;

  it('AI / ML: a small, educational feed with teaching channels first', () => {
    const lib = buildModeLibrary(MODES['ai-ml'], videos, channels);
    expect(lib.items.length).toBeLessThan(45); // the v1 classifier showed 105 of 270
    const teaching = new Set(['@AndrejKarpathy', '@statquest', '@codebasics', '@krishnaik06', '@TechWithTim', '@sentdex']);
    expect(lib.items.slice(0, 15).every((i) => teaching.has(handleOf(i.video.channelId)!))).toBe(true);
    for (const hype of ['Changes Everything', 'End of Developers', 'ASTRA IS HERE', 'Effective Doomerism', 'Linux Tutorial']) {
      expect(lib.items.some((i) => i.video.title.includes(hype)), hype).toBe(false);
    }
    const order = lib.channels.map((c) => handleOf(c.channel.id));
    expect(order.slice(0, 2).sort()).toEqual(['@AndrejKarpathy', '@statquest']);
    expect(order.indexOf('@aiexplained-official')).toBeGreaterThan(order.indexOf('@krishnaik06'));
    expect(order.indexOf('@MrBeast')).toBe(order.length - 1);
  });

  it('DSA: completely different ranking from the same subscriptions', () => {
    const lib = buildModeLibrary(MODES.dsa, videos, channels);
    const order = lib.channels.map((c) => handleOf(c.channel.id));
    expect(order.slice(0, 3).sort()).toEqual(['@NeetCodeIO', '@abdul_bari', '@takeUforward']);
    expect(lib.items.some((i) => ['@3blue1brown', '@statquest', '@AndrejKarpathy', '@codebasics'].includes(handleOf(i.video.channelId)!))).toBe(false);
  });
});
