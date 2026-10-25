import type { LearningMode, Topic } from '@/types/domain';
import type { SetupSpacePlan, SetupTurnAnswer, SetupTurnState } from '@/types/setup';
import type { IntentSuggestion } from '@/modes/intent';
import { DEFAULT_MODES, blankMode } from '@/modes/templates';
import { isSpaceIcon } from '@/modes/icons';
import { uniqueId } from '@/learning/text';

/**
 * Turning what the setup assistant understood into Spaces — kept apart from the conversation so it can
 * be tested without a browser. A built-in subject keeps its hand-curated template (topics, creators'
 * signals); anything else is built from the subtopics the assistant worked out.
 */

function uniqueTopics(topics: { name: string; keywords: string[] }[]): Topic[] {
  const seen = new Set<string>();
  const out: Topic[] = [];
  for (const t of topics) {
    const id = uniqueId(t.name, seen);
    seen.add(id);
    out.push({ id, name: t.name, keywords: t.keywords });
  }
  return out;
}

/** Most subtopics a Space starts with — enough to organise a big subject, few enough to scan. */
export const MAX_SETUP_TOPICS = 10;

const topicKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(and|the|of|to|in|for|basics?|introduction|intro)\b/g, '').replace(/\s+/g, ' ').trim();

/** The template's curated topics first (they carry tuned keywords), then the assistant's extra ones it lacks. */
export function mergeTopics(curated: Topic[], extra: { name: string; keywords: string[] }[]): Topic[] {
  const have = new Set(curated.map((t) => topicKey(t.name)));
  const additions = extra.filter((t) => {
    const key = topicKey(t.name);
    if (!key || have.has(key)) return false;
    have.add(key);
    return true;
  });
  const merged = uniqueTopics([...curated.map((t) => ({ name: t.name, keywords: t.keywords })), ...additions]).slice(0, MAX_SETUP_TOPICS);
  // Curated topics keep their original ids, so nothing that refers to them breaks.
  return merged.map((t, i) => (i < curated.length ? curated[i] : t));
}

export function modeFromPlan(plan: SetupSpacePlan, takenIds: string[], now = Date.now()): LearningMode {
  const template = plan.templateId ? DEFAULT_MODES.find((m) => m.id === plan.templateId) : undefined;
  if (template && !takenIds.includes(template.id)) {
    const base = structuredClone(template);
    return { ...base, topics: mergeTopics(base.topics, plan.topics), blockedKeywords: [...new Set([...base.blockedKeywords, ...plan.avoid])], createdAt: now, updatedAt: now };
  }
  return {
    ...blankMode(uniqueId(plan.name, takenIds), now),
    name: plan.name,
    icon: isSpaceIcon(plan.icon) ? plan.icon : 'book-open',
    kind: plan.kind,
    description: plan.description,
    topics: uniqueTopics(plan.topics).slice(0, MAX_SETUP_TOPICS),
    keywords: plan.keywords.length ? plan.keywords : [plan.name.toLowerCase()],
    searchHint: plan.searchHint || plan.name.toLowerCase(),
    blockedKeywords: plan.avoid,
    emoji: '',
  };
}

/** The offline path (modes/subjects.ts) produces intent suggestions; same result shape. */
export function planFromSuggestion(s: IntentSuggestion): SetupSpacePlan {
  return {
    name: s.name,
    templateId: s.templateId,
    icon: s.icon,
    kind: s.kind === 'institute' ? 'learning' : s.kind,
    description: s.description,
    topics: s.topics.map((t) => ({ name: t.name, keywords: t.keywords })),
    keywords: s.keywords,
    searchHint: s.searchHint,
    avoid: [],
  };
}

/** "A", "A and B", "A, B and C" — how the assistant names things out loud. */
export function spokenList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Answers to "any favourite channel?" that mean no — handled without asking the server. */
export const NO_CHANNEL = /^\s*(no+|nope|nah|na|nahi|nahin|skip|none|nothing|not really|no thanks|no one|nobody|pass|next|later|you choose|your choice|i don'?t know|dont know|idk)\b[\s.!]*$/i;

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Which of a Space's creators a spoken name refers to — "telescope" is "India Telescope Shop",
 * "apna college" is "Apna College". Exact first, then one containing the other. -1 when none.
 */
export function findChannel(titles: string[], name: string): number {
  const n = loose(name);
  if (!n) return -1;
  const exact = titles.findIndex((t) => loose(t) === n);
  if (exact !== -1) return exact;
  return titles.findIndex((t) => loose(t).includes(n) || (loose(t).length >= 4 && n.includes(loose(t))));
}

/** Without the AI's judgement: the first search result whose name matches what was said, or none. */
export function pickByName(name: string, titles: string[]): number | null {
  const i = findChannel(titles, name);
  return i === -1 ? null : i;
}

/**
 * What a turn means when FocusSpace's server can't be reached — the easy cases only: "skip" and a
 * bare name for the open creator question, subjects otherwise.
 */
export function offlineTurn(said: string, asking: SetupTurnState['asking'], subjects: (text: string) => SetupSpacePlan[]): SetupTurnAnswer {
  if (asking?.kind === 'channels') {
    if (NO_CHANNEL.test(said)) return { reply: `No problem, I’ll find the best creators for ${asking.space} myself.`, actions: [{ type: 'no_channels', space: asking.space }] };
    return { reply: `Looking that up for ${asking.space}.`, actions: [{ type: 'add_channels', space: asking.space, names: [said.trim()] }] };
  }
  const plans = subjects(said);
  if (!plans.length) return { reply: 'I couldn’t pick out a subject there. What would you like to learn? Something like System design, Spanish or Cooking.', actions: [] };
  return { reply: `Got it, ${spokenList(plans.map((p) => p.name))}. I’ll set ${plans.length === 1 ? 'that' : 'those'} up for you now.`, actions: plans.map((space) => ({ type: 'create_space', space })) };
}
