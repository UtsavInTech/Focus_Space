import type { LearningMode, Topic } from '@/types/domain';
import { slugify } from '@/learning/text';
import type { SpaceIconName } from './icons';
import { SKILLS, SUBTOPICS } from './btech-subjects';

/**
 * Goals: "Which exam are you preparing for?" (or which B.Tech branch) — the first thing FocusSpace asks.
 *
 * A goal is a hierarchy, not a flat subject list. Exam → the exact exam or post (SSC CGL, IBPS PO) →
 * its stages and papers (Prelims, Mains GS I–IV, the optional) → the subjects in each. Some levels are
 * the learner's to choose — UPSC's optional subject, the state commission, a B.Tech branch and year —
 * so a goal asks those questions before it builds the Space. The answers become the Space's topics,
 * each labelled with its place in the hierarchy (`Topic.group`).
 *
 * Every goal names itself in its keywords ("upsc", "ssc cgl"…). That is what makes it the Space's own
 * exam family for the off-domain guard (learning/relevance/domains.ts).
 *
 * Exam structure follows the official notices as of October 2026 (UPSC CSE 2025/26, SSC CGL 2025, IBPS
 * CRP XV, RRB CEN 2025, CTET bulletin), summarised in the FocusSpace exam taxonomy research. Patterns
 * change by cycle; topics are a learning map, not an official syllabus.
 *
 * Creator names are popular third-party channels for each track, offered as quick picks before the
 * Space is created. They are examples, never official: SSC, UPSC and the other bodies endorse no
 * YouTube channel, and FocusSpace says so where it shows them.
 */

export type ExamGroup = 'government' | 'entrance' | 'engineering' | 'degrees';

export type ExamId = 'upsc' | 'ssc' | 'banking' | 'railways' | 'state-psc' | 'defence' | 'teaching' | 'judiciary' | 'jee' | 'neet' | 'gate' | 'cat' | 'btech' | 'bca' | 'bsc' | 'bcom' | 'mbbs' | 'school';

export interface ExamOption {
  id: string;
  label: string;
  hint?: string;
  /** Topics this choice adds. */
  topics?: Topic[];
  /** Relevance keywords this choice adds (names the exact exam: "ssc cgl", "bpsc"). */
  keywords?: string[];
  /** The Space's name when this is chosen ("SSC CGL", "B.Tech CSE"). */
  name?: string;
  searchHint?: string;
  creators?: string[];
}

export interface ExamQuestion {
  id: string;
  prompt: string;
  help?: string;
  /** Several answers allowed (B.Tech years). */
  multi?: boolean;
  options: ExamOption[];
  /** Pre-selected answers. */
  defaults: string[];
  /** Only asked when another answer is one of these (B.Tech CSE's skills). */
  showIf?: { question: string; anyOf: string[] };
}

export interface ExamInfo {
  id: ExamId;
  group: ExamGroup;
  /** What the learner reads on the picker. */
  label: string;
  /** One line under the label. */
  covers: string;
  icon: SpaceIconName;
  emoji: string;
  name: string;
  description: string;
  searchHint: string;
  keywords: string[];
  /** Topics every version of this goal has. */
  topics: Topic[];
  questions: ExamQuestion[];
  creators: string[];
}

export const EXAM_GROUPS: { id: ExamGroup; label: string; hint: string }[] = [
  { id: 'government', label: 'Government jobs', hint: 'UPSC, SSC, banking, railways, state PSC and more' },
  { id: 'entrance', label: 'Entrance exams', hint: 'JEE, NEET, GATE, CAT' },
  { id: 'engineering', label: 'B.Tech & Engineering', hint: 'Your branch, year by year' },
  { id: 'degrees', label: 'College & school', hint: 'BCA, B.Sc, B.Com, MBBS, Class 11–12' },
];

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

const t = (name: string, keywords: string[] = [], group?: string): Topic => ({ id: slugify(`${group ? `${group}-` : ''}${name}`), name, keywords, ...(group ? { group } : {}) });
/** A subject whose own name is its best keyword. */
const s = (group: string) => (name: string, ...extra: string[]): Topic => t(name, [name.toLowerCase(), ...extra], group);
const opt = (id: string, label: string, rest: Omit<ExamOption, 'id' | 'label'> = {}): ExamOption => ({ id, label, ...rest });

/* ─── Shared syllabus blocks (reusable subject clusters) ───────────────────── */

const QUANT = (group: string) => t('Quantitative Aptitude', ['quantitative aptitude', 'maths', 'percentage', 'profit and loss', 'simple interest', 'compound interest', 'time and work', 'time speed distance', 'ratio and proportion', 'average', 'number system', 'algebra', 'geometry', 'mensuration', 'trigonometry', 'data interpretation'], group);
const REASONING = (group: string) => t('Reasoning', ['reasoning', 'coding decoding', 'blood relation', 'syllogism', 'number series', 'analogy', 'non verbal reasoning', 'direction sense', 'seating arrangement', 'puzzle', 'puzzles', 'inequality'], group);
const ENGLISH = (group: string) => t('English', ['english grammar', 'vocabulary', 'one word substitution', 'idioms and phrases', 'error spotting', 'cloze test', 'reading comprehension', 'para jumbles', 'synonyms antonyms'], group);
const GA = (group: string) => t('General Awareness', ['general awareness', 'static gk', 'gk', 'history gk', 'polity gk', 'geography gk', 'science gk', 'general science'], group);
const CURRENT = (group: string) => t('Current Affairs', ['current affairs', 'daily current affairs', 'monthly current affairs', 'the hindu analysis', 'editorial analysis', 'pib'], group);

/* ─── Goals ────────────────────────────────────────────────────────────────── */

const UPSC_OPTIONALS: [string, string[]][] = [
  ['Anthropology', ['anthropology optional', 'anthropology']],
  ['Geography', ['geography optional']],
  ['Political Science & IR (PSIR)', ['psir', 'psir optional', 'political science optional']],
  ['Sociology', ['sociology optional', 'sociology']],
  ['History', ['history optional']],
  ['Public Administration', ['public administration', 'pub ad optional']],
  ['Philosophy', ['philosophy optional', 'philosophy']],
  ['Economics', ['economics optional']],
  ['Mathematics', ['mathematics optional', 'maths optional']],
  ['Law', ['law optional']],
  ['Commerce & Accountancy', ['commerce optional', 'accountancy optional']],
  ['Psychology', ['psychology optional', 'psychology']],
  ['Hindi Literature', ['hindi literature optional', 'hindi sahitya']],
  ['Medical Science', ['medical science optional']],
  ['Agriculture', ['agriculture optional']],
  ['Management', ['management optional']],
];

const UPSC: ExamInfo = {
  id: 'upsc',
  group: 'government',
  label: 'UPSC CSE',
  covers: 'IAS · IPS · IFS · Prelims, Mains & Interview',
  icon: 'landmark',
  emoji: '🏛️',
  name: 'UPSC',
  description: 'Civil Services: Prelims, Mains, your optional and the interview, one paper at a time.',
  searchHint: 'upsc',
  keywords: ['upsc', 'upsc cse', 'civil services', 'ias', 'ias preparation', 'upsc prelims', 'upsc mains', 'gs paper', 'current affairs', 'answer writing', 'ncert'],
  topics: [
    t('Polity', ['indian polity', 'polity', 'constitution', 'fundamental rights', 'directive principles', 'parliament', 'judiciary', 'laxmikanth', 'preamble'], 'Prelims · GS'),
    t('History', ['modern history', 'ancient history', 'medieval history', 'freedom struggle', 'indian national movement', 'spectrum'], 'Prelims · GS'),
    t('Art & Culture', ['art and culture', 'temple architecture', 'indian art', 'classical dance', 'indian paintings'], 'Prelims · GS'),
    t('Geography', ['indian geography', 'world geography', 'physical geography', 'monsoon', 'climatology', 'geomorphology', 'mapping'], 'Prelims · GS'),
    t('Economy', ['indian economy', 'economy', 'budget', 'economic survey', 'monetary policy', 'inflation', 'fiscal policy', 'gdp'], 'Prelims · GS'),
    t('Environment', ['environment', 'ecology', 'biodiversity', 'climate change', 'shankar ias'], 'Prelims · GS'),
    t('Science & Tech', ['science and technology', 'space technology', 'biotechnology', 'defence technology'], 'Prelims · GS'),
    CURRENT('Prelims · GS'),
    t('CSAT', ['csat', 'reading comprehension', 'logical reasoning', 'basic numeracy'], 'Prelims · CSAT'),
    t('Essay', ['essay paper', 'upsc essay', 'essay writing'], 'Mains'),
    t('GS I: Society & Heritage', ['gs 1', 'gs paper 1', 'indian society', 'world history'], 'Mains'),
    t('GS II: Governance & IR', ['gs 2', 'gs paper 2', 'governance', 'social justice', 'international relations', 'foreign policy'], 'Mains'),
    t('GS III: Economy & Security', ['gs 3', 'gs paper 3', 'internal security', 'disaster management', 'agriculture economy'], 'Mains'),
    t('GS IV: Ethics', ['gs 4', 'ethics', 'integrity', 'aptitude and ethics', 'ethics case studies'], 'Mains'),
    t('Answer Writing', ['answer writing', 'mains answer', 'upsc mains'], 'Mains'),
    t('Interview', ['upsc interview', 'personality test', 'mock interview', 'daf'], 'Interview'),
  ],
  questions: [
    {
      id: 'optional',
      prompt: 'Which optional subject did you choose?',
      help: 'Mains has two papers on it. Not sure yet? Pick “Not decided”, you can add it later.',
      defaults: ['undecided'],
      options: [
        ...UPSC_OPTIONALS.map(([label, keywords]) => opt(slugify(label), label, { topics: [t(label, keywords, 'Optional')] })),
        opt('undecided', 'Not decided yet'),
      ],
    },
  ],
  creators: ['StudyIQ IAS', 'Drishti IAS', 'Vision IAS', 'Unacademy UPSC', 'PW OnlyIAS', 'Vajiram and Ravi', 'Next IAS', 'Sleepy Classes IAS', 'Mrunal Patel', 'Sansad TV'],
};

const SSC: ExamInfo = {
  id: 'ssc',
  group: 'government',
  label: 'SSC',
  covers: 'CGL · CHSL · MTS · GD · CPO · JE · Steno',
  icon: 'file-text',
  emoji: '📝',
  name: 'SSC',
  description: 'Staff Selection Commission exams: quant, reasoning, English and general awareness.',
  searchHint: 'ssc',
  keywords: ['ssc', 'ssc cgl', 'cgl', 'ssc chsl', 'chsl', 'ssc mts', 'ssc gd', 'ssc cpo', 'ssc je', 'current affairs', 'general awareness', 'static gk'],
  topics: [QUANT('Tier 1'), REASONING('Tier 1'), ENGLISH('Tier 1'), GA('Tier 1'), CURRENT('Tier 1'), t('Computer Knowledge', ['computer awareness', 'computer knowledge', 'ms office', 'ms excel'], 'Tier 2')],
  questions: [
    {
      id: 'exam',
      prompt: 'Which SSC exam?',
      defaults: ['cgl'],
      options: [
        opt('cgl', 'CGL', { hint: 'Graduate level', name: 'SSC CGL', searchHint: 'ssc cgl', keywords: ['ssc cgl', 'cgl tier 1', 'cgl tier 2'], topics: [t('Statistics', ['statistics for cgl', 'jso statistics'], 'Tier 2'), t('Finance & Economics', ['finance and economics cgl'], 'Tier 2')] }),
        opt('chsl', 'CHSL', { hint: '10+2 level', name: 'SSC CHSL', searchHint: 'ssc chsl', keywords: ['ssc chsl', 'chsl'], topics: [t('Typing & Skill Test', ['typing test', 'skill test', 'deo skill test'], 'Skill test')] }),
        opt('mts', 'MTS & Havaldar', { hint: 'Matric level', name: 'SSC MTS', searchHint: 'ssc mts', keywords: ['ssc mts', 'havaldar'] }),
        opt('gd', 'GD Constable', { name: 'SSC GD', searchHint: 'ssc gd', keywords: ['ssc gd', 'gd constable'], topics: [t('Physical Test', ['pet pst', 'physical test', 'running'], 'Physical')] }),
        opt('cpo', 'CPO (SI)', { name: 'SSC CPO', searchHint: 'ssc cpo', keywords: ['ssc cpo', 'delhi police si', 'capf si'] }),
        opt('je', 'JE (Engineering)', { name: 'SSC JE', searchHint: 'ssc je', keywords: ['ssc je', 'junior engineer'], topics: [t('Civil Engineering', ['ssc je civil', 'building materials', 'rcc', 'surveying'], 'Paper 1 · Technical'), t('Electrical Engineering', ['ssc je electrical', 'electrical machines', 'network theory'], 'Paper 1 · Technical'), t('Mechanical Engineering', ['ssc je mechanical', 'thermodynamics', 'fluid mechanics'], 'Paper 1 · Technical')] }),
        opt('steno', 'Stenographer', { name: 'SSC Steno', searchHint: 'ssc stenographer', keywords: ['ssc stenographer', 'steno', 'shorthand'], topics: [t('Shorthand', ['shorthand', 'dictation'], 'Skill test')] }),
      ],
    },
  ],
  creators: ['SSC Adda247', 'SSC Wallah', 'Testbook SSC', 'Rojgar with Ankit', 'Parmar SSC', 'Parcham Classes', 'WiFiStudy'],
};

const BANKING: ExamInfo = {
  id: 'banking',
  group: 'government',
  label: 'Banking & Insurance',
  covers: 'IBPS · SBI PO & Clerk · RBI · LIC',
  icon: 'banknote',
  emoji: '🏦',
  name: 'Banking',
  description: 'Bank and insurance exams: speed maths, puzzles, English and banking awareness.',
  searchHint: 'bank exam',
  keywords: ['banking exam', 'banking exams', 'bank exam', 'ibps', 'ibps po', 'ibps clerk', 'sbi po', 'sbi clerk', 'bank po', 'rbi grade b', 'rrb po', 'rrb clerk', 'lic aao', 'current affairs'],
  topics: [
    t('Quant & DI', ['data interpretation', 'quantitative aptitude', 'simplification', 'approximation', 'quadratic equation', 'number series', 'arithmetic'], 'Prelims'),
    t('Reasoning & Puzzles', ['puzzle', 'puzzles', 'seating arrangement', 'syllogism', 'inequality', 'blood relation', 'coding decoding', 'input output'], 'Prelims'),
    ENGLISH('Prelims'),
    t('Banking Awareness', ['banking awareness', 'financial awareness', 'rbi', 'monetary policy', 'banking terms'], 'Mains'),
    CURRENT('Mains'),
    t('Descriptive & Interview', ['descriptive writing', 'essay writing', 'letter writing', 'bank interview'], 'Mains'),
  ],
  questions: [
    {
      id: 'exam',
      prompt: 'Which exam are you aiming for?',
      defaults: ['po'],
      options: [
        opt('po', 'IBPS / SBI PO', { name: 'Bank PO', searchHint: 'bank po', keywords: ['ibps po', 'sbi po', 'bank po'] }),
        opt('clerk', 'Clerk / CSA', { name: 'Bank Clerk', searchHint: 'bank clerk', keywords: ['ibps clerk', 'sbi clerk', 'ibps csa', 'junior associate'] }),
        opt('rrb', 'IBPS RRB', { name: 'IBPS RRB', searchHint: 'ibps rrb', keywords: ['ibps rrb', 'rrb po', 'rrb clerk', 'office assistant'] }),
        opt('rbi', 'RBI Grade B', { name: 'RBI Grade B', searchHint: 'rbi grade b', keywords: ['rbi grade b', 'rbi assistant'], topics: [t('ESI (Economic & Social Issues)', ['esi', 'economic and social issues'], 'Phase 2'), t('Finance & Management', ['finance and management', 'f&m rbi'], 'Phase 2')], creators: ['EduTap', 'Anuj Jindal', 'ixamBee'] }),
        opt('so', 'Specialist Officer', { name: 'IBPS SO', searchHint: 'ibps so', keywords: ['ibps so', 'it officer', 'agriculture field officer'], topics: [t('Professional Knowledge', ['professional knowledge', 'it officer'], 'Mains')] }),
        opt('lic', 'Insurance (LIC AAO)', { name: 'LIC AAO', searchHint: 'lic aao', keywords: ['lic aao', 'lic ado', 'insurance exam', 'niacl ao'], topics: [t('Insurance Awareness', ['insurance awareness', 'insurance terms'], 'Mains')] }),
      ],
    },
  ],
  creators: ['Bankersadda', 'Oliveboard', 'Testbook Banking', 'Unacademy Bank Exams', 'Guidely', 'PracticeMock', 'AffairsCloud'],
};

const RAILWAYS: ExamInfo = {
  id: 'railways',
  group: 'government',
  label: 'Railways',
  covers: 'RRB NTPC · Group D · ALP · JE · RPF',
  icon: 'train',
  emoji: '🚆',
  name: 'Railways',
  description: 'RRB exams: maths, reasoning, general science and general awareness.',
  searchHint: 'rrb',
  keywords: ['rrb', 'rrb ntpc', 'ntpc', 'group d', 'rrb group d', 'rrb alp', 'rrb je', 'railway exam', 'railway exams', 'current affairs', 'general awareness'],
  topics: [
    t('Mathematics', ['maths', 'percentage', 'time and work', 'simplification', 'number system', 'profit and loss', 'mensuration'], 'CBT'),
    REASONING('CBT'),
    t('General Science', ['general science', 'physics', 'chemistry', 'biology', 'science gk'], 'CBT'),
    GA('CBT'),
    CURRENT('CBT'),
  ],
  questions: [
    {
      id: 'exam',
      prompt: 'Which RRB exam?',
      defaults: ['ntpc'],
      options: [
        opt('ntpc', 'NTPC', { name: 'RRB NTPC', searchHint: 'rrb ntpc', keywords: ['rrb ntpc', 'ntpc'] }),
        opt('groupd', 'Group D / Level 1', { name: 'RRB Group D', searchHint: 'rrb group d', keywords: ['rrb group d', 'group d'], topics: [t('Physical Test (PET)', ['pet', 'physical efficiency test'], 'Physical')] }),
        opt('alp', 'ALP & Technician', { name: 'RRB ALP', searchHint: 'rrb alp', keywords: ['rrb alp', 'rrb technician'], topics: [t('Basic Science & Engineering', ['basic science and engineering', 'alp cbt 2'], 'CBT 2'), t('Trade Theory', ['trade theory', 'iti'], 'CBT 2')] }),
        opt('je', 'JE', { name: 'RRB JE', searchHint: 'rrb je', keywords: ['rrb je'], topics: [t('Technical Subjects', ['rrb je technical', 'rrb je cbt 2'], 'CBT 2')] }),
        opt('rpf', 'RPF Constable / SI', { name: 'RPF', searchHint: 'rpf constable', keywords: ['rpf constable', 'rpf si'] }),
      ],
    },
  ],
  creators: ['Railway Adda247', 'Rojgar with Ankit', 'Testbook Railway', 'WiFiStudy', 'Khan Global Studies', 'Exampur'],
};

const STATES: [string, string, string, string[]][] = [
  ['uppsc', 'UPPSC (Uttar Pradesh)', 'UPPSC', ['uppsc', 'uppcs', 'up gk', 'uttar pradesh gk', 'ro aro']],
  ['bpsc', 'BPSC (Bihar)', 'BPSC', ['bpsc', 'bihar gk', 'bihar special']],
  ['mppsc', 'MPPSC (Madhya Pradesh)', 'MPPSC', ['mppsc', 'mp gk', 'madhya pradesh gk']],
  ['rpsc', 'RPSC RAS (Rajasthan)', 'RPSC RAS', ['rpsc', 'ras', 'rajasthan gk']],
  ['mpsc', 'MPSC (Maharashtra)', 'MPSC', ['mpsc', 'maharashtra gk']],
  ['tnpsc', 'TNPSC (Tamil Nadu)', 'TNPSC', ['tnpsc', 'tamil nadu gk', 'group 1', 'group 4']],
  ['kpsc', 'KPSC (Karnataka)', 'KPSC', ['kpsc', 'karnataka gk']],
  ['wbcs', 'WBCS (West Bengal)', 'WBCS', ['wbcs', 'wbpsc', 'west bengal gk']],
  ['keralapsc', 'Kerala PSC', 'Kerala PSC', ['kerala psc', 'kerala gk']],
  ['gpsc', 'GPSC (Gujarat)', 'GPSC', ['gpsc', 'gujarat gk']],
  ['hpsc', 'HPSC / HCS (Haryana)', 'HPSC', ['hpsc', 'hcs', 'haryana gk']],
  ['opsc', 'OPSC (Odisha)', 'OPSC', ['opsc', 'odisha gk']],
];

const STATE_PSC: ExamInfo = {
  id: 'state-psc',
  group: 'government',
  label: 'State PSC',
  covers: 'UPPSC · BPSC · MPPSC · RAS · MPSC · TNPSC…',
  icon: 'map',
  emoji: '🗺️',
  name: 'State PSC',
  description: 'State civil services: GS, your state’s own history, geography and schemes, and current affairs.',
  searchHint: 'state psc',
  keywords: ['state psc', 'pcs exam', 'current affairs'],
  topics: [
    t('Polity', ['indian polity', 'polity', 'constitution', 'fundamental rights', 'panchayati raj'], 'Prelims'),
    t('History', ['modern history', 'ancient history', 'medieval history', 'freedom struggle'], 'Prelims'),
    t('Geography', ['indian geography', 'physical geography'], 'Prelims'),
    t('Economy', ['indian economy', 'economy', 'budget'], 'Prelims'),
    CURRENT('Prelims'),
    t('Mains Answer Writing', ['answer writing', 'mains answer'], 'Mains'),
  ],
  questions: [
    {
      id: 'state',
      prompt: 'Which commission?',
      help: 'Your state’s history, geography and current affairs become their own topic.',
      defaults: ['uppsc'],
      options: STATES.map(([id, label, name, keywords]) => opt(id, label, { name, searchHint: keywords[0], keywords, topics: [t(`${name.split(' ')[0]} State Special`, keywords.slice(1), 'State special')] })),
    },
  ],
  creators: ['Drishti IAS', 'StudyIQ IAS', 'Adda247 State Exams', 'Khan Global Studies', 'Utkarsh Classes', 'Exampur'],
};

const DEFENCE: ExamInfo = {
  id: 'defence',
  group: 'government',
  label: 'Defence & Police',
  covers: 'NDA · CDS · AFCAT · CAPF · Agniveer · Police',
  icon: 'shield',
  emoji: '🎖️',
  name: 'Defence',
  description: 'Armed forces and police: the written test, then SSB, physical and medical stages.',
  searchHint: 'defence exam',
  keywords: ['defence exam', 'nda exam', 'cds exam', 'afcat', 'capf', 'agniveer', 'police constable', 'ssb interview'],
  topics: [
    t('Mathematics', ['nda maths', 'elementary mathematics', 'maths'], 'Written'),
    t('English', ['english for nda', 'english grammar', 'vocabulary'], 'Written'),
    t('General Knowledge', ['gat', 'general ability test', 'gk', 'general studies'], 'Written'),
    CURRENT('Written'),
    t('SSB Interview', ['ssb interview', 'ppdt', 'tat', 'wat', 'gto', 'ssb'], 'SSB / Interview'),
    t('Physical Fitness', ['physical test', 'running', 'fitness test'], 'Physical'),
  ],
  questions: [
    {
      id: 'exam',
      prompt: 'Which entry?',
      defaults: ['nda'],
      options: [
        opt('nda', 'NDA', { name: 'NDA', searchHint: 'nda exam', keywords: ['nda', 'nda exam'] }),
        opt('cds', 'CDS', { name: 'CDS', searchHint: 'cds exam', keywords: ['cds', 'cds exam'] }),
        opt('afcat', 'AFCAT', { name: 'AFCAT', searchHint: 'afcat', keywords: ['afcat'] }),
        opt('capf', 'CAPF AC', { name: 'CAPF AC', searchHint: 'capf ac', keywords: ['capf ac', 'capf'], topics: [t('Essay & Comprehension', ['capf essay', 'comprehension'], 'Written')] }),
        opt('agniveer', 'Agniveer', { name: 'Agniveer', searchHint: 'agniveer', keywords: ['agniveer', 'agnipath'] }),
        opt('police', 'State Police', { name: 'Police Exam', searchHint: 'police constable', keywords: ['police constable', 'up police', 'delhi police', 'si exam'] }),
      ],
    },
  ],
  creators: ['Defence Adda247', 'Major Kalshi Classes', 'NDA Wallah', 'Shield Defence Academy', 'Rojgar with Ankit'],
};

const TEACHING: ExamInfo = {
  id: 'teaching',
  group: 'government',
  label: 'Teaching',
  covers: 'CTET · State TET · KVS · UGC NET',
  icon: 'graduation-cap',
  emoji: '🍎',
  name: 'Teaching',
  description: 'Teacher eligibility and recruitment: child development, pedagogy and your subjects.',
  searchHint: 'ctet',
  keywords: ['ctet', 'tet', 'reet', 'uptet', 'kvs', 'nvs', 'dsssb', 'ugc net', 'teaching exam'],
  topics: [
    t('Child Development & Pedagogy', ['child development and pedagogy', 'cdp', 'pedagogy', 'learning theories', 'inclusive education'], 'Paper I & II'),
    t('Language I & II', ['hindi pedagogy', 'english pedagogy', 'language comprehension'], 'Paper I & II'),
    t('Mathematics & Pedagogy', ['maths pedagogy', 'ctet maths'], 'Subjects'),
    t('EVS', ['evs', 'environmental studies'], 'Subjects'),
    t('Science / Social Studies', ['ctet science', 'social studies', 'sst pedagogy'], 'Subjects'),
  ],
  questions: [
    {
      id: 'exam',
      prompt: 'Which exam?',
      defaults: ['ctet'],
      options: [
        opt('ctet', 'CTET', { name: 'CTET', searchHint: 'ctet', keywords: ['ctet'] }),
        opt('tet', 'State TET', { name: 'TET', searchHint: 'tet exam', keywords: ['reet', 'uptet', 'htet', 'state tet'] }),
        opt('kvs', 'KVS / NVS / DSSSB', { name: 'KVS', searchHint: 'kvs', keywords: ['kvs', 'nvs', 'dsssb'] }),
        opt('net', 'UGC NET', { name: 'UGC NET', searchHint: 'ugc net', keywords: ['ugc net', 'nta net'], topics: [t('Paper 1: Teaching & Research Aptitude', ['ugc net paper 1', 'teaching aptitude', 'research aptitude'], 'UGC NET')] }),
      ],
    },
  ],
  creators: ["Let's LEARN", 'Teachers Adda247', 'Teaching Wallah', 'Sachin Academy', 'Drishti Teaching Exams'],
};

const JUDICIARY: ExamInfo = {
  id: 'judiciary',
  group: 'government',
  label: 'Judiciary',
  covers: 'Civil Judge · State Judicial Services',
  icon: 'scale',
  emoji: '⚖️',
  name: 'Judiciary',
  description: 'State judicial services: the major laws, procedure, and judgment writing.',
  searchHint: 'judiciary exam',
  keywords: ['judiciary exam', 'civil judge', 'judicial services', 'pcs j', 'law'],
  topics: [
    t('Constitution', ['constitutional law', 'constitution', 'article'], 'Prelims & Mains'),
    t('Criminal Law (BNS / IPC)', ['bns', 'ipc', 'bharatiya nyaya sanhita', 'criminal law'], 'Prelims & Mains'),
    t('Criminal Procedure (BNSS / CrPC)', ['bnss', 'crpc', 'criminal procedure'], 'Prelims & Mains'),
    t('Evidence (BSA)', ['evidence act', 'bharatiya sakshya adhiniyam', 'bsa'], 'Prelims & Mains'),
    t('Civil Procedure (CPC)', ['cpc', 'civil procedure code'], 'Prelims & Mains'),
    t('Contract & Property', ['contract act', 'transfer of property', 'specific relief'], 'Prelims & Mains'),
    t('Judgment Writing', ['judgment writing', 'framing of issues'], 'Mains'),
  ],
  questions: [],
  creators: ['LegalEdge Judiciary', 'Unacademy Judiciary', 'StudyIQ Judiciary', 'Judiciary Gold', 'Law Wallah'],
};

const JEE: ExamInfo = {
  id: 'jee',
  group: 'entrance',
  label: 'JEE',
  covers: 'Main & Advanced · PCM',
  icon: 'atom',
  emoji: '⚛️',
  name: 'JEE',
  description: 'JEE Main and Advanced: physics, chemistry and maths, concept to problem.',
  searchHint: 'jee',
  keywords: ['jee', 'jee main', 'jee mains', 'jee advanced', 'iit jee', '~class 11', '~class 12', '~ncert'],
  topics: [
    t('Physics', ['physics', 'kinematics', 'laws of motion', 'rotational motion', 'electrostatics', 'current electricity', 'magnetism', 'optics', 'modern physics', 'thermodynamics', 'waves'], 'Physics'),
    t('Physical Chemistry', ['physical chemistry', 'mole concept', 'chemical equilibrium', 'ionic equilibrium', 'electrochemistry', 'chemical kinetics', 'thermochemistry'], 'Chemistry'),
    t('Organic Chemistry', ['organic chemistry', 'goc', 'hydrocarbons', 'reaction mechanism', 'isomerism', 'named reactions'], 'Chemistry'),
    t('Inorganic Chemistry', ['inorganic chemistry', 'periodic table', 'chemical bonding', 'coordination compounds', 'p block', 'd block'], 'Chemistry'),
    t('Calculus', ['calculus', 'limits', 'differentiation', 'integration', 'differential equations'], 'Mathematics'),
    t('Algebra', ['matrices', 'determinants', 'complex numbers', 'sequence and series', 'binomial theorem', 'probability', 'permutation and combination'], 'Mathematics'),
    t('Coordinate & Vectors', ['coordinate geometry', 'conic sections', 'vectors', '3d geometry', 'straight lines'], 'Mathematics'),
  ],
  questions: [
    {
      id: 'level',
      prompt: 'Main or Advanced?',
      defaults: ['main'],
      options: [opt('main', 'JEE Main', { name: 'JEE Main', keywords: ['jee main', 'jee mains'] }), opt('advanced', 'JEE Advanced', { name: 'JEE Advanced', keywords: ['jee advanced', 'iit jee'] })],
    },
  ],
  creators: ['Physics Wallah', 'Vedantu JEE', 'Unacademy JEE', 'MathonGo'],
};

/**
 * NEET as subjects → their parts, the way NCERT and every coaching batch splits them: Biology into
 * Botany and Zoology, Physics into its four units, Chemistry into Physical, Organic and Inorganic.
 * Exported so older NEET Spaces (one "Physics" and one "Chemistry" topic) catch up (modes/curricula.ts).
 */
export const NEET_TOPICS: Topic[] = [
  t('Botany', ['botany', 'plant physiology', 'plant kingdom', 'photosynthesis', 'cell cycle', 'molecular basis of inheritance', 'genetics', 'ecology', 'morphology of flowering plants', 'plant anatomy'], 'Biology'),
  t('Zoology', ['zoology', 'human physiology', 'animal kingdom', 'human reproduction', 'biotechnology', 'evolution', 'human health and disease', 'structural organisation in animals', 'breathing and exchange of gases'], 'Biology'),
  t('Mechanics', ['mechanics', 'units and measurements', 'kinematics', 'laws of motion', 'work energy and power', 'rotational motion', 'gravitation', 'mechanical properties of solids', 'fluid mechanics'], 'Physics'),
  t('Heat, Oscillations & Waves', ['thermal properties of matter', 'thermodynamics', 'kinetic theory of gases', 'oscillations', 'simple harmonic motion', 'waves'], 'Physics'),
  t('Electricity & Magnetism', ['electrostatics', 'capacitance', 'current electricity', 'moving charges and magnetism', 'magnetism and matter', 'electromagnetic induction', 'alternating current', 'electromagnetic waves'], 'Physics'),
  t('Optics & Modern Physics', ['ray optics', 'wave optics', 'dual nature of radiation and matter', 'atoms', 'nuclei', 'semiconductor electronics', 'modern physics'], 'Physics'),
  t('Physical Chemistry', ['physical chemistry', 'mole concept', 'structure of atom', 'chemical thermodynamics', 'chemical equilibrium', 'ionic equilibrium', 'redox reactions', 'solutions', 'electrochemistry', 'chemical kinetics'], 'Chemistry'),
  t('Organic Chemistry', ['organic chemistry', 'goc', 'iupac nomenclature', 'isomerism', 'hydrocarbons', 'haloalkanes and haloarenes', 'alcohols phenols and ethers', 'aldehydes ketones and carboxylic acids', 'amines', 'biomolecules'], 'Chemistry'),
  t('Inorganic Chemistry', ['inorganic chemistry', 'periodic table', 'classification of elements', 'chemical bonding', 's block', 'p block', 'd and f block', 'coordination compounds'], 'Chemistry'),
];

const NEET: ExamInfo = {
  id: 'neet',
  group: 'entrance',
  label: 'NEET',
  covers: 'NEET UG · Biology, Physics, Chemistry',
  icon: 'stethoscope',
  emoji: '🩺',
  name: 'NEET',
  description: 'NEET UG: biology first, then physics and chemistry, NCERT line by line.',
  searchHint: 'neet',
  keywords: ['neet', 'neet ug', '~ncert', '~class 11', '~class 12', 'ncert biology'],
  topics: NEET_TOPICS,
  questions: [],
  creators: ['Physics Wallah', 'Competition Wallah', 'Vedantu NEET', 'Unacademy NEET'],
};

const GATE_BRANCHES: [string, string, Topic[]][] = [
  ['cse', 'CSE', ['Operating Systems', 'DBMS', 'Computer Networks', 'Theory of Computation', 'Compiler Design', 'Computer Organization', 'Digital Logic', 'Data Structures & Algorithms'].map((n) => s('Core')(n))],
  ['ece', 'ECE', ['Networks', 'Signals & Systems', 'Electronic Devices', 'Analog Circuits', 'Digital Circuits', 'Control Systems', 'Communications', 'Electromagnetics'].map((n) => s('Core')(n))],
  ['ee', 'EE', ['Electric Circuits', 'Electrical Machines', 'Power Systems', 'Control Systems', 'Power Electronics', 'Signals & Systems', 'Measurements', 'Analog & Digital Electronics'].map((n) => s('Core')(n))],
  ['me', 'ME', ['Engineering Mechanics', 'Strength of Materials', 'Theory of Machines', 'Machine Design', 'Fluid Mechanics', 'Heat Transfer', 'Thermodynamics', 'Manufacturing'].map((n) => s('Core')(n))],
  ['ce', 'CE', ['Structural Analysis', 'RCC & Steel', 'Geotechnical Engineering', 'Fluid Mechanics & Hydraulics', 'Environmental Engineering', 'Transportation Engineering', 'Surveying'].map((n) => s('Core')(n))],
  ['da', 'Data Science & AI', ['Probability & Statistics', 'Linear Algebra', 'Machine Learning', 'Artificial Intelligence', 'Programming & DSA', 'DBMS & Warehousing'].map((n) => s('Core')(n))],
];

const GATE: ExamInfo = {
  id: 'gate',
  group: 'entrance',
  label: 'GATE',
  covers: 'CSE · ECE · EE · ME · CE · DA',
  icon: 'cpu',
  emoji: '🎓',
  name: 'GATE',
  description: 'GATE: your branch’s core subjects, engineering maths and general aptitude.',
  searchHint: 'gate',
  keywords: ['gate exam', 'gate 2026', 'gate 2027', 'gate preparation', 'gate pyq'],
  topics: [t('Engineering Mathematics', ['engineering mathematics', 'discrete mathematics', 'linear algebra', 'probability', 'calculus'], 'Common'), t('General Aptitude', ['general aptitude', 'verbal ability', 'numerical ability'], 'Common')],
  questions: [
    {
      id: 'branch',
      prompt: 'Which paper?',
      defaults: ['cse'],
      options: GATE_BRANCHES.map(([id, label, topics]) => opt(id, label, { name: `GATE ${label === 'Data Science & AI' ? 'DA' : label}`, searchHint: `gate ${id}`, keywords: [`gate ${id}`, ...(id === 'cse' ? ['gate cs', 'gate computer science'] : [])], topics })),
    },
  ],
  creators: ['Made Easy', 'Gate Wallah', 'Unacademy GATE', 'Ekeeda', 'Engineers Academy', 'Gate Smashers'],
};

const CAT: ExamInfo = {
  id: 'cat',
  group: 'entrance',
  label: 'CAT & MBA',
  covers: 'CAT · XAT · SNAP · QA, DILR, VARC',
  icon: 'briefcase',
  emoji: '💼',
  // Never just "CAT": the Space's name is itself a keyword, and YouTube has a great many cats.
  name: 'CAT & MBA',
  description: 'CAT and MBA entrances: quant, DILR and verbal ability.',
  searchHint: 'cat exam',
  keywords: ['cat exam', 'cat preparation', 'cat 2026', 'cat quant', 'cat varc', 'cat dilr', 'mba entrance', 'iim', 'xat', 'nmat'],
  topics: [
    t('Quantitative Ability', ['quantitative ability', 'arithmetic', 'algebra', 'geometry', 'number system', 'percentages', 'time speed distance', 'modern math'], 'Sections'),
    t('DILR', ['dilr', 'data interpretation', 'logical reasoning', 'arrangements', 'games and tournaments'], 'Sections'),
    t('VARC', ['varc', 'reading comprehension', 'para jumbles', 'para summary', 'verbal ability', 'odd sentence out'], 'Sections'),
    t('GD-PI & WAT', ['group discussion', 'personal interview', 'gd pi'], 'After the exam'),
  ],
  questions: [],
  creators: ['Rodha', '2IIM CAT Preparation', 'Unacademy CAT', 'Cracku'],
};

/* ─── B.Tech: branch → year → subjects ─────────────────────────────────────── */

const FIRST_YEAR = ['Engineering Mathematics', 'Engineering Physics', 'Engineering Chemistry', 'Programming in C', 'Basic Electrical Engineering', 'Engineering Graphics', 'Engineering Mechanics'];

const BTECH_SUBJECTS: Record<string, { label: string; name: string; years: Record<'y2' | 'y3' | 'y4', string[]>; creators: string[] }> = {
  cse: {
    label: 'Computer Science (CSE / IT)',
    name: 'B.Tech CSE',
    years: {
      y2: ['Data Structures', 'Discrete Mathematics', 'Digital Logic', 'Computer Organization and Architecture', 'Object Oriented Programming', 'Probability and Statistics'],
      y3: ['Operating System', 'DBMS', 'Computer Networks', 'Theory of Computation', 'Design and Analysis of Algorithms', 'Software Engineering', 'Compiler Design'],
      y4: ['Machine Learning', 'Cloud Computing', 'Cryptography and Network Security', 'Distributed Systems', 'Data Mining', 'Artificial Intelligence'],
    },
    creators: ['Gate Smashers', 'Neso Academy', "Jenny's Lectures", 'Abdul Bari', 'Apna College', 'NPTEL'],
  },
  ece: {
    label: 'Electronics (ECE)',
    name: 'B.Tech ECE',
    years: {
      y2: ['Network Analysis', 'Electronic Devices', 'Analog Circuits', 'Digital Electronics', 'Signals and Systems'],
      y3: ['Control Systems', 'Analog Communication', 'Digital Communication', 'Electromagnetic Theory', 'Microprocessors and Microcontrollers', 'Digital Signal Processing'],
      y4: ['VLSI Design', 'Embedded Systems', 'Antenna and Wave Propagation', 'Wireless Communication', 'Optical Communication'],
    },
    creators: ['Neso Academy', 'ALL ABOUT ELECTRONICS', 'Engineering Funda', 'NPTEL'],
  },
  ee: {
    label: 'Electrical (EE / EEE)',
    name: 'B.Tech EE',
    years: {
      y2: ['Network Analysis', 'Electrical Machines', 'Analog Electronics', 'Digital Electronics', 'Electromagnetic Fields', 'Electrical Measurements'],
      y3: ['Power Systems', 'Control Systems', 'Power Electronics', 'Microprocessors', 'Signals and Systems'],
      y4: ['Switchgear and Protection', 'Electric Drives', 'Renewable Energy', 'HVDC Transmission', 'Utilization of Electrical Energy'],
    },
    creators: ['Neso Academy', 'ALL ABOUT ELECTRONICS', 'Ekeeda', 'NPTEL'],
  },
  me: {
    label: 'Mechanical (ME)',
    name: 'B.Tech ME',
    years: {
      y2: ['Strength of Materials', 'Thermodynamics', 'Fluid Mechanics', 'Manufacturing Processes', 'Material Science', 'Kinematics of Machines'],
      y3: ['Theory of Machines', 'Heat Transfer', 'Machine Design', 'IC Engines', 'Applied Thermodynamics', 'Metrology'],
      y4: ['Refrigeration and Air Conditioning', 'CAD CAM', 'Industrial Engineering', 'Automobile Engineering', 'Finite Element Analysis'],
    },
    creators: ['Ekeeda', 'Learn Engineering', 'NPTEL', 'Engineering Funda'],
  },
  ce: {
    label: 'Civil (CE)',
    name: 'B.Tech Civil',
    years: {
      y2: ['Strength of Materials', 'Surveying', 'Fluid Mechanics', 'Building Materials', 'Engineering Geology'],
      y3: ['Structural Analysis', 'Soil Mechanics', 'RCC Design', 'Transportation Engineering', 'Hydrology', 'Environmental Engineering'],
      y4: ['Steel Structures', 'Foundation Engineering', 'Construction Management', 'Estimation and Costing', 'Irrigation Engineering'],
    },
    creators: ['Ekeeda', 'NPTEL', 'Civil Engineering Academy'],
  },
};

const YEARS: { id: 'y1' | 'y2' | 'y3' | 'y4'; label: string }[] = [
  { id: 'y1', label: '1st year' },
  { id: 'y2', label: '2nd year' },
  { id: 'y3', label: '3rd year' },
  { id: 'y4', label: '4th year' },
];

const BTECH: ExamInfo = {
  id: 'btech',
  group: 'engineering',
  label: 'B.Tech',
  covers: 'CSE · ECE · EE · ME · Civil, year by year',
  icon: 'graduation-cap',
  emoji: '🛠️',
  name: 'B.Tech',
  description: 'Your engineering degree: the subjects of your branch and year, semester exams included.',
  searchHint: 'btech',
  keywords: ['btech', 'b.tech', 'b tech', 'engineering lecture', 'semester exam', 'aktu', 'vtu', 'gtu', 'mumbai university', 'anna university', 'nptel'],
  topics: [],
  questions: [
    {
      id: 'branch',
      prompt: 'Which branch?',
      defaults: ['cse'],
      options: Object.entries(BTECH_SUBJECTS).map(([id, b]) => opt(id, b.label, { name: b.name, searchHint: `${b.name.toLowerCase()} lectures`, creators: b.creators })),
    },
    {
      id: 'skills',
      prompt: 'What else are you learning alongside?',
      help: 'Each one becomes a topic in your Space, next to your subjects. Pick as many as you like.',
      multi: true,
      showIf: { question: 'branch', anyOf: ['cse'] },
      defaults: ['dsa', 'webdev', 'aiml'],
      options: SKILLS.filter((k) => !k.branches).map((k) => opt(k.id, k.name, { topics: [t(k.name, k.keywords, 'Skills & placements')] })),
    },
    {
      id: 'skills-core',
      prompt: 'Anything else alongside your degree?',
      help: 'Optional. Each one becomes a topic in your Space.',
      multi: true,
      showIf: { question: 'branch', anyOf: ['ece', 'ee', 'me', 'ce'] },
      defaults: ['placements'],
      options: SKILLS.map((k) => opt(k.id, k.name, { topics: [t(k.name, k.keywords, 'Skills & placements')] })),
    },
    {
      id: 'year',
      prompt: 'Which year are you in?',
      help: 'Pick more than one if you are revising earlier subjects too.',
      multi: true,
      defaults: ['y2'],
      options: YEARS.map((y) => opt(y.id, y.label)),
    },
  ],
  creators: ['NPTEL', 'Neso Academy'],
};


/* ─── College & school: BCA, B.Sc, B.Com, MBBS, Class 11–12 ────────────────── */

/** A subject with its subtopics: the B.Tech list when it has the subject, else these. */
const subject = (group: string, name: string, extra: string[] = []) => t(name, [name.toLowerCase(), ...(SUBTOPICS[name] ?? []), ...extra], group);
/** Year (or phase) → subjects, for degrees asked "which year are you in?". */
type ByYear = Record<string, { label: string; subjects: [string, string[]?][] }>;
const yearQuestion = (years: ByYear, defaults: string[], prompt = 'Which year are you in?'): ExamQuestion => ({
  id: 'year',
  prompt,
  help: 'Pick more than one if you are revising earlier subjects too.',
  multi: true,
  defaults,
  options: Object.entries(years).map(([id, y]) => opt(id, y.label, { topics: y.subjects.map(([name, extra]) => subject(y.label, name, extra)) })),
});

const BCA_YEARS: ByYear = {
  y1: { label: '1st year', subjects: [['Computer Fundamentals', ['computer fundamentals', 'number system', 'computer memory', 'input output devices']], ['Programming in C'], ['Digital Electronics'], ['Discrete Mathematics'], ['Office Automation', ['ms word', 'ms excel', 'ms powerpoint']]] },
  y2: { label: '2nd year', subjects: [['Data Structures'], ['Object Oriented Programming', ['c++', 'oops in c++']], ['DBMS'], ['Operating System'], ['Computer Networks'], ['Java Programming', ['java', 'core java', 'jdbc', 'multithreading in java']]] },
  y3: { label: '3rd year', subjects: [['Python Programming', ['python', 'python for beginners', 'pandas', 'numpy']], ['Web Development', ['html', 'css', 'javascript', 'php', 'react']], ['Software Engineering'], ['Cloud Computing'], ['Machine Learning'], ['Mobile App Development', ['android development', 'flutter', 'kotlin']]] },
};

const BCA: ExamInfo = {
  id: 'bca',
  group: 'degrees',
  label: 'BCA',
  covers: 'Computer applications, year by year',
  icon: 'code',
  emoji: '💻',
  name: 'BCA',
  description: 'BCA: the subjects of your year, with programming and placements alongside.',
  searchHint: 'bca',
  keywords: ['bca', 'bca lectures', 'bca semester', 'bca 1st year', 'bca 2nd year', 'bca 3rd year', '~computer applications', '~semester exam'],
  topics: [],
  questions: [yearQuestion(BCA_YEARS, ['y1'])],
  creators: ['Gate Smashers', "Jenny's Lectures", 'Apna College', 'CodeWithHarry', 'Neso Academy'],
};

const BSC_MAJORS: [string, string, [string, string[]][]][] = [
  ['physics', 'Physics', [['Mechanics', ['classical mechanics', 'newtons laws', 'rigid body dynamics']], ['Electricity & Magnetism', ['electrostatics', 'magnetostatics', 'maxwell equations']], ['Waves & Optics', ['interference', 'diffraction', 'polarization']], ['Thermal Physics', ['thermodynamics', 'kinetic theory', 'statistical mechanics']], ['Mathematical Physics', ['vector analysis', 'fourier series', 'special functions']], ['Quantum Mechanics', ['schrodinger equation', 'wave function', 'uncertainty principle']], ['Solid State Physics', ['crystal structure', 'band theory', 'semiconductors']], ['Electronics', ['diodes', 'transistors', 'op amp']]]],
  ['chemistry', 'Chemistry', [['Physical Chemistry', ['chemical kinetics', 'thermodynamics', 'electrochemistry', 'quantum chemistry']], ['Organic Chemistry', ['reaction mechanism', 'stereochemistry', 'named reactions', 'aromatic compounds']], ['Inorganic Chemistry', ['coordination chemistry', 'chemical bonding', 'p block', 'd block', 'organometallics']], ['Analytical Chemistry', ['titration', 'chromatography', 'spectroscopy']]]],
  ['maths', 'Mathematics', [['Calculus', ['limits', 'differentiation', 'integration', 'partial derivatives']], ['Real Analysis', ['sequences and series', 'continuity', 'riemann integration']], ['Abstract Algebra', ['group theory', 'ring theory', 'subgroups']], ['Linear Algebra', ['vector spaces', 'linear transformations', 'eigenvalues']], ['Differential Equations', ['ordinary differential equations', 'partial differential equations']], ['Complex Analysis', ['analytic functions', 'contour integration', 'residue theorem']], ['Probability & Statistics', ['probability', 'random variables', 'distributions']]]],
  ['cs', 'Computer Science', [['Programming in C', []], ['Data Structures', []], ['DBMS', []], ['Operating System', []], ['Computer Networks', []], ['Python Programming', ['python', 'pandas', 'numpy']]]],
  ['bio', 'Life Sciences', [['Botany', ['plant physiology', 'plant anatomy', 'taxonomy']], ['Zoology', ['animal physiology', 'invertebrates', 'chordates']], ['Cell Biology', ['cell structure', 'cell division', 'cell organelles']], ['Genetics', ['mendelian genetics', 'linkage', 'mutation']], ['Biochemistry', ['enzymes', 'metabolism', 'proteins']], ['Ecology', ['ecosystem', 'biodiversity', 'population ecology']]]],
];

const BSC: ExamInfo = {
  id: 'bsc',
  group: 'degrees',
  label: 'B.Sc',
  covers: 'Physics · Chemistry · Maths · CS · Life sciences',
  icon: 'atom',
  emoji: '🔬',
  name: 'B.Sc',
  description: 'B.Sc: each of your subjects, split into the papers you study.',
  searchHint: 'bsc',
  keywords: ['bsc', 'b.sc', 'b sc', 'bsc lectures', 'bsc 1st year', 'bsc 2nd year', 'bsc 3rd year', '~msc', '~csir net'],
  topics: [],
  questions: [
    {
      id: 'majors',
      prompt: 'Which subjects do you study?',
      help: 'Most B.Sc courses have two or three. Each becomes a subject in your Space, with its papers inside.',
      multi: true,
      defaults: ['physics', 'chemistry', 'maths'],
      options: BSC_MAJORS.map(([id, label, papers]) => opt(id, label, { topics: papers.map(([name, extra]) => subject(label, name, extra)) })),
    },
  ],
  creators: ['Physics Wallah', 'Unacademy CSIR NET', 'NPTEL', 'Neso Academy', 'Dr. Gajendra Purohit'],
};

const BCOM_YEARS: ByYear = {
  y1: { label: '1st year', subjects: [['Financial Accounting', ['journal entries', 'ledger', 'trial balance', 'final accounts', 'depreciation']], ['Business Economics', ['microeconomics', 'demand and supply', 'elasticity', 'market structures']], ['Business Law', ['indian contract act', 'sale of goods act', 'partnership act']], ['Business Mathematics & Statistics', ['business mathematics', 'business statistics', 'measures of central tendency', 'correlation and regression']], ['Business Communication', ['business communication', 'report writing']]] },
  y2: { label: '2nd year', subjects: [['Corporate Accounting', ['issue of shares', 'company final accounts', 'amalgamation']], ['Cost Accounting', ['cost sheet', 'marginal costing', 'standard costing']], ['Company Law', ['companies act 2013', 'memorandum of association']], ['Income Tax', ['income tax', 'heads of income', 'tax computation']], ['Banking & Insurance', ['banking', 'insurance', 'rbi functions']]] },
  y3: { label: '3rd year', subjects: [['Auditing', ['auditing', 'vouching', 'internal control']], ['Management Accounting', ['ratio analysis', 'fund flow', 'cash flow statement', 'budgetary control']], ['GST', ['gst', 'input tax credit', 'gst returns']], ['Financial Management', ['capital budgeting', 'cost of capital', 'working capital']], ['Marketing Management', ['marketing mix', '4ps of marketing', 'consumer behaviour']]] },
};

const BCOM: ExamInfo = {
  id: 'bcom',
  group: 'degrees',
  label: 'B.Com',
  covers: 'Accounts, tax, law and economics, year by year',
  icon: 'banknote',
  emoji: '📊',
  name: 'B.Com',
  description: 'B.Com: accounting, tax, law and economics for your year.',
  searchHint: 'bcom',
  keywords: ['bcom', 'b.com', 'b com', 'bcom lectures', 'bcom 1st year', 'bcom 2nd year', 'bcom 3rd year', '~commerce', '~ca foundation'],
  topics: [],
  questions: [yearQuestion(BCOM_YEARS, ['y1'])],
  creators: ['Commerce Wallah', 'Edu91', 'CA Wallah', 'Study at Home with Neha'],
};

const MBBS_PHASES: ByYear = {
  p1: { label: '1st year', subjects: [['Anatomy', ['upper limb', 'lower limb', 'thorax', 'abdomen anatomy', 'head and neck', 'neuroanatomy', 'embryology', 'histology']], ['Physiology', ['cardiovascular physiology', 'respiratory physiology', 'renal physiology', 'nerve muscle physiology', 'endocrine physiology', 'gi physiology']], ['Biochemistry', ['carbohydrate metabolism', 'lipid metabolism', 'enzymes', 'vitamins', 'amino acid metabolism', 'molecular biology']]] },
  p2: { label: '2nd year', subjects: [['Pathology', ['cell injury', 'inflammation', 'neoplasia', 'hematology', 'general pathology', 'systemic pathology']], ['Pharmacology', ['pharmacokinetics', 'autonomic pharmacology', 'antimicrobials', 'cns pharmacology', 'cardiovascular drugs']], ['Microbiology', ['bacteriology', 'virology', 'mycology', 'parasitology', 'immunology']], ['Forensic Medicine', ['forensic medicine', 'toxicology', 'medical jurisprudence']]] },
  p3: { label: '3rd year', subjects: [['Community Medicine', ['psm', 'epidemiology', 'biostatistics', 'nutrition', 'national health programmes']], ['ENT', ['ent', 'otology', 'rhinology', 'laryngology']], ['Ophthalmology', ['ophthalmology', 'glaucoma', 'cataract', 'retina', 'cornea']]] },
  p4: { label: 'Final year', subjects: [['General Medicine', ['cardiology', 'respiratory medicine', 'gastroenterology', 'nephrology', 'neurology', 'endocrinology']], ['General Surgery', ['general surgery', 'trauma surgery', 'hernia', 'breast surgery', 'urology']], ['Obstetrics & Gynaecology', ['obstetrics', 'gynaecology', 'antenatal care', 'labour']], ['Paediatrics', ['paediatrics', 'pediatrics', 'neonatology', 'growth and development', 'immunization']], ['Orthopaedics', ['orthopaedics', 'fractures', 'bone tumors']]] },
};

const MBBS: ExamInfo = {
  id: 'mbbs',
  group: 'degrees',
  label: 'MBBS',
  covers: 'Phase by phase · NEET PG alongside',
  icon: 'stethoscope',
  emoji: '⚕️',
  name: 'MBBS',
  description: 'MBBS: the subjects of your phase, from anatomy to the final-year clinicals.',
  searchHint: 'mbbs',
  keywords: ['mbbs', 'mbbs lectures', 'mbbs 1st year', 'mbbs 2nd year', 'mbbs 3rd year', 'mbbs final year', 'neet pg', '~medical lecture', '~fmge'],
  topics: [],
  questions: [yearQuestion(MBBS_PHASES, ['p1'])],
  creators: ['Ninja Nerd', 'Osmosis from Elsevier', 'Armando Hasudungan', 'Dr. Najeeb Lectures', 'Marrow'],
};

const SCHOOL_SUBJECTS: Record<string, [string, Record<'c11' | 'c12', string[]>][]> = {
  physics: [['Physics', { c11: ['units and measurements', 'kinematics', 'laws of motion', 'work energy and power', 'rotational motion', 'gravitation', 'thermodynamics', 'oscillations', 'waves'], c12: ['electrostatics', 'current electricity', 'magnetism', 'electromagnetic induction', 'alternating current', 'ray optics', 'wave optics', 'dual nature', 'atoms and nuclei', 'semiconductors'] }]],
  chemistry: [['Chemistry', { c11: ['some basic concepts of chemistry', 'structure of atom', 'chemical bonding', 'thermodynamics chemistry', 'equilibrium', 'redox reactions', 'organic chemistry basic principles', 'hydrocarbons'], c12: ['solutions', 'electrochemistry', 'chemical kinetics', 'd and f block', 'coordination compounds', 'haloalkanes and haloarenes', 'alcohols phenols ethers', 'aldehydes ketones', 'amines', 'biomolecules'] }]],
  maths: [['Mathematics', { c11: ['sets', 'relations and functions', 'trigonometry', 'complex numbers', 'permutations and combinations', 'binomial theorem', 'sequence and series', 'straight lines', 'conic sections', 'limits and derivatives', 'statistics', 'probability'], c12: ['matrices', 'determinants', 'continuity and differentiability', 'application of derivatives', 'integrals', 'differential equations', 'vector algebra', 'three dimensional geometry', 'linear programming'] }]],
  biology: [['Biology', { c11: ['the living world', 'plant kingdom', 'animal kingdom', 'cell the unit of life', 'cell cycle', 'photosynthesis', 'respiration in plants', 'breathing and exchange of gases', 'body fluids and circulation', 'neural control'], c12: ['sexual reproduction in flowering plants', 'human reproduction', 'principles of inheritance', 'molecular basis of inheritance', 'evolution', 'human health and disease', 'biotechnology', 'organisms and populations', 'ecosystem'] }]],
  accountancy: [['Accountancy', { c11: ['journal entries', 'ledger', 'trial balance', 'bank reconciliation statement', 'depreciation', 'final accounts'], c12: ['partnership accounts', 'admission of partner', 'retirement of partner', 'issue of shares', 'cash flow statement', 'ratio analysis'] }]],
  business: [['Business Studies', { c11: ['nature and purpose of business', 'forms of business organisation', 'business services', 'social responsibility'], c12: ['principles of management', 'planning', 'organising', 'staffing', 'directing', 'controlling', 'financial markets', 'marketing'] }]],
  economics: [['Economics', { c11: ['microeconomics', 'consumer equilibrium', 'theory of demand', 'production and costs', 'statistics for economics'], c12: ['macroeconomics', 'national income', 'money and banking', 'government budget', 'balance of payments', 'indian economic development'] }]],
  history: [['History', { c11: ['themes in world history', 'early societies', 'empires', 'changing traditions'], c12: ['harappan civilisation', 'kings and chronicles', 'bhakti sufi traditions', 'colonialism', 'mahatma gandhi and the nationalist movement', 'framing the constitution'] }]],
  polsci: [['Political Science', { c11: ['indian constitution at work', 'political theory', 'rights', 'federalism'], c12: ['contemporary world politics', 'politics in india since independence', 'cold war', 'globalisation'] }]],
  geography: [['Geography', { c11: ['fundamentals of physical geography', 'india physical environment', 'landforms', 'climate'], c12: ['fundamentals of human geography', 'india people and economy', 'population', 'transport and communication'] }]],
};
const STREAMS: [string, string, string[]][] = [
  ['pcm', 'Science · PCM', ['physics', 'chemistry', 'maths']],
  ['pcb', 'Science · PCB', ['physics', 'chemistry', 'biology']],
  ['commerce', 'Commerce', ['accountancy', 'business', 'economics']],
  ['humanities', 'Humanities', ['history', 'polsci', 'geography', 'economics']],
];

const SCHOOL: ExamInfo = {
  id: 'school',
  group: 'degrees',
  label: 'Class 11–12',
  covers: 'CBSE & state boards · Science, Commerce, Humanities',
  icon: 'book-open',
  emoji: '📚',
  name: 'Class 11–12',
  description: 'Classes 11 and 12: your stream’s subjects, NCERT chapter by chapter.',
  // Not "class 12": every search would carry it, Class 11 ones too ("Class 11 Physics class 12").
  searchHint: 'ncert',
  keywords: ['class 11', 'class 12', 'cbse', 'ncert', 'board exam', '~one shot', '~state board'],
  topics: [],
  questions: [
    { id: 'stream', prompt: 'Which stream?', defaults: ['pcm'], options: STREAMS.map(([id, label]) => opt(id, label, { name: `Class 11–12 ${label.replace('Science · ', '')}` })) },
    { id: 'class', prompt: 'Which class?', help: 'Pick both if you are revising Class 11 too.', multi: true, defaults: ['c11', 'c12'], options: [opt('c11', 'Class 11'), opt('c12', 'Class 12')] },
  ],
  creators: ['Physics Wallah', 'Magnet Brains', 'Vedantu', 'Learnohub'],
};

/** Class 11–12 depends on two answers at once (stream × class), so it is built here, subject by subject. */
function schoolTopics(answers: ExamAnswers): Topic[] {
  const stream = STREAMS.find(([id]) => id === answers.stream?.[0]) ?? STREAMS[0];
  const classes = (answers.class?.length ? answers.class : ['c11', 'c12']).slice().sort() as ('c11' | 'c12')[];
  return stream[2].flatMap((key) =>
    (SCHOOL_SUBJECTS[key] ?? []).flatMap(([name, chapters]) => classes.map((c) => t(`Class ${c.slice(1)} ${name}`, [`class ${c.slice(1)} ${name.toLowerCase()}`, ...chapters[c]], name))),
  );
}

export const EXAMS: readonly ExamInfo[] = [UPSC, SSC, BANKING, RAILWAYS, STATE_PSC, DEFENCE, TEACHING, JUDICIARY, JEE, NEET, GATE, CAT, BTECH, BCA, BSC, BCOM, MBBS, SCHOOL];

export const EXAM_IDS: ReadonlySet<string> = new Set(EXAMS.map((e) => e.id));
export const isExamId = (id: unknown): id is ExamId => typeof id === 'string' && EXAM_IDS.has(id);
export const examInfo = (id: string | null | undefined): ExamInfo | null => EXAMS.find((e) => e.id === id) ?? null;

export type ExamAnswers = Record<string, string[]>;

export const defaultAnswers = (exam: ExamInfo): ExamAnswers => Object.fromEntries(exam.questions.map((q) => [q.id, [...q.defaults]]));

/** The chosen options, question by question, in question order. */
/** Whether a question applies to these answers (`showIf`). */
export function asked(q: ExamQuestion, exam: ExamInfo, answers: ExamAnswers): boolean {
  if (!q.showIf) return true;
  const other = exam.questions.find((x) => x.id === q.showIf!.question);
  const picked = answers[q.showIf.question]?.length ? answers[q.showIf.question] : other?.defaults ?? [];
  return picked.some((v) => q.showIf!.anyOf.includes(v));
}

/** Answer key holding topic ids the learner switched off on the last step ("I don't study this one"). */
export const EXCLUDE = 'exclude';

function chosen(exam: ExamInfo, answers: ExamAnswers): ExamOption[] {
  return exam.questions.filter((q) => asked(q, exam, answers)).flatMap((q) => {
    const picked = answers[q.id]?.length ? answers[q.id] : q.defaults;
    return q.options.filter((o) => picked.includes(o.id));
  });
}

/** B.Tech's subjects depend on two answers at once (branch × years), so they are built here. */
function btechTopics(answers: ExamAnswers): Topic[] {
  const branch = BTECH_SUBJECTS[answers.branch?.[0] ?? 'cse'] ?? BTECH_SUBJECTS.cse;
  const years = (answers.year?.length ? answers.year : ['y2']).slice().sort();
  return years.flatMap((y) => {
    const label = YEARS.find((x) => x.id === y)?.label ?? y;
    const group = label.replace(/^./, (c) => c.toUpperCase());
    const names = y === 'y1' ? FIRST_YEAR : branch.years[y as 'y2' | 'y3' | 'y4'] ?? [];
    return names.map((n) => t(n, [n.toLowerCase(), ...(SUBTOPICS[n] ?? [])], group));
  });
}

/** Popular creators for this goal and these answers (chosen options first). */
export function examCreators(exam: ExamInfo, answers: ExamAnswers): string[] {
  return [...new Set([...chosen(exam, answers).flatMap((o) => o.creators ?? []), ...exam.creators])];
}

/**
 * The Space for a goal and the learner's answers. Its id is the goal's id (one UPSC Space, one B.Tech
 * Space), so the exam lock (modes/unlock.ts) always knows which Space is "the exam".
 */
export function buildExamMode(id: ExamId, answers: ExamAnswers = {}, now = 0): LearningMode {
  const exam = examInfo(id)!;
  const picks = chosen(exam, answers);
  const named = picks.find((o) => o.name);
  // Degree subjects first, then skills: the order the topic bar shows them in.
  const skills = picks.flatMap((o) => o.topics ?? []).filter((tp) => tp.group === 'Skills & placements');
  const others = picks.flatMap((o) => o.topics ?? []).filter((tp) => tp.group !== 'Skills & placements');
  const topics = [...exam.topics, ...others, ...(id === 'btech' ? btechTopics(answers) : []), ...(id === 'school' ? schoolTopics(answers) : []), ...skills];
  const seen = new Set<string>(answers[EXCLUDE] ?? []);
  return {
    id,
    name: named?.name ?? exam.name,
    emoji: exam.emoji,
    icon: exam.icon,
    kind: 'learning',
    discovery: true,
    description: exam.description,
    searchHint: picks.find((o) => o.searchHint)?.searchHint ?? exam.searchHint,
    keywords: [...new Set([...exam.keywords, ...picks.flatMap((o) => o.keywords ?? [])])],
    topics: topics.filter((tp) => !seen.has(tp.id) && !!seen.add(tp.id)),
    blockedKeywords: ['prank', 'roast', 'motivational status'],
    allowedChannels: [],
    blockedChannels: [],
    dailyLimitMinutes: 180,
    filterOverride: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** The built-in versions (default answers), offered as templates elsewhere. */
export const EXAM_MODES: LearningMode[] = EXAMS.map((e) => buildExamMode(e.id, defaultAnswers(e)));
