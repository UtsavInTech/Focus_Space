import type { LearningMode, Topic } from '@/types/domain';
import type { SpaceIconName } from './icons';

/**
 * Exam Spaces: "Which exam are you preparing for?" is the first thing FocusSpace asks, and the answer
 * shapes the whole of YouTube around that exam — its subjects as topics, its vocabulary as relevance
 * signals, its searches as discovery.
 *
 * Every exam names itself in its keywords ("upsc", "ssc cgl"…). That is what makes it the Space's
 * *own* exam family for the off-domain guard (learning/relevance/domains.ts): a UPSC Space keeps UPSC
 * lessons and current affairs, softens SSC ones, and every non-exam Space drops them all.
 *
 * Kept apart from templates.ts so templates.ts stays the general catalogue; DEFAULT_MODES includes these.
 */

export type ExamId = 'upsc' | 'ssc' | 'banking' | 'railways' | 'state-psc' | 'jee' | 'neet' | 'gate' | 'cat';

export interface ExamInfo {
  id: ExamId;
  /** What the learner reads on the picker. */
  label: string;
  /** One line under the label: which papers it covers. */
  covers: string;
  icon: SpaceIconName;
}

export const EXAMS: readonly ExamInfo[] = [
  { id: 'upsc', label: 'UPSC CSE', covers: 'IAS · IPS · Prelims & Mains', icon: 'landmark' },
  { id: 'ssc', label: 'SSC', covers: 'CGL · CHSL · MTS · GD', icon: 'file-text' },
  { id: 'banking', label: 'Banking', covers: 'IBPS · SBI PO & Clerk · RBI', icon: 'banknote' },
  { id: 'railways', label: 'Railways', covers: 'RRB NTPC · Group D · ALP', icon: 'train' },
  { id: 'state-psc', label: 'State PSC', covers: 'UPPSC · BPSC · MPPSC · RPSC…', icon: 'map' },
  { id: 'jee', label: 'JEE', covers: 'Main & Advanced', icon: 'atom' },
  { id: 'neet', label: 'NEET', covers: 'NEET UG · Biology, Physics, Chemistry', icon: 'stethoscope' },
  { id: 'gate', label: 'GATE', covers: 'CSE · core CS & engineering maths', icon: 'cpu' },
  { id: 'cat', label: 'CAT', covers: 'MBA entrance · QA · DILR · VARC', icon: 'briefcase' },
];

export const EXAM_IDS: ReadonlySet<string> = new Set(EXAMS.map((e) => e.id));
export const isExamId = (id: unknown): id is ExamId => typeof id === 'string' && EXAM_IDS.has(id);
export const examInfo = (id: string | null | undefined): ExamInfo | null => EXAMS.find((e) => e.id === id) ?? null;

const t = (id: string, name: string, keywords: string[] = []): Topic => ({ id, name, keywords });

type ExamTemplate = Pick<LearningMode, 'name' | 'description' | 'searchHint' | 'keywords' | 'topics'> & { id: ExamId; emoji: string };

const exam = (m: ExamTemplate): LearningMode => ({
  kind: 'learning',
  discovery: true,
  icon: examInfo(m.id)!.icon,
  blockedKeywords: ['prank', 'roast', 'motivational status'],
  allowedChannels: [],
  blockedChannels: [],
  dailyLimitMinutes: 180,
  filterOverride: null,
  createdAt: 0,
  updatedAt: 0,
  ...m,
});

export const EXAM_MODES: LearningMode[] = [
  exam({
    id: 'upsc',
    name: 'UPSC',
    emoji: '🏛️',
    description: 'Civil Services: Prelims, Mains and the optional, one subject at a time.',
    searchHint: 'upsc',
    keywords: ['upsc', 'upsc cse', 'civil services', 'ias', 'ias preparation', 'upsc prelims', 'upsc mains', 'gs paper', 'current affairs', 'answer writing', 'ncert'],
    topics: [
      t('polity', 'Polity', ['indian polity', 'polity', 'constitution', 'fundamental rights', 'directive principles', 'parliament', 'judiciary', 'laxmikanth', 'preamble', 'constitutional amendment']),
      t('history', 'History', ['modern history', 'ancient history', 'medieval history', 'freedom struggle', 'indian national movement', 'spectrum', 'mughal empire', 'harappan civilization']),
      t('art-culture', 'Art & Culture', ['art and culture', 'temple architecture', 'indian art', 'classical dance', 'indian paintings']),
      t('geography', 'Geography', ['indian geography', 'world geography', 'physical geography', 'monsoon', 'climatology', 'geomorphology', 'mapping']),
      t('economy', 'Economy', ['indian economy', 'economy', 'budget', 'economic survey', 'monetary policy', 'inflation', 'fiscal policy', 'gdp']),
      t('environment', 'Environment', ['environment', 'ecology', 'biodiversity', 'climate change', 'shankar ias']),
      t('science-tech', 'Science & Tech', ['science and technology', 'space technology', 'biotechnology', 'defence technology']),
      t('ir', 'International Relations', ['international relations', 'foreign policy', 'india china', 'geopolitics']),
      t('ethics', 'Ethics (GS 4)', ['ethics', 'gs 4', 'integrity', 'case studies ethics', 'aptitude and ethics']),
      t('current-affairs', 'Current Affairs', ['current affairs', 'the hindu analysis', 'daily news analysis', 'pib', 'editorial analysis', 'monthly current affairs']),
      t('csat', 'CSAT', ['csat', 'reading comprehension', 'logical reasoning']),
      t('mains-writing', 'Mains & Essay', ['answer writing', 'essay paper', 'mains answer', 'upsc mains']),
    ],
  }),
  exam({
    id: 'ssc',
    name: 'SSC',
    emoji: '📝',
    description: 'SSC CGL, CHSL, MTS and GD: quant, reasoning, English and general awareness.',
    searchHint: 'ssc cgl',
    keywords: ['ssc', 'ssc cgl', 'cgl', 'ssc chsl', 'chsl', 'ssc mts', 'ssc gd', 'ssc cpo', 'current affairs', 'general awareness', 'static gk'],
    topics: [
      t('quant', 'Quant (Maths)', ['quantitative aptitude', 'maths', 'percentage', 'profit and loss', 'simple interest', 'compound interest', 'time and work', 'time speed distance', 'algebra', 'geometry', 'trigonometry', 'mensuration', 'number system', 'ratio and proportion', 'average']),
      t('reasoning', 'Reasoning', ['reasoning', 'coding decoding', 'blood relation', 'syllogism', 'number series', 'alphabet series', 'analogy', 'non verbal reasoning', 'direction sense', 'seating arrangement', 'puzzle']),
      t('english', 'English', ['english grammar', 'vocabulary', 'one word substitution', 'idioms and phrases', 'error spotting', 'cloze test', 'synonyms antonyms', 'reading comprehension']),
      t('ga', 'General Awareness', ['general awareness', 'static gk', 'gk', 'history gk', 'polity gk', 'geography gk', 'science gk', 'economics gk']),
      t('current-affairs', 'Current Affairs', ['current affairs', 'monthly current affairs', 'daily current affairs']),
      t('computer', 'Computer Knowledge', ['computer awareness', 'computer knowledge', 'ms office', 'ms excel']),
    ],
  }),
  exam({
    id: 'banking',
    name: 'Banking',
    emoji: '🏦',
    description: 'IBPS, SBI PO & Clerk and RBI: speed maths, puzzles, English and banking awareness.',
    searchHint: 'bank exam',
    keywords: ['banking exam', 'banking exams', 'bank exam', 'ibps', 'ibps po', 'ibps clerk', 'sbi po', 'sbi clerk', 'bank po', 'rbi grade b', 'rbi assistant', 'rrb po', 'rrb clerk', 'nabard', 'current affairs'],
    topics: [
      t('quant', 'Quant & DI', ['data interpretation', 'quantitative aptitude', 'simplification', 'approximation', 'quadratic equation', 'number series', 'arithmetic']),
      t('reasoning', 'Reasoning & Puzzles', ['puzzle', 'puzzles', 'seating arrangement', 'syllogism', 'inequality', 'blood relation', 'coding decoding', 'input output']),
      t('english', 'English', ['reading comprehension', 'cloze test', 'error detection', 'para jumbles', 'english for bank']),
      t('banking-awareness', 'Banking Awareness', ['banking awareness', 'financial awareness', 'rbi', 'monetary policy', 'banking terms']),
      t('current-affairs', 'Current Affairs', ['current affairs', 'banking current affairs', 'monthly current affairs']),
      t('interview', 'Interview & Descriptive', ['bank interview', 'descriptive writing', 'essay writing', 'letter writing']),
    ],
  }),
  exam({
    id: 'railways',
    name: 'Railways',
    emoji: '🚆',
    description: 'RRB NTPC, Group D and ALP: maths, reasoning, general science and GK.',
    searchHint: 'rrb ntpc',
    keywords: ['rrb', 'rrb ntpc', 'ntpc', 'group d', 'rrb group d', 'rrb alp', 'rrb je', 'railway exam', 'railway exams', 'current affairs', 'general awareness'],
    topics: [
      t('maths', 'Mathematics', ['maths', 'percentage', 'time and work', 'simplification', 'number system', 'profit and loss', 'mensuration']),
      t('reasoning', 'Reasoning', ['reasoning', 'coding decoding', 'number series', 'analogy', 'blood relation', 'syllogism']),
      t('science', 'General Science', ['general science', 'physics', 'chemistry', 'biology', 'science gk']),
      t('ga', 'General Awareness', ['general awareness', 'static gk', 'gk', 'railway gk']),
      t('current-affairs', 'Current Affairs', ['current affairs', 'monthly current affairs']),
    ],
  }),
  exam({
    id: 'state-psc',
    name: 'State PSC',
    emoji: '🗺️',
    description: 'State civil services: GS, the state’s own history and geography, and current affairs.',
    searchHint: 'state psc',
    keywords: ['state psc', 'pcs exam', 'uppsc', 'uppcs', 'bpsc', 'mppsc', 'rpsc', 'ras', 'tnpsc', 'kpsc', 'appsc', 'tspsc', 'mpsc', 'gpsc', 'wbcs', 'cgpsc', 'jpsc', 'hpsc', 'ukpsc', 'ro aro', 'current affairs'],
    topics: [
      t('polity', 'Polity', ['indian polity', 'polity', 'constitution', 'fundamental rights', 'panchayati raj']),
      t('history', 'History', ['modern history', 'ancient history', 'medieval history', 'freedom struggle']),
      t('geography', 'Geography', ['indian geography', 'physical geography']),
      t('economy', 'Economy', ['indian economy', 'economy', 'budget']),
      t('state-gk', 'State GK', ['state gk', 'up gk', 'bihar gk', 'mp gk', 'rajasthan gk', 'state special']),
      t('current-affairs', 'Current Affairs', ['current affairs', 'state current affairs', 'monthly current affairs']),
    ],
  }),
  exam({
    id: 'jee',
    name: 'JEE',
    emoji: '⚛️',
    description: 'JEE Main and Advanced: physics, chemistry and maths, concept to problem.',
    searchHint: 'jee',
    keywords: ['jee', 'jee main', 'jee mains', 'jee advanced', 'iit jee', '~class 11', '~class 12', '~ncert'],
    topics: [
      t('physics', 'Physics', ['physics', 'kinematics', 'laws of motion', 'rotational motion', 'electrostatics', 'current electricity', 'magnetism', 'optics', 'modern physics', 'thermodynamics', 'waves']),
      t('physical-chem', 'Physical Chemistry', ['physical chemistry', 'mole concept', 'chemical equilibrium', 'ionic equilibrium', 'electrochemistry', 'chemical kinetics', 'thermochemistry']),
      t('organic-chem', 'Organic Chemistry', ['organic chemistry', 'goc', 'hydrocarbons', 'reaction mechanism', 'isomerism', 'named reactions']),
      t('inorganic-chem', 'Inorganic Chemistry', ['inorganic chemistry', 'periodic table', 'chemical bonding', 'coordination compounds', 'p block', 'd block']),
      t('maths', 'Mathematics', ['calculus', 'limits', 'differentiation', 'integration', 'matrices', 'determinants', 'vectors', '3d geometry', 'coordinate geometry', 'complex numbers', 'probability', 'sequence and series', 'binomial theorem', 'conic sections']),
    ],
  }),
  exam({
    id: 'neet',
    name: 'NEET',
    emoji: '🩺',
    description: 'NEET UG: biology first, then physics and chemistry, NCERT line by line.',
    searchHint: 'neet',
    keywords: ['neet', 'neet ug', 'neet 2026', '~ncert', '~class 11', '~class 12', 'ncert biology'],
    topics: [
      t('botany', 'Botany', ['botany', 'plant physiology', 'plant kingdom', 'photosynthesis', 'cell cycle', 'molecular basis of inheritance', 'genetics', 'ecology']),
      t('zoology', 'Zoology', ['zoology', 'human physiology', 'animal kingdom', 'human reproduction', 'biotechnology', 'evolution', 'human health and disease', 'structural organisation']),
      t('physics', 'Physics', ['physics', 'kinematics', 'laws of motion', 'electrostatics', 'current electricity', 'optics', 'modern physics', 'thermodynamics']),
      t('chemistry', 'Chemistry', ['chemistry', 'organic chemistry', 'inorganic chemistry', 'physical chemistry', 'mole concept', 'chemical bonding', 'goc']),
    ],
  }),
  exam({
    id: 'gate',
    // "GATE CSE", not "GATE": the name is a keyword, and "gate" alone also finds Bill Gates.
    name: 'GATE CSE',
    emoji: '🎓',
    description: 'GATE CSE: core computer science, engineering maths and aptitude.',
    searchHint: 'gate cse',
    keywords: ['gate cse', 'gate cs', 'gate exam', 'gate 2026', 'gate 2027', 'gate preparation', 'gate pyq', 'gate computer science'],
    topics: [
      t('os', 'Operating Systems', ['operating system', 'operating systems', 'process scheduling', 'deadlock', 'paging', 'virtual memory', 'semaphore', 'cpu scheduling']),
      t('dbms', 'DBMS', ['dbms', 'normalization', 'sql', 'er model', 'transactions', 'indexing', 'relational algebra']),
      t('cn', 'Computer Networks', ['computer networks', 'osi model', 'tcp/ip', 'subnetting', 'routing', 'ip addressing', 'flow control']),
      t('toc', 'Theory of Computation', ['theory of computation', 'toc', 'finite automata', 'regular expression', 'context free grammar', 'turing machine', 'dfa', 'nfa']),
      t('compiler', 'Compiler Design', ['compiler design', 'parsing', 'lexical analysis', 'syntax directed translation', 'lr parser']),
      t('coa', 'Computer Organization', ['computer organization', 'coa', 'pipelining', 'cache memory', 'addressing modes']),
      t('digital', 'Digital Logic', ['digital logic', 'boolean algebra', 'k map', 'flip flop', 'combinational circuits']),
      t('dsa', 'Data Structures & Algorithms', ['data structures', 'algorithms', 'time complexity', 'sorting', 'graph algorithms', 'dynamic programming', 'binary tree']),
      t('maths', 'Engineering Maths', ['engineering mathematics', 'discrete mathematics', 'linear algebra', 'probability', 'graph theory', 'set theory']),
      t('aptitude', 'General Aptitude', ['general aptitude', 'verbal ability', 'numerical ability']),
    ],
  }),
  exam({
    id: 'cat',
    // Never just "CAT": the Space's name is itself a keyword, and YouTube has a great many cats.
    name: 'CAT & MBA',
    emoji: '💼',
    description: 'CAT and MBA entrances: quant, DILR and verbal ability.',
    searchHint: 'cat exam',
    keywords: ['cat exam', 'cat preparation', 'cat 2026', 'cat quant', 'cat varc', 'cat dilr', 'mba entrance', 'iim', 'xat', 'nmat'],
    topics: [
      t('qa', 'Quantitative Ability', ['quantitative ability', 'arithmetic', 'algebra', 'geometry', 'number system', 'percentages', 'time speed distance', 'modern math']),
      t('dilr', 'DILR', ['dilr', 'data interpretation', 'logical reasoning', 'puzzles', 'arrangements', 'games and tournaments']),
      t('varc', 'VARC', ['varc', 'reading comprehension', 'para jumbles', 'para summary', 'verbal ability', 'odd sentence out']),
      t('interview', 'GD-PI & WAT', ['group discussion', 'personal interview', 'gd pi']),
    ],
  }),
];
