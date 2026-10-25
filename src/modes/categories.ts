import type { LearningMode } from '@/types/domain';
import { DEFAULT_MODES } from './templates';

/**
 * Categories for the built-in Spaces.
 *
 * Purely presentational, and deliberately so. A category is not stored on a Space, never reaches
 * `chrome.storage`, and no behaviour reads it — it exists so that a list of sixteen Spaces reads as
 * "here is the range of things FocusSpace is for" instead of a flat menu. That also means adding,
 * renaming or reordering a category cannot break a saved Space: mode ids are the only identity, and
 * they are untouched.
 *
 * A Space with no category — anything the learner made themselves — is not an error. It is grouped
 * under "Your own", which is where it belongs anyway.
 */

export interface SpaceCategory {
  id: string;
  name: string;
  /** One line, shown under the category heading where there is room for it. */
  description: string;
  /** Built-in mode ids, in the order they should be offered. */
  modeIds: readonly string[];
}

export const SPACE_CATEGORIES: readonly SpaceCategory[] = [
  {
    id: 'exams',
    name: 'Exam Prep',
    description: 'Government jobs and entrance exams, one exam at a time.',
    modeIds: ['upsc', 'ssc', 'banking', 'railways', 'state-psc', 'defence', 'teaching', 'judiciary', 'jee', 'neet', 'gate', 'cat'],
  },
  {
    id: 'engineering',
    name: 'B.Tech & Engineering',
    description: 'Your branch, year by year.',
    modeIds: ['btech'],
  },
  {
    id: 'degrees',
    name: 'College & school',
    description: 'Your course, year by year: BCA, B.Sc, B.Com, MBBS, Class 11–12.',
    modeIds: ['bca', 'bsc', 'bcom', 'mbbs', 'school'],
  },
  {
    id: 'technical',
    name: 'Tech & Engineering',
    description: 'Build things, and get through interviews.',
    modeIds: ['dsa', 'web-dev', 'ai-ml', 'data-science', 'sql', 'java', 'cloud-devops'],
  },
  {
    id: 'languages',
    name: 'Languages',
    description: 'Speak, read and write another language.',
    modeIds: ['english', 'spanish', 'french'],
  },
  {
    id: 'creative',
    name: 'Creative',
    description: 'Cameras, editing and making things people watch.',
    modeIds: ['photography', 'content-creation'],
  },
  {
    id: 'life',
    name: 'Life & Skills',
    description: 'The things worth being good at outside work.',
    modeIds: ['cooking', 'fitness', 'personal-finance'],
  },
  {
    id: 'unwind',
    name: 'Unwind',
    description: 'Downtime you chose, rather than downtime that happened.',
    modeIds: ['relax'],
  },
];

/** Where a custom Space goes. Not in SPACE_CATEGORIES: nothing is ever *offered* from it. */
export const OWN_CATEGORY: SpaceCategory = {
  id: 'own',
  name: 'Your own',
  description: 'Spaces you created.',
  modeIds: [],
};

const BY_MODE_ID = new Map<string, SpaceCategory>(SPACE_CATEGORIES.flatMap((category) => category.modeIds.map((id) => [id, category] as const)));

/** The category a mode belongs to, or null for anything the learner made themselves. */
export const categoryOf = (modeId: string): SpaceCategory | null => BY_MODE_ID.get(modeId) ?? null;

export interface CategoryGroup {
  category: SpaceCategory;
  modes: LearningMode[];
}

/**
 * Groups modes into categories, in `SPACE_CATEGORIES` order, dropping empty groups. Anything without a
 * category lands in a trailing "Your own" group — including a built-in id this file has not been
 * taught about yet, which is why nothing here throws on an unknown id.
 */
export function groupByCategory(modes: readonly LearningMode[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  const own: LearningMode[] = [];

  for (const mode of modes) {
    const category = categoryOf(mode.id);
    if (!category) {
      own.push(mode);
      continue;
    }
    const group = groups.get(category.id) ?? { category, modes: [] };
    group.modes.push(mode);
    groups.set(category.id, group);
  }

  const ordered = SPACE_CATEGORIES.map((c) => groups.get(c.id)).filter((g): g is CategoryGroup => g !== undefined);
  // Within a category, the order the category declares — not the order they happened to arrive in.
  for (const group of ordered) {
    const position = new Map(group.category.modeIds.map((id, i) => [id, i]));
    group.modes.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  }
  return own.length ? [...ordered, { category: OWN_CATEGORY, modes: own }] : ordered;
}

/** Every built-in mode id that no category claims. Empty in a healthy build — asserted by the tests. */
export const uncategorizedDefaults = (): string[] => DEFAULT_MODES.filter((m) => !BY_MODE_ID.has(m.id)).map((m) => m.id);
