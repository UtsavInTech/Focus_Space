import { describe, expect, it } from 'vitest';
import type { LearningMode } from '@/types/domain';
import { DEFAULT_MODES } from '@/modes/templates';
import { inferModeIntent, modeFromSuggestion } from '@/modes/intent';
import { isRelevant, ruleClassifier } from '@/learning/classifier';
import { rankDiscovery, type DiscoveryCandidate } from '@/learning/discovery';
import type { YtVideo } from '@/integrations/youtube/innertube-parse';
import { offDomain, ownFamilies } from './domains';

const fromIntent = (input: string): LearningMode => modeFromSuggestion(inferModeIntent(input)!, [], 1);
const template = (id: string): LearningMode => structuredClone(DEFAULT_MODES.find((m) => m.id === id)!);
const classify = (mode: LearningMode, title: string, extra: { description?: string; channelTitle?: string } = {}) =>
  ruleClassifier.classify({ videoId: `t:${mode.id}:${title}:${extra.channelTitle ?? ''}`, title, ...extra }, mode);

describe('off-domain guard (SSC prep in a System Design Space)', () => {
  const systemDesign = fromIntent('system design');

  it('keeps real System Design lessons', () => {
    for (const title of ['System Design Interview: Design a URL Shortener', 'Consistent Hashing Explained', 'Load Balancing Tutorial for Beginners', 'Design Twitter, System Design Case Study']) {
      expect(isRelevant(classify(systemDesign, title)), title).toBe(true);
    }
  });

  it('drops exam-prep videos that borrow a system design word', () => {
    const exam = [
      'SSC CGL 2025 Computer Awareness: Operating System & Software Architecture Complete Lecture',
      'Software Architecture for SSC CHSL | Computer Knowledge Class 5',
      'UPSC Prelims: Temple Architecture | Art and Culture Full Course',
      'Distributed Systems MCQ for RRB NTPC | Railway Exam',
    ];
    for (const title of exam) expect(isRelevant(classify(systemDesign, title)), title).toBe(false);
  });

  it('drops a video from an exam-only channel even when its title is generic', () => {
    const cls = classify(systemDesign, 'Scalability Explained in Hindi', { channelTitle: 'Rojgar with Ankit' });
    expect(cls.offDomain).toBe('ssc');
    expect(isRelevant(cls)).toBe(false);
  });

  it('ignores one passing exam mention in a description, but not a stuffed tag line', () => {
    expect(offDomain({ title: 'Caching Explained', description: 'Also handy if you prepare for SSC.' }, new Set())).toBeNull();
    expect(offDomain({ title: 'Caching Explained', description: 'ssc cgl chsl upsc banking exams current affairs' }, new Set())?.where).toBe('description');
  });

  it('keeps GATE material in CS Spaces', () => {
    expect(isRelevant(classify(template('dsa'), 'GATE CS PYQ: Binary Search Tree Explained'))).toBe(true);
  });
});

describe('exam Spaces own their exam', () => {
  it('a UPSC Space keeps UPSC lessons and softens, rather than hides, sibling-exam polity lessons', () => {
    const upsc = template('upsc');
    expect(ownFamilies('upsc civil services').has('gov-general')).toBe(true);
    expect(isRelevant(classify(upsc, 'Indian Polity for UPSC Prelims: Fundamental Rights Explained'))).toBe(true);
    const sibling = classify(upsc, 'Fundamental Rights Explained for SSC CGL');
    expect(sibling.offDomain).toBe('ssc');
    expect(sibling.penalty).toBeLessThan(0.6);
  });

  it('an SSC Space keeps SSC lessons and current affairs', () => {
    const ssc = template('ssc');
    expect(isRelevant(classify(ssc, 'SSC CGL Reasoning: Coding Decoding Complete Lecture'))).toBe(true);
    expect(classify(ssc, 'Daily Current Affairs for SSC CGL').offDomain ?? null).toBeNull();
  });

  it('a JEE lecture is penalised lightly, not hidden as hard as government exam prep', () => {
    const math = template('dsa');
    const jee = classify(math, 'Dynamic Programming for JEE Main');
    const ssc = classify(math, 'Dynamic Programming for SSC CGL');
    expect(jee.penalty).toBeLessThan(ssc.penalty);
  });
});

describe('discovery needs the video’s own evidence', () => {
  const systemDesign = fromIntent('system design');
  const video = (id: string, title: string, description = ''): YtVideo =>
    ({ id, title, description, channelId: `c-${id}`, channelTitle: 'Some Channel', channelHandle: null, durationSec: 900, views: 1000, publishedAt: null, publishedText: '', isShort: false, isLive: false, watchedPercent: null }) as unknown as YtVideo;
  const none = { videoIds: new Set<string>(), channelIds: new Set<string>() };

  it('a YouTube recommendation without the subject in its title is never shown', () => {
    const candidates: DiscoveryCandidate[] = [
      { video: video('a', 'Complete Course | Lecture 1 | Full Tutorial'), query: null, fromSpaceQuery: false, topicId: null },
      { video: video('b', 'Rate Limiter System Design Tutorial'), query: null, fromSpaceQuery: false, topicId: null },
    ];
    expect(rankDiscovery(systemDesign, candidates, none).map((d) => d.video.id)).toEqual(['b']);
  });

  it('a result of the Space’s own search still needs evidence in its title or description', () => {
    const candidates: DiscoveryCandidate[] = [
      { video: video('a', 'Complete Course | Lecture 1 | Full Tutorial'), query: 'system design tutorial', fromSpaceQuery: true, topicId: null },
      { video: video('c', 'SSC CGL Complete Course Lecture 1', 'system design scalability caching'), query: 'system design tutorial', fromSpaceQuery: true, topicId: null },
    ];
    expect(rankDiscovery(systemDesign, candidates, none)).toEqual([]);
  });
});
