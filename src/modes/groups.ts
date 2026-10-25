import type { LearningMode, Topic } from '@/types/domain';
import { slugify } from '@/learning/text';

/**
 * Subjects: the groups a Space's topics are filed under (`Topic.group`), opened as a page of their own.
 * NEET → Chemistry is a subject; Physical, Organic and Inorganic Chemistry are its topics. A subject has
 * an id of its own ("group:chemistry") so it can be selected wherever a topic can: the sidebar, the
 * path, the topic bar.
 */

export const GROUP_PREFIX = 'group:';

export interface Subject {
  id: string;
  /** The stored group label, "2 · HLD building blocks" or "Chemistry". */
  name: string;
  /** What the learner reads: the label without its step number. */
  title: string;
  topics: Topic[];
}

export const groupId = (group: string) => `${GROUP_PREFIX}${slugify(group)}`;
export const isGroupId = (id: string | null | undefined): id is string => !!id && id.startsWith(GROUP_PREFIX);
export const groupTitle = (group: string) => group.replace(/^\d+\s*·\s*/, '');

/** The Space's subjects in the order they first appear. Topics without a group are not in any. */
export function subjectsOf(mode: LearningMode): Subject[] {
  const out = new Map<string, Subject>();
  for (const t of mode.topics) {
    if (!t.group) continue;
    const id = groupId(t.group);
    const subject = out.get(id) ?? { id, name: t.group, title: groupTitle(t.group), topics: [] };
    subject.topics.push(t);
    out.set(id, subject);
  }
  return [...out.values()];
}

export const subjectOf = (mode: LearningMode, id: string | null | undefined): Subject | null => (isGroupId(id) ? subjectsOf(mode).find((s) => s.id === id) ?? null : null);

/** The topic ids a selection covers: a subject's topics, or the one topic. */
export function scopeIds(mode: LearningMode, id: string): string[] {
  const subject = subjectOf(mode, id);
  return subject ? subject.topics.map((t) => t.id) : [id];
}

/**
 * A subject as one searchable topic: its name, with its topics standing in as subtopics. Used for the
 * subject page's YouTube searches ("organic chemistry neet", "physical chemistry neet"…).
 */
export function subjectAsTopic(subject: Subject): Topic {
  return { id: subject.id, name: subject.title, keywords: subject.topics.map((t) => t.name.toLowerCase()), group: subject.name };
}

/** The subtopics a learner works through in a topic: its keywords, minus its own name and support words. */
export const subtopicsOf = (topic: Topic) => topic.keywords.filter((k) => !k.startsWith('~') && k.trim().toLowerCase() !== topic.name.toLowerCase());

/** Topics with a subtopic added ("Chemistry → Organic → named reactions"), never twice. */
export function withSubtopic(topics: Topic[], topicId: string, subtopic: string): Topic[] {
  const k = subtopic.trim().toLowerCase();
  if (!k) return topics;
  return topics.map((t) => (t.id === topicId && !t.keywords.some((x) => x.toLowerCase() === k) ? { ...t, keywords: [...t.keywords, k] } : t));
}

/**
 * Topics with a new one added under a subject, right after that subject's last topic (or at the end,
 * as a subject of its own when `group` is new). Returns the topics and the new topic's id.
 */
export function withTopic(topics: Topic[], name: string, group?: string): { topics: Topic[]; id: string | null } {
  const clean = name.trim();
  if (!clean) return { topics, id: null };
  const existing = topics.find((t) => t.name.toLowerCase() === clean.toLowerCase() && (t.group ?? '') === (group ?? ''));
  if (existing) return { topics, id: existing.id };
  const taken = new Set(topics.map((t) => t.id));
  let id = slugify(group ? `${group}-${clean}` : clean) || 'topic';
  for (let n = 2; taken.has(id); n++) id = `${slugify(group ? `${group}-${clean}` : clean)}-${n}`;
  const topic: Topic = { id, name: clean, keywords: [clean.toLowerCase()], ...(group ? { group } : {}) };
  const last = group ? topics.map((t) => t.group).lastIndexOf(group) : -1;
  const next = last >= 0 ? [...topics.slice(0, last + 1), topic, ...topics.slice(last + 1)] : [...topics, topic];
  return { topics: next, id };
}

/**
 * A path the learner writes themselves, for a course FocusSpace has no map of (BBA, CA Inter, B.Des…):
 * one subject per line, its parts after a colon.
 *
 *   Accounting: journal entries, ledger, final accounts   → subject "Accounting" with three topics
 *   Business Law                                          → a topic under "Subjects"
 */
export function parsePath(text: string): Topic[] {
  const topics: Topic[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^[\s\-•*\d.)]+/, '').trim();
    if (!line) continue;
    const at = line.indexOf(':');
    const subject = (at >= 0 ? line.slice(0, at) : line).trim();
    const parts = at >= 0 ? line.slice(at + 1).split(/[,;]+/).map((p) => p.trim()).filter(Boolean) : [];
    if (!subject) continue;
    if (!parts.length) topics.splice(0, topics.length, ...withTopic(topics, subject, 'Subjects').topics);
    else for (const part of parts) topics.splice(0, topics.length, ...withTopic(topics, part, subject).topics);
  }
  return topics;
}
