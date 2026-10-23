import { normalizeText } from '../text';
import { PhraseIndex, tokenStems } from './matcher';

/**
 * Off-domain guard.
 *
 * Some videos belong so clearly to another world that no keyword overlap should let them into a Space.
 * "SSC CGL Computer Awareness: Operating System" shares a word with System Design and "Temple
 * Architecture | UPSC Art & Culture" shares one with Software Architecture, yet neither is either.
 * Competitive-exam prep is the loudest case on Indian YouTube: a learner who once watched SSC videos
 * gets them in every search and recommendation, so they reach discovery for any subject.
 *
 * A family is the Space's *own* when its configuration names any of the family's markers (a UPSC Space
 * names "upsc"), and then it is never penalised. A foreign family is penalised hard, or more gently
 * when it is a sibling of the Space's own (an SSC video in a UPSC Space still often teaches the same
 * polity chapter). A title that also names the Space's own family is never off-domain.
 */

export type DomainGroup = 'gov-exam' | 'school-entrance';

interface DomainFamily {
  id: string;
  group: DomainGroup;
  /** Markers matched in titles, channel names and (with more care) descriptions. */
  markers: string[];
  /** Channel brands that only make this kind of content. Matched against the channel name. */
  brands?: string[];
}

/*
 * Deliberately left out because they mean something else in a learning Space: "ips" (intrusion
 * prevention), "nda" (non-disclosure agreement), "cds" (credit default swaps), "tet", "ras", "cpo",
 * "notification", "mains" (electricity), and GATE, which is the CS learner's own exam.
 */
export const DOMAIN_FAMILIES: readonly DomainFamily[] = [
  {
    id: 'upsc',
    group: 'gov-exam',
    markers: ['upsc', 'upsc cse', 'civil services', 'ias exam', 'ias preparation', 'ias officer', 'upsc prelims', 'upsc mains', 'gs paper', 'gs 1', 'gs 2', 'gs 3', 'gs 4', 'csat', 'essay paper', 'optional subject', 'ias'],
    brands: ['studyiq', 'study iq', 'drishti ias', 'vision ias', 'next ias', 'forum ias', 'insights ias', 'vajiram', 'sleepy classes', 'onlyias', 'only ias', 'rau s ias', 'unacademy upsc', 'pw onlyias'],
  },
  {
    id: 'state-psc',
    group: 'gov-exam',
    markers: ['uppsc', 'bpsc', 'mppsc', 'rpsc', 'tnpsc', 'kpsc', 'appsc', 'tspsc', 'hpsc', 'opsc', 'wbcs', 'mpsc', 'gpsc', 'cgpsc', 'jpsc', 'ukpsc', 'state psc', 'pcs exam', 'pcs j', 'uppcs', 'ro aro'],
  },
  {
    id: 'ssc',
    group: 'gov-exam',
    markers: ['ssc', 'ssc cgl', 'cgl', 'chsl', 'ssc chsl', 'ssc gd', 'ssc mts', 'ssc cpo', 'ssc je', 'steno', 'stenographer', 'selection post'],
    brands: ['adda247', 'ssc adda', 'exampur', 'rojgar with ankit', 'careerwill', 'rankers gurukul', 'wifistudy', 'testbook', 'sscwallah', 'ssc wallah', 'parcham classes', 'utkarsh classes', 'mission ssc'],
  },
  {
    id: 'banking',
    group: 'gov-exam',
    markers: ['ibps', 'ibps po', 'ibps clerk', 'sbi po', 'sbi clerk', 'bank po', 'bank clerk', 'rbi grade b', 'rbi assistant', 'nabard', 'rrb po', 'rrb clerk', 'banking exam', 'banking exams', 'lic aao', 'lic ado', 'sebi grade a'],
    brands: ['bankers adda', 'bankersadda', 'oliveboard', 'ixambee', 'smartkeeda', 'guidely'],
  },
  {
    id: 'railway',
    group: 'gov-exam',
    markers: ['rrb', 'rrb ntpc', 'ntpc', 'rrb je', 'rrb alp', 'group d', 'railway exam', 'railway exams', 'railway bharti', 'rpf constable'],
  },
  {
    id: 'defence-police',
    group: 'gov-exam',
    markers: ['nda exam', 'cds exam', 'afcat', 'capf', 'agniveer', 'police constable', 'up police', 'delhi police', 'si exam', 'army gd', 'navy agniveer'],
  },
  {
    id: 'teaching',
    group: 'gov-exam',
    markers: ['ctet', 'reet', 'uptet', 'htet', 'super tet', 'kvs', 'dsssb', 'b ed entrance', 'ugc net', 'nta net'],
  },
  {
    id: 'gov-general',
    group: 'gov-exam',
    // Not an exam of its own: the shared vocabulary of every government exam channel.
    markers: [
      'current affairs',
      'daily current affairs',
      'static gk',
      'gk question',
      'gk questions',
      'gk quiz',
      'general awareness',
      'general studies',
      'sarkari naukri',
      'sarkari',
      'govt exam',
      'govt exams',
      'government exam',
      'government exams',
      'admit card',
      'answer key',
      'cut off',
      'cutoff marks',
      'exam date',
      'vacancy',
      'bharti',
      'computer awareness',
      'reasoning tricks',
      'maths tricks',
      'math tricks',
      'english for ssc',
      'arithmetic tricks',
    ],
  },
  {
    id: 'jee',
    group: 'school-entrance',
    markers: ['jee', 'jee main', 'jee mains', 'jee advanced', 'iit jee', 'bitsat'],
    brands: ['vedantu jee', 'mathongo', 'unacademy jee', 'physics wallah jee', 'arjuna jee'],
  },
  {
    id: 'neet',
    group: 'school-entrance',
    markers: ['neet', 'neet ug', 'neet pg', 'aiims', 'mbbs entrance'],
    brands: ['vedantu neet', 'unacademy neet', 'competition wallah'],
  },
  {
    id: 'school',
    group: 'school-entrance',
    markers: ['class 9', 'class 10', 'class 11', 'class 12', 'class 9th', 'class 10th', 'class 11th', 'class 12th', 'cbse', 'icse', 'board exam', 'board exams', 'ncert solutions', 'cuet'],
  },
];

const FAMILY_BY_ID = new Map(DOMAIN_FAMILIES.map((f) => [f.id, f]));
const MARKERS = new PhraseIndex(DOMAIN_FAMILIES.flatMap((f) => f.markers.map((term) => ({ term, data: f.id }))));
const BRANDS = new PhraseIndex(DOMAIN_FAMILIES.flatMap((f) => (f.brands ?? []).map((term) => ({ term, data: f.id }))));

/**
 * Hard penalty for a government-exam video in any other Space; lighter for school and entrance prep
 * (a Maths Space may well want a JEE calculus lecture); gentle for a sibling exam (SSC in a UPSC Space).
 */
export const OFF_DOMAIN_PENALTY = { foreign: 0.6, school: 0.35, sibling: 0.25 } as const;

const familiesIn = (index: PhraseIndex<string>, text: string): Map<string, string> => {
  const found = new Map<string, string>();
  if (!text) return found;
  for (const m of index.find(text, tokenStems(text))) if (!found.has(m.phrase.data)) found.set(m.phrase.data, m.phrase.key);
  return found;
};

/** The exam families a Space's own configuration names. `configText` must be normalised. */
export function ownFamilies(configText: string): Set<string> {
  const own = new Set(familiesIn(MARKERS, configText).keys());
  // Any government exam Space owns the shared government-exam vocabulary ("current affairs", "pyq").
  if ([...own].some((id) => FAMILY_BY_ID.get(id)?.group === 'gov-exam')) own.add('gov-general');
  return own;
}

export interface OffDomain {
  family: string;
  marker: string;
  where: 'title' | 'channel' | 'description';
  penalty: number;
}

/**
 * Whether a video belongs to another domain than the Space's. Title and channel name are decisive;
 * a description only counts when it names two different foreign markers, so one passing mention
 * ("also useful for SSC") does not sink a real lesson.
 */
export function offDomain(video: { title: string; channelTitle?: string; description?: string }, own: ReadonlySet<string>): OffDomain | null {
  const title = normalizeText(video.title ?? '');
  const inTitle = familiesIn(MARKERS, title);
  // A title naming the Space's own exam is on-domain whatever else it names ("UPSC & SSC Polity").
  if ([...inTitle.keys()].some((id) => own.has(id))) return null;

  const ownGroups = new Set([...own].map((id) => FAMILY_BY_ID.get(id)?.group));
  const penaltyFor = (id: string) => {
    const group = FAMILY_BY_ID.get(id)?.group;
    if (ownGroups.has(group)) return OFF_DOMAIN_PENALTY.sibling;
    return group === 'school-entrance' ? OFF_DOMAIN_PENALTY.school : OFF_DOMAIN_PENALTY.foreign;
  };
  const foreign = (found: Map<string, string>) => [...found].find(([id]) => !own.has(id));

  const t = foreign(inTitle);
  if (t) return { family: t[0], marker: t[1], where: 'title', penalty: penaltyFor(t[0]) };

  const channel = normalizeText(video.channelTitle ?? '');
  const c = foreign(new Map([...familiesIn(BRANDS, channel), ...familiesIn(MARKERS, channel)]));
  if (c) return { family: c[0], marker: c[1], where: 'channel', penalty: penaltyFor(c[0]) };

  const description = normalizeText((video.description ?? '').slice(0, 800));
  const inDescription = [...familiesIn(MARKERS, description)].filter(([id]) => !own.has(id));
  if (inDescription.length >= 2 || (inDescription.length === 1 && countMarkers(description) >= 2)) {
    const [id, marker] = inDescription[0];
    return { family: id, marker, where: 'description', penalty: penaltyFor(id) * 0.6 };
  }
  return null;
}

/** Distinct foreign-family markers in a text, used to tell a stuffed tag line from a passing mention. */
function countMarkers(text: string): number {
  return new Set(MARKERS.find(text, tokenStems(text)).map((m) => m.phrase.key)).size;
}
