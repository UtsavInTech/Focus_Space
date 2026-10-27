import { useMemo } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Route } from 'lucide-react';
import type { LearningMode, Topic } from '@/types/domain';
import { useStorage } from '@/ui/hooks';
import { groupId, isGroupId } from '@/modes/groups';

/**
 * A Space as a path: its stages in the order they are learned (System Design: Foundations → HLD
 * building blocks → HLD case studies → LLD → LLD case studies → Interview), each with its topics and
 * how many subtopics they hold. Progress comes from what was watched in each topic, and the first stage
 * not yet done is "You are here". Only shown when the Space has stages (`Topic.group`).
 */

export interface Stage {
  name: string;
  topics: Topic[];
}

/** A Space with fewer than `minStages` stages has no path (a personal Space needs two to be worth drawing). */
export function stagesOf(mode: LearningMode, minStages = 2): Stage[] {
  const out: Stage[] = [];
  for (const t of mode.topics) {
    if (!t.group) continue;
    const last = out[out.length - 1];
    if (last?.name === t.group) last.topics.push(t);
    else out.push({ name: t.group, topics: [t] });
  }
  return out.length >= minStages ? out : [];
}

const subtopicCount = (t: Topic) => t.keywords.filter((k) => !k.startsWith('~') && k !== t.name.toLowerCase()).length;
/** "2 · HLD building blocks" → number and title, for the step badge. */
const split = (stage: string) => {
  const match = /^(\d+)\s*·\s*(.+)$/.exec(stage);
  return match ? { n: match[1], title: match[2] } : { n: null, title: stage };
};

/** Finished videos per topic in this Space. */
export function useTopicProgress(modeId: string): Map<string, number> {
  const store = useStorage(['watchHistory'] as const);
  return useMemo(() => {
    const done = new Map<string, Set<string>>();
    for (const e of store?.watchHistory ?? []) {
      if (e.modeId !== modeId || !e.topicId || e.progress < 0.8) continue;
      done.set(e.topicId, (done.get(e.topicId) ?? new Set()).add(e.videoId));
    }
    return new Map([...done].map(([id, videos]) => [id, videos.size]));
  }, [store?.watchHistory, modeId]);
}

/** A topic counts as covered after two finished lessons in it. */
export const COVERED_AFTER = 2;

/**
 * The optional props let an institute course draw the same path from its own rules: progress counted by
 * the course's lessons, a topic covered when all of its lessons are done, a single subject allowed.
 * Without them, a personal Space behaves exactly as before.
 */
interface PathOptions {
  /** Finished lessons per topic, when the caller measures it differently from `useTopicProgress`. */
  progress?: Map<string, number>;
  isCovered?: (topic: Topic, done: number) => boolean;
  /** The line under each topic; subtopic count by default. */
  detail?: (topic: Topic) => string;
  minStages?: number;
  /** Where the learner last was (a topic, or a stage as "group:mains"): "You are here" follows it. */
  at?: string | null;
}

export function LearningPath({ mode, onTopic, progress: given, isCovered, detail, minStages = 2, at = null }: { mode: LearningMode; onTopic: (id: string) => void } & PathOptions) {
  const reduce = useReducedMotion();
  const stages = useMemo(() => stagesOf(mode, minStages), [mode, minStages]);
  const own = useTopicProgress(mode.id);
  const progress = given ?? own;
  if (!stages.length) return null;

  const covered = (t: Topic) => (isCovered ? isCovered(t, progress.get(t.id) ?? 0) : (progress.get(t.id) ?? 0) >= COVERED_AFTER);
  const stageDone = (s: Stage) => s.topics.every(covered);
  // The stage they went to last; with no visit yet, the first stage not yet done.
  const atTopic = at && !isGroupId(at) ? mode.topics.find((t) => t.id === at) ?? null : null;
  const visited = at ? stages.findIndex((s) => (atTopic ? s.topics.some((t) => t.id === atTopic.id) : groupId(s.name) === at)) : -1;
  const here = visited >= 0 ? visited : Math.max(0, stages.findIndex((s) => !stageDone(s)));
  const nextTopic = (atTopic && visited >= 0 ? atTopic : null) ?? stages[here].topics.find((t) => !covered(t)) ?? stages[here].topics[0];

  return (
    <section className="fs-path" aria-label={`Your path through ${mode.name}`}>
      <header className="fs-path-head">
        <h2>
          <Route size={20} aria-hidden /> Your path through {mode.name}
        </h2>
        <span className="fs-shelf-sub">
          {stages.length} stages · {mode.topics.length} topics · {mode.topics.reduce((n, t) => n + subtopicCount(t), 0)} subtopics
        </span>
        <button type="button" className="fs-cta fs-cta-primary fs-path-go" onClick={() => onTopic(nextTopic.id)}>
          {visited < 0 && here === 0 && !progress.size ? 'Start' : 'Continue'}: {nextTopic.name} <ArrowRight size={16} aria-hidden />
        </button>
      </header>
      <ol className="fs-path-steps">
        {stages.map((stage, i) => {
          const { n, title } = split(stage.name);
          const done = stageDone(stage);
          const share = stage.topics.filter(covered).length / stage.topics.length;
          return (
            <m.li
              key={stage.name}
              className={`fs-path-step${i === here ? ' is-here' : ''}${done ? ' is-done' : ''}`}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.06, ease: [0.2, 0, 0, 1] }}
            >
              <div className="fs-path-step-head">
                <span className="fs-path-num" aria-hidden>
                  {done ? <Check size={14} /> : n ?? i + 1}
                </span>
                <button type="button" className="fs-path-stage-name" onClick={() => onTopic(groupId(stage.name))} title={`Open all of ${title}`}>
                  {title}
                </button>
                {i === here && <span className="fs-path-here">You are here</span>}
              </div>
              <span className="fs-path-bar" aria-label={`${Math.round(share * 100)}% covered`}>
                <span style={{ width: `${Math.max(share * 100, 3)}%` }} />
              </span>
              <ul className="fs-path-topics">
                {stage.topics.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={`fs-path-topic${covered(t) ? ' is-covered' : ''}${i === here && t.id === nextTopic.id ? ' is-here' : ''}`} aria-current={i === here && t.id === nextTopic.id ? 'step' : undefined} onClick={() => onTopic(t.id)}>
                      {covered(t) && <Check size={12} aria-hidden />}
                      <span>{t.name}</span>
                      <small>{detail ? detail(t) : `${subtopicCount(t)} subtopics`}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </m.li>
          );
        })}
      </ol>
    </section>
  );
}

/** Inside a topic: where it sits on the path, and the way on to the next one. */
export function PathPosition({ mode, topic, onTopic }: { mode: LearningMode; topic: Topic; onTopic: (id: string) => void }) {
  const stages = stagesOf(mode);
  if (!stages.length || !topic.group) return null;
  const order = stages.flatMap((s) => s.topics);
  const at = order.findIndex((t) => t.id === topic.id);
  const prev = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const { n, title } = split(topic.group);
  return (
    <div className="fs-path-position">
      <span className="fs-path-crumb">
        <Route size={14} aria-hidden /> {n ? `Stage ${n} of ${stages.length} · ` : ''}
        {title} → <b>{topic.name}</b>
      </span>
      <span className="fs-path-nav">
        {prev && (
          <button type="button" className="fs-link" onClick={() => onTopic(prev.id)}>
            ← {prev.name}
          </button>
        )}
        {next && (
          <button type="button" className="fs-cta fs-cta-ghost fs-path-next" onClick={() => onTopic(next.id)}>
            Next: {next.name} <ArrowRight size={15} aria-hidden />
          </button>
        )}
      </span>
    </div>
  );
}
