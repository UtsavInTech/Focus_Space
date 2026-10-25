export type OrgRole = 'owner' | 'admin' | 'faculty';
export type Purpose = 'progress' | 'contact';
export type Milestone = 'started' | 'half' | 'done';

export const CONSENT_VERSION = 'institute-consent-v1';

/** Milestones only ever move forward; the rank is what "forward" means. */
export const STAGE_RANK: Record<Milestone, number> = { started: 1, half: 2, done: 3 };

export interface Actor {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  emailVerified?: boolean;
}

export interface Item {
  type: 'video' | 'playlist';
  videoId?: string;
  playlistId?: string;
  membersOnly?: boolean;
  quizId?: string;
}

export interface CourseTopic {
  id: string;
  title: string;
  subtopics: string[];
  items: Item[];
}

export interface CourseSubject {
  id: string;
  title: string;
  topics: CourseTopic[];
}

export interface CoursePayload {
  brand: { name: string; logo?: string; accent?: string };
  subjects: CourseSubject[];
  approvedChannels: { id: string }[];
  modes: string[];
}

export interface Sharing {
  textVersion: string;
  progress: boolean;
  contact: boolean;
}

export interface EnrollmentInput {
  courseId?: string;
  joinCode?: string;
  phone: string;
  consents: Sharing;
}

export interface ProgressEvent {
  orgId: string;
  userId: string;
  courseId: string;
  videoId: string;
  stage: Milestone;
  seconds: number;
}

export interface PageFilter {
  courseId?: string;
  minCompletion?: number;
  minQuizScore?: number;
  after?: string;
  limit: number;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
}
