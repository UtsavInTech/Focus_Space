import type { LearningMode, SpaceKind, Topic } from '@/types/domain';
import { keywordPattern, normalizeText, slugify, uniqueId } from '@/learning/text';
import { DEFAULT_MODES, blankMode } from './templates';
import type { SpaceIconName } from './icons';

/**
 * Intent inference: "What do you want to focus on?" → a ready space.
 *
 *   input → normalise → known intent (catalogue) | composed intent (music, languages) | generic
 *         → topics, signals, search context
 *
 * Deterministic today. IntentEngine is the seam for an AI engine later; the
 * UI only depends on the interface.
 */

export interface IntentSuggestion {
  name: string;
  icon: SpaceIconName;
  kind: SpaceKind;
  description: string;
  topics: Topic[];
  keywords: string[];
  searchHint: string;
  /** Plain-language summary of what was understood, for the confirmation step. */
  understood: string[];
  /** Built-in template this came from, if any. */
  templateId: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface IntentEngine {
  readonly id: string;
  infer(input: string): IntentSuggestion | null;
}

type TopicSpec = Record<string, string[]>;

interface CatalogEntry {
  id: string;
  name: string;
  icon: SpaceIconName;
  kind: SpaceKind;
  aliases: string[];
  description: string;
  searchHint: string;
  keywords: string[];
  topics: TopicSpec | Topic[];
}

const toTopics = (spec: TopicSpec | Topic[]): Topic[] =>
  Array.isArray(spec) ? structuredClone(spec) : Object.entries(spec).map(([name, keywords]) => ({ id: slugify(name), name, keywords }));

const template = (id: string, aliases: string[]): CatalogEntry => {
  const t = DEFAULT_MODES.find((m) => m.id === id)!;
  return { id, name: t.name, icon: t.icon as SpaceIconName, kind: t.kind, aliases, description: t.description, searchHint: t.searchHint, keywords: t.keywords, topics: t.topics };
};

const CATALOG: CatalogEntry[] = [
  template('dsa', ['dsa', 'data structures', 'data structure', 'algorithms', 'data structures and algorithms', 'leetcode', 'competitive programming', 'coding interview', 'coding interviews', 'dsa in java', 'dsa in c++', 'dsa in python']),
  template('web-dev', ['web development', 'web dev', 'frontend', 'front end', 'backend', 'back end', 'full stack', 'mern', 'mern stack', 'html', 'css', 'javascript', 'react', 'nextjs', 'next.js', 'node.js']),
  template('ai-ml', ['ai', 'ml', 'ai ml', 'ai/ml', 'machine learning', 'artificial intelligence', 'deep learning', 'llm', 'llms', 'generative ai', 'gen ai', 'neural networks']),
  template('data-science', ['data science', 'data analysis', 'data analytics', 'data analyst', 'pandas', 'power bi', 'tableau']),
  template('sql', ['sql', 'dbms', 'mysql', 'postgres', 'postgresql', 'database', 'databases']),
  template('java', ['java', 'core java', 'spring boot', 'spring']),
  template('relax', ['relax', 'relaxation', 'calm', 'meditation', 'sleep', 'ambient']),
  // Exam Spaces (modes/exams.ts).
  template('upsc', ['upsc', 'upsc cse', 'ias', 'ias preparation', 'civil services', 'civil service', 'upsc prelims', 'upsc mains', 'ips']),
  template('ssc', ['ssc', 'ssc cgl', 'cgl', 'ssc chsl', 'chsl', 'ssc mts', 'ssc gd', 'ssc cpo']),
  template('banking', ['banking', 'bank exam', 'bank exams', 'banking exam', 'banking exams', 'ibps', 'ibps po', 'sbi po', 'sbi clerk', 'bank po', 'rbi grade b']),
  template('railways', ['railway', 'railways', 'railway exam', 'rrb', 'rrb ntpc', 'ntpc', 'group d']),
  template('state-psc', ['state psc', 'pcs', 'uppsc', 'bpsc', 'mppsc', 'rpsc', 'ras', 'tnpsc', 'kpsc', 'mpsc', 'wbcs']),
  template('jee', ['jee', 'jee main', 'jee mains', 'jee advanced', 'iit jee']),
  template('neet', ['neet', 'neet ug', 'medical entrance']),
  template('gate', ['gate', 'gate cse', 'gate cs', 'gate exam']),
  template('cat', ['cat exam', 'cat preparation', 'mba entrance', 'iim', 'cat mba']),
  template('defence', ['defence', 'defence exam', 'nda', 'nda exam', 'cds', 'cds exam', 'afcat', 'capf', 'agniveer', 'police exam', 'police constable', 'ssb']),
  template('teaching', ['ctet', 'tet', 'reet', 'uptet', 'kvs', 'dsssb', 'ugc net', 'teaching exam', 'teacher exam']),
  template('judiciary', ['judiciary', 'judiciary exam', 'civil judge', 'judicial services', 'pcs j']),
  template('btech', ['btech', 'b.tech', 'b tech', 'engineering degree', 'engineering college', 'btech cse', 'btech subjects', 'aktu', 'semester exams']),
  {
    id: 'system-design',
    name: 'System Design',
    icon: 'server',
    kind: 'learning',
    aliases: ['system design', 'hld', 'lld', 'high level design', 'low level design', 'distributed systems', 'software architecture'],
    description: 'Designing scalable, reliable software systems.',
    searchHint: 'system design',
    keywords: ['system design', 'distributed systems', 'scalability', 'software architecture', 'system design interview'],
    topics: {
      'High Level Design': ['hld', 'high level design'],
      'Low Level Design': ['lld', 'low level design', 'design patterns', 'object oriented design'],
      'Distributed Systems': ['distributed systems', 'cap theorem', 'consistent hashing', 'replication', 'sharding'],
      Scalability: ['scalability', 'load balancer', 'load balancing', 'horizontal scaling', 'rate limiter'],
      Caching: ['caching', 'redis', 'cdn', '~cache'],
      Microservices: ['microservices', 'api gateway', 'message queue', 'kafka', 'event driven'],
      'Interview Case Studies': ['design youtube', 'design twitter', 'design uber', 'design whatsapp', 'design instagram', 'url shortener'],
    },
  },
  {
    id: 'python',
    name: 'Python',
    icon: 'terminal',
    kind: 'learning',
    aliases: ['python', 'python programming', 'learn python'],
    description: 'Python from basics to real projects.',
    searchHint: 'python',
    keywords: ['python', 'python programming', 'python tutorial'],
    topics: {
      Basics: ['python basics', 'python for beginners', '~variables', '~loops'],
      Functions: ['functions', 'lambda', 'decorators', 'generators'],
      OOP: ['object oriented programming', 'oop', 'classes', 'inheritance'],
      'Data Structures': ['lists', 'dictionaries', 'tuples', '~sets'],
      Libraries: ['numpy', 'pandas', 'requests', 'fastapi', 'django', 'flask'],
      Projects: ['python project', 'automation', 'python projects'],
    },
  },
  {
    id: 'devops',
    name: 'DevOps & Cloud',
    icon: 'cloud',
    kind: 'learning',
    aliases: ['devops', 'cloud', 'cloud computing', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'ci/cd'],
    description: 'Shipping and running software in the cloud.',
    searchHint: 'devops',
    keywords: ['devops', 'cloud computing', 'docker', 'kubernetes', 'ci/cd', 'aws', 'azure', 'terraform'],
    topics: {
      Linux: ['linux', 'bash', 'shell scripting'],
      Docker: ['docker', 'containers', 'dockerfile'],
      Kubernetes: ['kubernetes', 'k8s', 'helm'],
      'CI/CD': ['ci/cd', 'github actions', 'jenkins', '~pipeline'],
      'AWS, Azure & GCP': ['aws', 'azure', 'gcp', 'ec2', 's3'],
      'Infrastructure as Code': ['terraform', 'ansible', 'infrastructure as code'],
      Monitoring: ['prometheus', 'grafana', 'observability', '~monitoring'],
    },
  },
  {
    id: 'cybersecurity',
    name: 'Cybersecurity',
    icon: 'shield',
    kind: 'learning',
    aliases: ['cybersecurity', 'cyber security', 'ethical hacking', 'hacking', 'infosec', 'penetration testing', 'bug bounty'],
    description: 'Security fundamentals, ethical hacking and defence.',
    searchHint: 'cybersecurity',
    keywords: ['cybersecurity', 'cyber security', 'ethical hacking', 'penetration testing', 'infosec'],
    topics: {
      Networking: ['networking basics', 'tcp/ip', 'subnetting', '~network'],
      'Web Security': ['owasp', 'xss', 'sql injection', 'csrf', 'bug bounty'],
      'Penetration Testing': ['penetration testing', 'pentesting', 'kali linux', 'metasploit', 'nmap'],
      Cryptography: ['cryptography', 'encryption', 'hashing'],
      'CTF Walkthroughs': ['ctf', 'hack the box', 'tryhackme'],
    },
  },
  {
    id: 'mobile-dev',
    name: 'App Development',
    icon: 'smartphone',
    kind: 'learning',
    aliases: ['app development', 'mobile development', 'android', 'android development', 'ios development', 'flutter', 'react native', 'swiftui', 'kotlin'],
    description: 'Building mobile apps.',
    searchHint: 'app development',
    keywords: ['app development', 'mobile app', 'android development', 'ios development'],
    topics: { Flutter: ['flutter', 'dart'], 'React Native': ['react native', 'expo'], Android: ['android', 'kotlin', 'jetpack compose'], iOS: ['swift', 'swiftui', 'xcode'], 'Publishing Apps': ['play store', 'app store'] },
  },
  {
    id: 'math',
    name: 'Mathematics',
    icon: 'calculator',
    kind: 'learning',
    aliases: ['math', 'maths', 'mathematics', 'calculus', 'linear algebra', 'discrete math', 'discrete mathematics'],
    description: 'Mathematics, from intuition to proofs.',
    searchHint: 'math',
    keywords: ['mathematics', 'maths', 'math lecture'],
    topics: { Calculus: ['calculus', 'derivatives', 'integration', 'limits'], 'Linear Algebra': ['linear algebra', 'matrices', 'eigenvalues', 'vectors'], Probability: ['probability', 'statistics', 'distributions'], 'Discrete Math': ['discrete math', 'combinatorics', 'graph theory', 'logic'] },
  },
  {
    id: 'finance',
    name: 'Personal Finance',
    icon: 'trending-up',
    kind: 'learning',
    aliases: ['finance', 'personal finance', 'investing', 'investment', 'stock market', 'share market', 'trading', 'mutual funds', 'money management'],
    description: 'Money, investing and markets.',
    searchHint: 'personal finance',
    keywords: ['personal finance', 'investing', 'stock market', 'financial planning'],
    topics: { Budgeting: ['budgeting', 'saving money', 'emergency fund'], Investing: ['investing', 'index funds', 'mutual funds', 'sip'], 'Stock Market': ['stock market', 'share market', 'stocks', 'technical analysis', 'fundamental analysis'], Taxes: ['income tax', 'tax saving'] },
  },
  {
    id: 'fitness',
    name: 'Fitness',
    icon: 'dumbbell',
    kind: 'general',
    aliases: ['fitness', 'workout', 'workouts', 'gym', 'exercise', 'yoga', 'home workout', 'weight loss', 'calisthenics', 'bodybuilding'],
    description: 'Training, mobility and nutrition.',
    searchHint: 'workout',
    keywords: ['workout', 'fitness', 'exercise', 'training program'],
    topics: {
      'Home Workouts': ['home workout', 'no equipment', 'bodyweight workout'],
      Strength: ['strength training', 'gym workout', 'weight lifting', 'hypertrophy'],
      'Yoga & Mobility': ['yoga', 'stretching', 'mobility'],
      Cardio: ['cardio', 'hiit', 'running'],
      Nutrition: ['nutrition', 'high protein', 'meal prep', '~diet'],
    },
  },
  {
    id: 'cooking',
    name: 'Cooking',
    icon: 'chef-hat',
    kind: 'general',
    aliases: ['cooking', 'recipes', 'recipe', 'baking', 'cook'],
    description: 'Recipes and kitchen skills.',
    searchHint: 'recipe',
    keywords: ['recipe', 'recipes', 'cooking', 'how to make'],
    topics: { 'Quick Meals': ['easy recipe', 'quick recipe', '15 minute meal'], Baking: ['baking', 'cake', 'bread', 'cookies'], Healthy: ['healthy recipe', 'high protein recipe', 'salad'], Techniques: ['cooking basics', 'knife skills', 'how to cook'] },
  },
  {
    id: 'chess',
    name: 'Chess',
    icon: 'crown',
    kind: 'general',
    aliases: ['chess'],
    description: 'Openings, tactics and endgames.',
    searchHint: 'chess',
    keywords: ['chess', 'chess strategy'],
    topics: { Openings: ['chess opening', 'sicilian defense', "queen's gambit", 'london system'], Tactics: ['chess tactics', 'chess puzzles', 'checkmate patterns'], Endgames: ['endgame', 'chess endgames'], 'Game Analysis': ['game analysis', 'annotated game', 'best move'] },
  },
  {
    id: 'guitar',
    name: 'Guitar',
    icon: 'guitar',
    kind: 'learning',
    aliases: ['guitar', 'learn guitar', 'guitar lessons', 'guitar lesson'],
    description: 'Learning to play guitar.',
    searchHint: 'guitar lesson',
    keywords: ['guitar lesson', 'guitar tutorial', 'learn guitar', '~guitar'],
    topics: { Chords: ['guitar chords', 'chord progression', 'barre chords'], Strumming: ['strumming pattern', 'rhythm guitar'], Fingerstyle: ['fingerstyle', 'fingerpicking'], 'Song Lessons': ['how to play', 'guitar cover lesson', 'tabs'], Theory: ['music theory', 'scales', 'pentatonic'] },
  },
  {
    id: 'photography',
    name: 'Photography',
    icon: 'camera',
    kind: 'learning',
    aliases: ['photography', 'photo editing', 'lightroom', 'videography', 'filmmaking', 'cinematography'],
    description: 'Taking and editing better photos and videos.',
    searchHint: 'photography',
    keywords: ['photography', 'photography tips', 'photo editing', 'videography'],
    topics: { Basics: ['exposure triangle', 'aperture', 'shutter speed', 'iso'], Composition: ['composition', 'rule of thirds'], Lighting: ['lighting', 'natural light'], Editing: ['lightroom', 'photoshop', 'color grading'] },
  },
];

const MUSIC_WORDS = /\b(music|songs?|singers?|artists?|playlists?|albums?|hits|jukebox|bangers)\b/i;
const GENRES = ['lofi', 'lo-fi', 'hip hop', 'rap', 'edm', 'jazz', 'classical', 'bollywood', 'k-pop', 'kpop', 'rock', 'metal', 'indie', 'sufi', 'ghazal', 'qawwali', 'devotional', 'bhajan', 'country', 'r&b', 'phonk'];
const FILLER = /\b(best|new|latest|top|old|good|some|my|favorite|favourite|the|of|and)\b/gi;
const LANGUAGES = ['english', 'spanish', 'french', 'german', 'japanese', 'korean', 'hindi', 'mandarin', 'chinese', 'italian', 'portuguese', 'arabic', 'russian', 'tamil', 'telugu', 'bengali', 'punjabi', 'urdu'];
const LEARNING_HINT = /\b(learn|learning|course|tutorials?|programming|coding|development|engineering|science|exam|preparation|prep|theory|basics|class|lectures?|study|interview|grammar|speaking)\b/i;

const titleCase = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');

const matches = (alias: string, input: string) => !!keywordPattern(alias)?.test(input);

function fromCatalog(entry: CatalogEntry, exact: boolean): IntentSuggestion {
  const topics = toTopics(entry.topics);
  return {
    name: entry.name,
    icon: entry.icon,
    kind: entry.kind,
    description: entry.description,
    topics,
    keywords: [...entry.keywords],
    searchHint: entry.searchHint,
    understood: topics.slice(0, 6).map((t) => t.name),
    templateId: DEFAULT_MODES.some((m) => m.id === entry.id) ? entry.id : null,
    confidence: exact ? 'high' : 'medium',
  };
}

function music(input: string): IntentSuggestion {
  const q = normalizeText(input.replace(MUSIC_WORDS, ' ').replace(FILLER, ' ')).replace(/\s+/g, ' ').trim();
  const Q = q ? titleCase(q) : '';
  const name = Q ? `${Q} Music` : 'Music';
  const lead = q ? `${q} ` : '';
  // Generic music cues ("official video", "live") are judged by the media scorer, not treated as topics —
  // otherwise any music video on YouTube would match a Punjabi music space.
  const generic = (words: string[]) => (q ? words.map((w) => `${lead}${w}`) : words);
  const topics = toTopics({
    [Q ? `${Q} Songs` : 'Songs']: [`${lead}song`, `${lead}songs`],
    [Q ? `${Q} Artists` : 'Artists']: [`${lead}singer`, `${lead}singers`, `${lead}artist`],
    'New Releases': [`new ${lead}song`, `latest ${lead}songs`, ...generic(['new release'])],
    'Live & Unplugged': generic(['live performance', 'unplugged', 'concert', 'live show']),
    'Playlists & Jukebox': generic(['jukebox', 'nonstop', 'mashup', 'playlist']),
  });
  return {
    name,
    icon: 'music',
    kind: 'media',
    description: Q ? `${Q} songs, artists and live performances.` : 'Songs, artists and live performances.',
    topics,
    keywords: q ? [`${q} music`, `${q} song`, `${q} songs`, `${q} singer`, `~${q}`] : ['music', 'song', 'songs'],
    searchHint: q ? `${q} songs` : 'music',
    understood: [Q ? `${Q} songs` : 'Songs', 'Singers & artists', 'New releases', 'Live & unplugged', 'Playlists'],
    templateId: null,
    confidence: 'medium',
  };
}

function language(lang: string): IntentSuggestion {
  const L = titleCase(lang);
  const topics = toTopics({
    Grammar: [`${lang} grammar`, 'grammar lesson', 'tenses'],
    Vocabulary: [`${lang} vocabulary`, 'words and phrases', 'common phrases'],
    'Speaking & Pronunciation': [`spoken ${lang}`, `${lang} speaking`, 'pronunciation', 'conversation practice'],
    Listening: [`${lang} listening practice`, 'listening practice', 'comprehensible input'],
  });
  return {
    name: `Learn ${L}`,
    icon: 'languages',
    kind: 'learning',
    description: `Grammar, vocabulary and speaking practice for ${L}.`,
    topics,
    keywords: [`learn ${lang}`, `${lang} lesson`, `${lang} for beginners`, `${lang} course`, `~${lang}`],
    searchHint: `learn ${lang}`,
    understood: topics.map((t) => t.name),
    templateId: null,
    confidence: 'medium',
  };
}

function generic(input: string): IntentSuggestion {
  const clean = input.trim().replace(/\s+/g, ' ');
  const name = titleCase(clean.replace(/^learn(ing)?\s+/i, ''));
  const learning = LEARNING_HINT.test(clean);
  const parts = clean
    .split(/,|&|\/|\+|\band\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  const topics = parts.length > 1 ? parts.map((p) => ({ id: slugify(p), name: titleCase(p), keywords: [] })) : [];
  const phrase = normalizeText(name);
  return {
    name,
    icon: learning ? 'book-open' : 'sparkles',
    kind: learning ? 'learning' : 'general',
    description: '',
    topics,
    keywords: [...new Set([phrase, ...parts.map((p) => normalizeText(p))])],
    searchHint: phrase,
    understood: [name, ...topics.map((t) => t.name)].slice(0, 5),
    templateId: null,
    confidence: 'low',
  };
}

export const deterministicIntentEngine: IntentEngine = {
  id: 'deterministic',
  infer(raw) {
    const input = normalizeText(raw).replace(/[?!.]+$/, '');
    if (input.length < 2) return null;

    // Music first: "Punjabi music" is about music, not the language.
    const genre = GENRES.find((g) => matches(g, input));
    if (MUSIC_WORDS.test(input) || (genre && input.split(' ').length <= 3 && !LEARNING_HINT.test(input))) return music(input);

    const exact = CATALOG.find((e) => e.aliases.some((a) => normalizeText(a) === input) || normalizeText(e.name) === input);
    if (exact) return fromCatalog(exact, true);

    const lang = LANGUAGES.find((l) => matches(l, input));
    if (lang && (input === lang || /\b(learn|learning|speaking|spoken|grammar|language|vocabulary|lessons?|course|ielts|toefl|jlpt)\b/.test(input))) return language(lang);

    // Longest alias contained in the input wins ("dsa in java" → DSA, not Java).
    let best: { entry: CatalogEntry; length: number } | null = null;
    for (const entry of CATALOG) {
      for (const alias of entry.aliases) {
        if (matches(alias, input) && (!best || alias.length > best.length)) best = { entry, length: alias.length };
      }
    }
    if (best && best.length >= Math.min(input.length * 0.4, 4)) return fromCatalog(best.entry, false);
    return generic(raw);
  },
};

let engine: IntentEngine = deterministicIntentEngine;
export const getIntentEngine = () => engine;
export const setIntentEngine = (next: IntentEngine) => {
  engine = next;
};

export const inferModeIntent = (input: string) => engine.infer(input);

/** Every subject phrase the catalogue recognises — for correcting a misspelt or misheard one (./subjects.ts). */
export const knownSubjectPhrases = (): string[] => [...new Set([...CATALOG.flatMap((e) => [normalizeText(e.name), ...e.aliases.map(normalizeText)]), ...LANGUAGES])];

/** Quick-start suggestions shown before the user types. */
export const STARTER_INTENTS = ['DSA', 'AI / ML', 'Web Development', 'System Design', 'Data Science', 'Punjabi music', 'Fitness', 'Learn Japanese'];

/** Turn an (optionally edited) suggestion into a stored space. */
export function modeFromSuggestion(s: IntentSuggestion, takenIds: string[], now = Date.now()): LearningMode {
  const id = s.templateId && !takenIds.includes(s.templateId) ? s.templateId : uniqueId(s.name, takenIds);
  const templateMode = s.templateId ? DEFAULT_MODES.find((m) => m.id === s.templateId) : undefined;
  const base = templateMode ? structuredClone(templateMode) : blankMode(id, now);
  return {
    ...base,
    id,
    name: s.name,
    icon: s.icon,
    kind: s.kind,
    description: s.description,
    topics: s.topics,
    keywords: s.keywords,
    searchHint: s.searchHint,
    emoji: '',
    createdAt: now,
    updatedAt: now,
  };
}
