import type { Topic } from '@/types/domain';
import { slugify } from '@/learning/text';
import { NEET_TOPICS } from './exams';

/**
 * Learning paths: a subject as the order it is actually learned in, stage by stage, each topic with the
 * subtopics a learner works through. "How do I get from HLD to LLD?" is answered by the stages
 * themselves (Foundations → HLD building blocks → HLD case studies → LLD → LLD case studies →
 * Interview), shown on the home as a path (content/ui/home/LearningPath.tsx).
 *
 * Topic keywords double as subtopics and as relevance signals, so they are the words lessons on YouTube
 * actually use ("consistent hashing", "parking lot lld"), specific enough not to match unrelated videos.
 */

const topic = (group: string, name: string, subtopics: string[]): Topic => ({ id: slugify(name), name, group, keywords: [name.toLowerCase(), ...subtopics] });

export const SYSTEM_DESIGN_PATH: Topic[] = [
  topic('1 · Foundations', 'How the Web Works', ['client server architecture', 'dns', 'http and https', 'rest api', 'latency vs throughput', 'websockets']),
  topic('1 · Foundations', 'Scalability Basics', ['vertical scaling', 'horizontal scaling', 'high availability', 'cap theorem', 'consistency models', 'back of the envelope estimation']),
  topic('2 · HLD building blocks', 'Load Balancing', ['load balancer', 'round robin', 'consistent hashing', 'reverse proxy', 'api gateway']),
  topic('2 · HLD building blocks', 'Caching', ['caching strategies', 'redis', 'cdn', 'cache invalidation', 'write through cache', 'cache eviction']),
  topic('2 · HLD building blocks', 'Databases & Storage', ['sql vs nosql', 'database sharding', 'database replication', 'database indexing', 'partitioning', 'blob storage']),
  topic('2 · HLD building blocks', 'Messaging & Async', ['message queue', 'kafka', 'pub sub', 'event driven architecture', 'rabbitmq']),
  topic('2 · HLD building blocks', 'Microservices', ['microservices architecture', 'service discovery', 'circuit breaker', 'rate limiting', 'idempotency', 'distributed transactions']),
  topic('3 · HLD case studies', 'Design Classics', ['design url shortener', 'design rate limiter', 'design notification system', 'design news feed', 'design chat system']),
  topic('3 · HLD case studies', 'Design Real Apps', ['design youtube', 'design whatsapp', 'design uber', 'design twitter', 'design instagram', 'design netflix']),
  topic('4 · LLD foundations', 'OOP & SOLID', ['solid principles', 'oops concepts', 'uml class diagram', 'composition vs inheritance', 'low level design']),
  topic('4 · LLD foundations', 'Design Patterns', ['singleton pattern', 'factory pattern', 'strategy pattern', 'observer pattern', 'decorator pattern', 'builder pattern']),
  topic('5 · LLD case studies', 'LLD Problems', ['parking lot lld', 'elevator system design', 'snake and ladder lld', 'splitwise lld', 'bookmyshow lld', 'tic tac toe lld']),
  topic('6 · Interview', 'System Design Interview', ['system design interview', 'mock system design interview', 'how to approach system design', 'hld interview', 'lld interview']),
];

/** Built-in Spaces upgraded to a path. `legacy` are the topic names an older version gave them. */
export const CURRICULA: Record<string, { topics: Topic[]; legacy: string[] }> = {
  'system-design': {
    topics: SYSTEM_DESIGN_PATH,
    legacy: ['High Level Design', 'Low Level Design', 'Distributed Systems', 'Scalability', 'Caching', 'Microservices', 'Interview Case Studies'],
  },
  // NEET used to have one "Physics" and one "Chemistry" topic; now each is split into its parts.
  neet: { topics: NEET_TOPICS, legacy: ['Botany', 'Zoology', 'Physics', 'Chemistry'] },
};

/**
 * Brings a stored Space up to its path, without ever touching a learner's own work: topics are replaced
 * only when they are still exactly what an older version created; otherwise stages are only *labelled*
 * on topics that match a stage topic by id. Returns the topics unchanged when there is nothing to do.
 */
export function upgradeTopics(modeId: string, topics: Topic[], templateTopics?: Topic[]): Topic[] {
  const path = CURRICULA[modeId];
  if (path && topics.length && topics.every((t) => path.legacy.includes(t.name))) return structuredClone(path.topics);
  const source = path?.topics ?? templateTopics;
  if (!source || topics.some((t) => t.group)) return topics;
  const byId = new Map(source.map((t) => [t.id, t.group]));
  if (!topics.some((t) => byId.get(t.id))) return topics;
  return topics.map((t) => (byId.get(t.id) ? { ...t, group: byId.get(t.id) } : t));
}
