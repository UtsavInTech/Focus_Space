import { normalizeText } from '@/learning/text';

/**
 * A topic as a short course: what it is, the whole of it, then each part in order.
 *
 *   Polity → 1 What is Polity · 2 Understand Polity · 3 Constitution · 4 Fundamental Rights · …
 *   UPSC   → 1 The UPSC syllabus and how to start · 2 …
 *
 * Each step is the best video FocusSpace has for it, never the same video twice. A step with no video
 * is left out; its subtopic is still one tap away in the subtopic row.
 */

export interface PlanVideo {
  id: string;
  title: string;
  durationSec: number | null;
  /** The words it matched in this Space ("constitution", "fundamental rights"). */
  terms: string[];
  relevance: number;
}

export type StepKind = 'intro' | 'overview' | 'part';

export interface PlanStep<V extends PlanVideo = PlanVideo> {
  kind: StepKind;
  /** "What is Polity", "Understand Polity", "Constitution". */
  label: string;
  /** For a part: the subtopic it is ("constitution"), so the step can open it. */
  subtopic: string | null;
  video: V;
}

/** Introductions, syllabus and "how to start" videos: the right first lesson. */
const INTRO = /\b(introduction|intro|syllabus|basics?|beginners?|what is|from zero|from scratch|how to (start|begin|prepare)|roadmap|overview|lecture[\s-]*0?1\b|lec[\s-]*0?1\b|chapter[\s-]*0?1\b|part[\s-]*0?1\b|day[\s-]*0?1\b)/i;
/** A whole Space's first lesson: the syllabus and how to begin, not a topic's chapter 1. */
export const SPACE_INTRO = /\b(syllabus|how to (start|begin|prepare)|preparation strategy|strategy for beginners|roadmap|beginners?'? guide|from zero|exam pattern|complete guide)\b/i;
/** The whole topic in one go. */
const WHOLE = /\b(one shot|complete|full (course|syllabus|chapter)|marathon|in one video|revision|crash course|all in one)\b/i;

const mentions = (v: PlanVideo, text: string) => {
  const want = normalizeText(text);
  return normalizeText(v.title).includes(want) || v.terms.some((t) => normalizeText(t) === want);
};

export function buildTopicPlan<V extends PlanVideo>(input: { name: string; intro?: string; introPattern?: RegExp; parts: string[]; videos: V[]; maxParts?: number }): PlanStep<V>[] {
  const { name, parts, videos, maxParts = 8 } = input;
  const used = new Set<string>();
  const best = (fit: (v: V) => boolean) => {
    const found = videos.filter((v) => !used.has(v.id) && fit(v)).sort((a, b) => b.relevance - a.relevance)[0];
    if (found) used.add(found.id);
    return found ?? null;
  };
  const steps: PlanStep<V>[] = [];
  const first = input.introPattern ?? INTRO;
  const intro = best((v) => first.test(v.title) && !WHOLE.test(v.title)) ?? best((v) => first.test(v.title));
  if (intro) steps.push({ kind: 'intro', label: input.intro ?? `What is ${name}`, subtopic: null, video: intro });
  const whole = best((v) => WHOLE.test(v.title) || (v.durationSec ?? 0) >= 3 * 3600);
  if (whole) steps.push({ kind: 'overview', label: `Understand ${name}`, subtopic: null, video: whole });
  for (const part of parts) {
    if (steps.filter((s) => s.kind === 'part').length >= maxParts) break;
    // "Indian Polity" inside Polity is the topic again, not a part of it.
    if (normalizeText(part).includes(normalizeText(name))) continue;
    const video = best((v) => mentions(v, part));
    if (video) steps.push({ kind: 'part', label: part, subtopic: part, video });
  }
  return steps;
}

/** Where the learner is: the first step not yet finished (0 when nothing is watched). */
export function currentStep(steps: { video: { id: string } }[], progress: Map<string, number>, doneAt = 0.8): number {
  const at = steps.findIndex((s) => (progress.get(s.video.id) ?? 0) < doneAt);
  return at < 0 ? Math.max(0, steps.length - 1) : at;
}

/**
 * A line worth reading between lessons. Real quotes, attributed; one per day, the same all day.
 */
export const QUOTES: { text: string; by: string }[] = [
  { text: 'Arise, awake, and stop not till the goal is reached.', by: 'Swami Vivekananda' },
  { text: 'Dream, dream, dream. Dreams transform into thoughts and thoughts result in action.', by: 'A. P. J. Abdul Kalam' },
  { text: 'Education is the most powerful weapon which you can use to change the world.', by: 'Nelson Mandela' },
  { text: 'Strength does not come from physical capacity. It comes from an indomitable will.', by: 'Mahatma Gandhi' },
  { text: 'Take up one idea. Make that one idea your life.', by: 'Swami Vivekananda' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', by: 'Will Durant' },
];

export const quoteOfTheDay = (now = Date.now()) => QUOTES[Math.floor(now / 86_400_000) % QUOTES.length];
