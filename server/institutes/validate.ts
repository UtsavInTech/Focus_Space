import { ApiError } from '../http';
import { CONSENT_VERSION, type CourseSubject, type CourseTopic, type CoursePayload, type EnrollmentInput, type Item, type PageFilter, type Sharing, type QuizQuestion } from './types';

/** A whole course, across every subject and topic. */
const MAX_COURSE_ITEMS = 5000;

export const invalid = (message: string): never => {
  throw new ApiError(400, 'invalid_request', message);
};

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

export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid('Consent choices must be true or false.');
  return value;
}

export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(`Invalid ${label}.`);
  return value;
}

export function https(value: unknown): string {
  const result = text(value, 'HTTPS URL', 1000);
  try {
    const url = new URL(result);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    /* invalid */
  }
  return invalid('An HTTPS URL without credentials is required.');
}

/** Both choices must be explicit booleans — consent is never inferred from a missing or truthy value. */
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
  return {
    courseId: value.courseId === undefined ? undefined : id(value.courseId),
    joinCode,
    phone: phone(value.phone),
    consents: sharing(value.consents),
  };
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

function brand(raw: unknown): CoursePayload['brand'] {
  const value = object(raw);
  const accent = (): string => (/^#[\da-fA-F]{6}$/.test(String(value.accent)) ? String(value.accent) : invalid('Invalid accent colour.'));
  return {
    name: text(value.name, 'brand name'),
    ...(value.logo === undefined ? {} : { logo: https(value.logo) }),
    ...(value.accent === undefined ? {} : { accent: accent() }),
  };
}

/**
 * Validates and rebuilds a course payload. Ids must be unique across the whole course, and the item
 * count is shared by every topic, so one walker carries that state through subjects → topics → items.
 */
class PayloadReader {
  private items = 0;
  private subjectIds = new Set<string>();
  private topicIds = new Set<string>();

  subject(raw: unknown): CourseSubject {
    const value = object(raw);
    const subjectId = id(value.id);
    if (this.subjectIds.has(subjectId)) return invalid('Subject ids must be unique.');
    this.subjectIds.add(subjectId);
    return {
      id: subjectId,
      title: text(value.title, 'subject title'),
      topics: list(value.topics, 'topics', 200).map((topic) => this.topic(topic)),
    };
  }

  private topic(raw: unknown): CourseTopic {
    const value = object(raw);
    const topicId = id(value.id);
    if (this.topicIds.has(topicId)) return invalid('Topic ids must be unique.');
    this.topicIds.add(topicId);
    return {
      id: topicId,
      title: text(value.title, 'topic title'),
      subtopics: list(value.subtopics ?? [], 'subtopics', 100).map((subtopic) => text(subtopic, 'subtopic')),
      items: list(value.items, 'course items', 1000).map((item) => this.item(item)),
    };
  }

  private item(raw: unknown): Item {
    if (++this.items > MAX_COURSE_ITEMS) return invalid('A course may contain at most 5000 items.');
    const value = object(raw);
    if (value.type !== 'video' && value.type !== 'playlist') return invalid('Unknown item type.');
    if (value.membersOnly !== undefined && typeof value.membersOnly !== 'boolean') return invalid('Invalid membersOnly.');
    // Whitelist output fields: neither answers nor arbitrary remote code/URLs enter published JSON.
    return {
      type: value.type,
      ...(value.type === 'video' ? { videoId: video(value.videoId) } : { playlistId: id(value.playlistId) }),
      ...(value.membersOnly === undefined ? {} : { membersOnly: value.membersOnly }),
      ...(value.quizId === undefined ? {} : { quizId: id(value.quizId) }),
    };
  }
}

export function payload(raw: unknown): CoursePayload {
  const value = object(raw);
  const branding = brand(value.brand);
  const reader = new PayloadReader();
  return {
    brand: branding,
    subjects: list(value.subjects, 'subjects', 100).map((subject) => reader.subject(subject)),
    approvedChannels: list(value.approvedChannels, 'approved channels', 100).map((approved) => ({ id: channel(object(approved).id) })),
    modes: list(value.modes ?? [], 'modes', 20).map((mode) => text(mode, 'mode', 50)),
  };
}

function quizQuestion(raw: unknown): QuizQuestion {
  const value = object(raw);
  const options = list(value.options, 'options', 6).map((option) => text(option, 'option', 1000));
  if (options.length < 2) return invalid('At least two options are required.');
  return { question: text(value.question, 'question', 2000), options, answer: integer(value.answer, 'answer', 0, options.length - 1) };
}

export function quiz(raw: unknown): QuizQuestion[] {
  const questions = list(raw, 'quiz questions', 50);
  if (!questions.length) return invalid('At least one question is required.');
  return questions.map(quizQuestion);
}

export function page(query: URLSearchParams): PageFilter {
  const number = (key: string, max: number) => (query.has(key) ? integer(Number(query.get(key)), key, 0, max) : undefined);
  const limit = query.has('limit') ? integer(Number(query.get('limit')), 'limit', 1, 500) : 100;
  return {
    courseId: query.has('courseId') ? id(query.get('courseId')) : undefined,
    after: query.has('after') ? id(query.get('after')) : undefined,
    minCompletion: number('minCompletion', 100),
    minQuizScore: number('minQuizScore', 100),
    limit,
  };
}
