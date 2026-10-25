import { ApiError } from '../http';
import { CONSENT_VERSION, type CoursePayload, type EnrollmentInput, type PageFilter, type Sharing, type QuizQuestion } from './types';
export const invalid = (message: string): never => { throw new ApiError(400, 'invalid_request', message); };
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Expected a JSON object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) return invalid(`Invalid ${label}.`);
  return value.trim();
}
export function id(value: unknown): string {
  const result = text(value, 'id', 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) return invalid('Invalid id.');
  return result;
}
export function phone(value: unknown): string {
  let result = text(value, 'Indian mobile number', 16);
  if (/^[6-9]\d{9}$/.test(result)) result = `+91${result}`;
  if (!/^\+91[6-9]\d{9}$/.test(result)) return invalid('Enter a valid Indian mobile number.');
  return result;
}
export function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid('Consent choices must be true or false.'); return value; }
export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(`Invalid ${label}.`);
  return value;
}
export function https(value: unknown): string {
  const result = text(value, 'HTTPS URL', 1000);
  try { const url = new URL(result); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch { /* invalid */ }
  return invalid('An HTTPS URL without credentials is required.');
}
export function sharing(raw: unknown): Sharing {
  const value = object(raw);
  if (value.textVersion !== CONSENT_VERSION) return invalid('Review the current consent notice before continuing.');
  return { textVersion: CONSENT_VERSION, progress: boolean(value.progress), contact: boolean(value.contact) };
}
export function enrollment(raw: unknown): EnrollmentInput {
  const value = object(raw);
  if (!!value.courseId === !!value.joinCode) return invalid('Use either a course id or a join code.');
  const joinCode = value.joinCode === undefined ? undefined : text(value.joinCode, 'join code', 100);
  if (joinCode && !/^[\w-]{10,100}$/.test(joinCode)) return invalid('Invalid join code.');
  return { courseId: value.courseId === undefined ? undefined : id(value.courseId), joinCode, phone: phone(value.phone), consents: sharing(value.consents) };
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid(`Invalid ${label}.`);
  return value;
}
export function channel(value: unknown): string {
  const result = text(value, 'channel id', 24);
  if (!/^UC[\w-]{22}$/.test(result)) return invalid('Use a YouTube channel id.');
  return result;
}
export function video(value: unknown): string {
  const result = text(value, 'video id', 11);
  if (!/^[\w-]{11}$/.test(result)) return invalid('Invalid video id.');
  return result;
}
export function payload(raw: unknown): CoursePayload {
  const value = object(raw), brand = object(value.brand);
  let count = 0;
  const subjectIds = new Set<string>(), topicIds = new Set<string>();
  return {
    brand: { name: text(brand.name, 'brand name'), ...(brand.logo === undefined ? {} : { logo: https(brand.logo) }), ...(brand.accent === undefined ? {} : { accent: /^#[\da-fA-F]{6}$/.test(String(brand.accent)) ? String(brand.accent) : invalid('Invalid accent colour.') }) },
    subjects: list(value.subjects, 'subjects', 100).map(rawSubject => {
      const subject = object(rawSubject), subjectId = id(subject.id);
      if (subjectIds.has(subjectId)) return invalid('Subject ids must be unique.'); subjectIds.add(subjectId);
      return { id: subjectId, title: text(subject.title, 'subject title'), topics: list(subject.topics, 'topics', 200).map(rawTopic => {
        const topic = object(rawTopic), topicId = id(topic.id);
        if (topicIds.has(topicId)) return invalid('Topic ids must be unique.'); topicIds.add(topicId);
        return { id: topicId, title: text(topic.title, 'topic title'), subtopics: list(topic.subtopics ?? [], 'subtopics', 100).map(t => text(t, 'subtopic')), items: list(topic.items, 'course items', 1000).map(rawItem => {
          if (++count > 5000) return invalid('A course may contain at most 5000 items.');
          const item = object(rawItem);
          if (item.type !== 'video' && item.type !== 'playlist') return invalid('Unknown item type.');
          if (item.membersOnly !== undefined && typeof item.membersOnly !== 'boolean') return invalid('Invalid membersOnly.');
          // Whitelist output fields: neither answers nor arbitrary remote code/URLs enter published JSON.
          return { type: item.type, ...(item.type === 'video' ? { videoId: video(item.videoId) } : { playlistId: id(item.playlistId) }), ...(item.membersOnly === undefined ? {} : { membersOnly: item.membersOnly }), ...(item.quizId === undefined ? {} : { quizId: id(item.quizId) }) };
        }) };
      }) };
    }),
    approvedChannels: list(value.approvedChannels, 'approved channels', 100).map(c => ({ id: channel(object(c).id) })),
    modes: list(value.modes ?? [], 'modes', 20).map(m => text(m, 'mode', 50)),
  };
}
export function quiz(raw: unknown): QuizQuestion[] {
  const questions = list(raw, 'quiz questions', 50);
  if (!questions.length) return invalid('At least one question is required.');
  return questions.map(q => {
    const item = object(q), options = list(item.options, 'options', 6).map(o => text(o, 'option', 1000));
    if (options.length < 2) return invalid('At least two options are required.');
    return { question: text(item.question, 'question', 2000), options, answer: integer(item.answer, 'answer', 0, options.length - 1) };
  });
}
export function page(query: URLSearchParams): PageFilter {
  const number = (key: string, max: number) => query.has(key) ? integer(Number(query.get(key)), key, 0, max) : undefined;
  const limit = query.has('limit') ? integer(Number(query.get('limit')), 'limit', 1, 500) : 100;
  return { courseId: query.has('courseId') ? id(query.get('courseId')) : undefined, after: query.has('after') ? id(query.get('after')) : undefined, minCompletion: number('minCompletion', 100), minQuizScore: number('minQuizScore', 100), limit };
}
