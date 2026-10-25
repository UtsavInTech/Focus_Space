import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from './templates';
import { inferModeIntent, modeFromSuggestion } from './intent';
import { ruleClassifier, isRelevant } from '@/learning/classifier';

const infer = (input: string) => inferModeIntent(input)!;
const names = (input: string) => infer(input).topics.map((t) => t.name);

describe('intent inference', () => {
  it('recognises built-in spaces by common names', () => {
    expect(infer('DSA').templateId).toBe('dsa');
    expect(infer('data structures and algorithms').templateId).toBe('dsa');
    expect(infer('dsa in java').templateId).toBe('dsa');
    expect(infer('Machine learning').templateId).toBe('ai-ml');
    expect(infer('react').templateId).toBe('web-dev');
    expect(infer('DSA').confidence).toBe('high');
  });

  it('understands System Design without any configuration', () => {
    const s = infer('System Design');
    expect(s.kind).toBe('learning');
    expect(names('System Design')).toEqual(expect.arrayContaining(['Scalability Basics', 'Load Balancing', 'Caching', 'Design Patterns', 'LLD Problems', 'System Design Interview']));
    // A path from HLD to LLD: stages in the order they are learned.
    expect([...new Set(s.topics.map((t) => t.group))]).toEqual(['1 · Foundations', '2 · HLD building blocks', '3 · HLD case studies', '4 · LLD foundations', '5 · LLD case studies', '6 · Interview']);
    expect(s.searchHint).toBe('system design');
  });

  it('treats "Punjabi music" as a music space, not a language course', () => {
    const s = infer('Punjabi music');
    expect(s.kind).toBe('media');
    expect(s.icon).toBe('music');
    expect(s.name).toBe('Punjabi Music');
    expect(names('Punjabi music')).toEqual(expect.arrayContaining(['Punjabi Songs', 'Punjabi Artists', 'New Releases']));
    expect(s.searchHint).toBe('punjabi songs');
    expect(infer('best lofi songs').kind).toBe('media');
  });

  it('composes language learning', () => {
    const s = infer('learn Japanese');
    expect(s.name).toBe('Learn Japanese');
    expect(s.kind).toBe('learning');
    expect(names('learn Japanese')).toContain('Grammar');
  });

  it('falls back to a generic space for anything else', () => {
    const s = infer('Pottery & Ceramics');
    expect(s.confidence).toBe('low');
    expect(s.kind).toBe('general');
    expect(s.topics.map((t) => t.name)).toEqual(['Pottery', 'Ceramics']);
    expect(infer('Pottery course').kind).toBe('learning');
    expect(inferModeIntent(' ')).toBeNull();
  });

  it('produces a space that actually recognises relevant videos', () => {
    const systemDesign = modeFromSuggestion(infer('System Design'), []);
    expect(isRelevant(ruleClassifier.classify({ videoId: 'sd1', title: 'Design a URL Shortener — System Design Interview' }, systemDesign))).toBe(true);
    expect(isRelevant(ruleClassifier.classify({ videoId: 'sd2', title: 'Caching with Redis Explained' }, systemDesign))).toBe(true);
    expect(isRelevant(ruleClassifier.classify({ videoId: 'sd3', title: 'My morning routine' }, systemDesign))).toBe(false);

    const punjabi = modeFromSuggestion(infer('Punjabi music'), []);
    expect(isRelevant(ruleClassifier.classify({ videoId: 'pm1', title: 'New Punjabi Songs 2026 | Official Video' }, punjabi))).toBe(true);
  });

  it('never collides with an existing space id', () => {
    const taken = DEFAULT_MODES.map((m) => m.id);
    const dsa = modeFromSuggestion(infer('DSA'), taken);
    expect(taken).not.toContain(dsa.id);
    expect(modeFromSuggestion(infer('DSA'), []).id).toBe('dsa');
  });
});
