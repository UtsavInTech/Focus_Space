/**
 * Generic signal lexicons, deliberately separate from mode/topic configuration.
 *
 *   topic signals  (from the user's mode: what to learn)
 * + learning signals (from here: is this teaching something?)
 * - noise signals    (from here: is this entertainment, hype, lifestyle…?)
 *
 * Bump CLASSIFIER_VERSION whenever these lists or the scoring model change so
 * cached classifications are invalidated.
 */

export const CLASSIFIER_VERSION = 6;

/**
 * Terms too broad to indicate a topic by themselves ("AI Changed My Life").
 * They still count as weak supporting evidence.
 */
export const BROAD_TERMS = new Set([
  'ai',
  'a.i.',
  'ml',
  'artificial intelligence',
  'data',
  'code',
  'coding',
  'programming',
  'program',
  'technology',
  'tech',
  'computer',
  'computers',
  'software',
  'developer',
  'developers',
  'development',
  'engineer',
  'engineering',
  'app',
  'apps',
  'api',
  'apis',
  'model',
  'models',
  'algorithm',
  'algorithms',
  'database',
  'databases',
  'internet',
  'digital',
  'tool',
  'tools',
  'ts',
  'website',
  'online',
]);

/** A multi-word term made only of these tokens is also broad ("ai engineering", "ml engineer"). */
export const BROAD_TOKENS = new Set([
  ...[...BROAD_TERMS].filter((t) => !t.includes(' ')),
  'career',
  'careers',
  'job',
  'jobs',
  'future',
  'news',
  'new',
  'smart',
  'system',
  'systems',
  'generative',
  'gen',
  'the',
  'and',
  'for',
  'of',
  '&',
  '/',
]);

export type LearningStrength = 'strong' | 'medium' | 'weak';

export const LEARNING_SIGNALS: Record<LearningStrength, string[]> = {
  strong: [
    'tutorial',
    'course',
    'full course',
    'crash course',
    'lecture',
    'explained',
    'explanation',
    'clearly explained',
    'from scratch',
    'step by step',
    'walkthrough',
    'deep dive',
    'implementation',
    'implement',
    'implementing',
    'masterclass',
    'bootcamp',
    'lesson',
    'intro to',
    'introduction to',
    'spelled-out',
    'coding interview',
    // How exam-prep lessons name themselves on Indian YouTube.
    'one shot',
    'complete chapter',
    'full chapter',
  ],
  medium: [
    'guide',
    'learn',
    'how to',
    'build',
    'building',
    "let's build",
    'basics',
    'fundamentals',
    'introduction',
    'beginner',
    'for beginners',
    'roadmap',
    'interview',
    'interview questions',
    'concepts',
    'essential concepts',
    'mathematical',
    'math behind',
    'theory',
    'project',
    'hands-on',
    'practice',
    'cheat sheet',
    'what is',
    'how does',
    'how do',
    'understanding',
    'visualized',
    'visually',
    'architecture',
    'coding challenge',
    'playlist',
    'series',
    'reproduce',
    'how i use',
    'code along',
    'marathon',
    'mcq',
    'mcqs',
    'pyq',
    'pyqs',
    'previous year questions',
    'short tricks',
    'concept',
    'strategy',
    'answer writing',
  ],
  weak: ['problem', 'solution', 'solve', 'solving', 'notes', 'revision', 'career', 'how i became', 'how to become', 'skills', 'paper', 'research', 'chapter'],
};

/** Regex learning cues that aren't plain phrases: lecture numbering, LeetCode problem numbers. */
export const LEARNING_PATTERNS: { label: string; pattern: RegExp; strength: LearningStrength }[] = [
  { label: 'lecture numbering', pattern: /^\s*(?:l|lec|lecture|ep|day|video|part)?\s*[-#]?\s*\d{1,3}(?:\.\d{1,3})+[.:)\s-]/, strength: 'weak' },
  { label: 'lecture numbering', pattern: /^\s*(?:l|lec|lecture)\s*[-#]?\s*\d{1,3}[.:)\s-]/, strength: 'weak' },
  { label: 'problem walkthrough', pattern: /\bleetcode\s*#?\s*\d{1,4}\b/, strength: 'medium' },
  { label: 'series part', pattern: /\bpart\s*\d{1,2}\b/, strength: 'weak' },
];

export const LEARNING_WEIGHT: Record<LearningStrength, number> = { strong: 1, medium: 0.6, weak: 0.35 };

/** For media spaces (music, entertainment): cues that a video is the real thing, not commentary about it. */
export const MEDIA_SIGNALS: Record<LearningStrength, string[]> = {
  strong: ['official music video', 'official video', 'official audio', 'music video', 'lyric video', 'lyrical video', 'full album', 'jukebox', 'live performance', 'unplugged', 'full song'],
  medium: ['song', 'audio', 'lyrics', 'album', 'remix', 'cover', 'playlist', 'live', 'concert', 'mashup', 'acoustic', 'visualizer', 'soundtrack', 'nonstop', 'non stop'],
  weak: ['new', 'latest', 'hit', 'hits', 'ft', 'feat'],
};

/** Noise categories that are normal content for media spaces (a live concert, a new release). */
export const MEDIA_EXEMPT_NOISE: ReadonlySet<string> = new Set(['podcast', 'news'])

export type NoiseCategory = 'entertainment' | 'lifestyle' | 'hype' | 'news' | 'story' | 'podcast' | 'promo' | 'shorts';

/**
 * Noise reduces confidence; it never blocks. A podcast that is a genuine deep
 * dive on the topic keeps most of its score (see scorer.ts).
 */
export const NOISE_SIGNALS: Record<NoiseCategory, { penalty: number; terms: string[] }> = {
  entertainment: {
    penalty: 0.3,
    terms: ['reaction', 'react to', 'reacting to', 'reacts to', 'funny', 'meme', 'memes', 'roast', 'prank', 'comedy', 'gameplay', 'challenge', 'i tried', 'i tested', 'survive', 'last to leave', 'minecraft', 'fortnite'],
  },
  lifestyle: {
    penalty: 0.25,
    terms: ['vlog', 'daily vlog', 'day in the life', 'a day in', 'my life', 'routine', 'travel', 'trip', 'laptop', 'desk setup', 'setup tour', 'unboxing', 'haul', 'room tour', 'lifestyle', 'my new', 'productivity setup', 'what i eat'],
  },
  hype: {
    penalty: 0.2,
    terms: [
      'changed everything',
      'changes everything',
      'change everything',
      'changed my life',
      'is dead',
      'will replace',
      'replace you',
      'end of',
      'shocking',
      'insane',
      'crazy',
      "you won't believe",
      'scary',
      'terrifying',
      'is here',
      'out of control',
      'just broke',
      'mind blowing',
      'game changer',
      'the truth about',
      'nobody talks about',
      'stop using',
      'future',
      'worried',
      'escaping',
      "shouldn't be possible",
      'look ridiculous',
      'crossed a line',
    ],
  },
  news: {
    penalty: 0.15,
    terms: ['admit card', 'answer key', 'result out', 'notification out', 'vacancy', 'exam date', 'cut off', 'news', 'breaking', 'announces', 'announced', 'announcement', 'launches', 'launched', 'released', 'leaked', 'leak', 'first look', 'rumor', 'rumors', 'this week in', 'weekly recap', 'just dropped', 'banned', 'lawsuit', 'acquires', 'acquisition', 'arrives', 'drops', 'dropped', 'unveils', 'goes rogue', 'incident'],
  },
  story: {
    penalty: 0.2,
    terms: ['my journey', 'journey', 'my story', 'i quit', 'quit my job', 'salary', 'got hired', 'startup journey', 'life update', 'storytime', 'story time'],
  },
  podcast: { penalty: 0.1, terms: ['podcast', 'livestream', 'live stream', 'live', 'streamed', 'q&a', 'ama', 'interview with'] },
  promo: { penalty: 0.25, terms: ['enroll', 'enrollment', 'enrollments', 'final call', 'discount', 'giveaway', 'sponsored', 'limited seats', 'coupon', 'offer ends', 'launching', 'new udemy course', 'udemy', 'admissions open', 'batch starts'] },
  shorts: { penalty: 0.3, terms: ['#shorts', '#short'] },
};

/**
 * Ambiguity guards: a keyword match fully inside one of these phrases is not
 * evidence for the keyword ("full stack" is not the stack data structure).
 * A term that *is* the guard phrase (web dev's "full stack") is unaffected.
 */
export const AMBIGUITY_GUARDS = [
  'full stack',
  'fullstack',
  'tech stack',
  'mern stack',
  'mean stack',
  'ai stack',
  'software stack',
  'stack overflow',
  'family tree',
  'christmas tree',
  'decision tree',
  'decision trees',
  'graph rag',
  'knowledge graph',
  'string theory',
  'guitar string',
  'solar array',
  'youtube algorithm',
  'the algorithm',
  'transformers movie',
  'transformers one',
  'optimus prime',
  'attention span',
  'pay attention',
  'social network',
  'react to',
  'reacting to',
  'reacts to',
  'spring break',
  'spring sale',
  'role model',
  'fashion model',
  'rag doll',
  'monty python',
  'ball python',
  'join me',
  'join us',
  'join the',
  'join my',
  'join now',
  'index fund',
  'stock index',
  'threads app',
  'twitter thread',
  'coding challenge',
  // General-knowledge syllabus phrases that borrow tech words ("architecture", "computer", "system").
  'temple architecture',
  'indian architecture',
  'mughal architecture',
  'buddhist architecture',
  'architecture of india',
  'art and culture',
  'computer awareness',
  'computer knowledge',
  'solar system',
  'nervous system',
  'digestive system',
  'respiratory system',
  'circulatory system',
  'political system',
  'electoral system',
  'judicial system',
  'federal system',
  'party system',
];

/** Penalties that a clearly educational, on-topic title can soften (a podcast that is a deep dive). */
export const SOFTENABLE_NOISE: ReadonlySet<NoiseCategory> = new Set(['podcast', 'news', 'story']);

/** Regex noise cues: money-stunt titles ("$1 vs $1,000,000", "my $320/mo stack"). */
export const NOISE_PATTERNS: { label: string; pattern: RegExp; category: NoiseCategory }[] = [
  { label: 'contrarian hook', pattern: /^\s*stop \w+ing\b/, category: 'hype' },
  { label: 'stunt timeframe', pattern: /\bin (?:24|48|72) hours\b/, category: 'hype' },
  { label: 'guest conversation', pattern: /\((?:w\/?|with|ft\.?|feat\.?)\s/, category: 'podcast' },
  { label: 'money stunt', pattern: /\$\s?\d[\d,.]*\s*(?:k|m|million|billion)?\b/, category: 'hype' },
];

/** Description lines that are promotion or navigation, never topic evidence. */
export const DESCRIPTION_NOISE = /(subscribe|follow (me|us)|instagram|twitter|linkedin|discord|telegram|patreon|sponsor|affiliate|discount|coupon|use code|enroll|join (this|our|my)|membership|merch|business inquir|contact|playlist:|timestamps|chapters|https?:\/\/|www\.)/i;
