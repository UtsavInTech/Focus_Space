import { describe, expect, it } from 'vitest';
import { buildTopicPlan, currentStep, quoteOfTheDay, QUOTES, SPACE_INTRO } from './topic-plan';

const v = (id: string, title: string, extra: { terms?: string[]; durationSec?: number; relevance?: number } = {}) => ({ id, title, durationSec: extra.durationSec ?? 1800, terms: extra.terms ?? [], relevance: extra.relevance ?? 0.7 });

describe('a topic as a short course', () => {
  const videos = [
    v('marathon', 'Complete Indian Polity in One Shot | UPSC', { durationSec: 6 * 3600, relevance: 0.95 }),
    v('intro', 'Introduction to Indian Polity | Lecture 1 | UPSC', { relevance: 0.8 }),
    v('const', 'Making of the Constitution | Polity Chapter 2', { terms: ['constitution'] }),
    v('fr', 'Fundamental Rights explained | UPSC Polity', { terms: ['fundamental rights'] }),
    v('fr2', 'Fundamental Rights part 2', { terms: ['fundamental rights'], relevance: 0.5 }),
  ];

  it('starts with what the topic is, then the whole of it, then each part in order', () => {
    const plan = buildTopicPlan({ name: 'Polity', parts: ['Polity', 'Indian Polity', 'Constitution', 'Fundamental Rights', 'Parliament'], videos });
    expect(plan.map((s) => [s.label, s.video.id])).toEqual([
      ['What is Polity', 'intro'],
      ['Understand Polity', 'marathon'],
      ['Constitution', 'const'],
      ['Fundamental Rights', 'fr'],
    ]);
  });

  it('never uses a video twice and leaves out parts with no video', () => {
    const plan = buildTopicPlan({ name: 'Polity', parts: ['Fundamental Rights', 'Fundamental Rights', 'Judiciary'], videos });
    const ids = plan.map((s) => s.video.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.some((s) => s.label === 'Judiciary')).toBe(false);
  });

  it('opens a whole Space on its syllabus and how to start, not a topic\'s chapter 1', () => {
    const plan = buildTopicPlan({ name: 'UPSC', introPattern: SPACE_INTRO, parts: [], videos: [v('ch1', 'Indian Polity Chapter 1 | UPSC', { relevance: 0.95 }), v('guide', 'UPSC Beginners Guide: How to Start Your Preparation', { relevance: 0.6 })] });
    expect(plan[0].video.id).toBe('guide');
  });

  it('names the first step for a whole Space', () => {
    const plan = buildTopicPlan({ name: 'UPSC', intro: 'The UPSC syllabus and how to start', parts: [], videos: [v('s', 'UPSC Syllabus explained for beginners')] });
    expect(plan[0]).toMatchObject({ kind: 'intro', label: 'The UPSC syllabus and how to start' });
  });

  it('puts the learner on the first step they have not finished', () => {
    const plan = buildTopicPlan({ name: 'Polity', parts: ['Constitution'], videos });
    expect(currentStep(plan, new Map())).toBe(0);
    expect(currentStep(plan, new Map([['intro', 1], ['marathon', 0.9]]))).toBe(2);
    expect(currentStep(plan, new Map(plan.map((s) => [s.video.id, 1])))).toBe(plan.length - 1);
  });

  it('keeps one quote all day', () => {
    const day = Date.UTC(2026, 9, 27, 3);
    expect(quoteOfTheDay(day)).toBe(quoteOfTheDay(day + 3_600_000 * 5));
    expect(QUOTES).toContain(quoteOfTheDay(day));
  });
});
