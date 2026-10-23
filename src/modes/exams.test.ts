import { describe, expect, it } from 'vitest';
import { isRelevant, ruleClassifier } from '@/learning/classifier';
import { buildExamMode, defaultAnswers, EXAMS, examCreators, examInfo } from './exams';
import { examFromText } from './exam-intent';
import { DEFAULT_MODES } from './templates';
import { categoryOf } from './categories';

describe('goals build a Space as a hierarchy', () => {
  it('UPSC asks for the optional and files it under "Optional", next to Prelims and Mains', () => {
    const mode = buildExamMode('upsc', { optional: ['sociology'] });
    const groups = new Set(mode.topics.map((t) => t.group));
    expect([...groups]).toEqual(expect.arrayContaining(['Prelims · GS', 'Prelims · CSAT', 'Mains', 'Optional', 'Interview']));
    expect(mode.topics.find((t) => t.group === 'Optional')?.name).toBe('Sociology');
    expect(buildExamMode('upsc', { optional: ['undecided'] }).topics.some((t) => t.group === 'Optional')).toBe(false);
  });

  it('SSC, banking and state PSC take their name and searches from the exact exam', () => {
    expect(buildExamMode('ssc', { exam: ['chsl'] })).toMatchObject({ name: 'SSC CHSL', searchHint: 'ssc chsl' });
    expect(buildExamMode('banking', { exam: ['rbi'] }).topics.map((t) => t.name)).toContain('Finance & Management');
    const bpsc = buildExamMode('state-psc', { state: ['bpsc'] });
    expect(bpsc.name).toBe('BPSC');
    expect(bpsc.keywords).toContain('bpsc');
  });

  it('B.Tech builds branch × year subjects, and several years at once', () => {
    const cse = buildExamMode('btech', { branch: ['cse'], year: ['y3'] });
    expect(cse.name).toBe('B.Tech CSE');
    expect(cse.topics.map((t) => t.name)).toEqual(expect.arrayContaining(['Operating System', 'DBMS', 'Computer Networks']));
    const both = buildExamMode('btech', { branch: ['me'], year: ['y2', 'y3'] });
    expect(new Set(both.topics.map((t) => t.group))).toEqual(new Set(['2nd year', '3rd year']));
  });

  it('a B.Tech CSE Space keeps real lessons for its subjects', () => {
    const cse = buildExamMode('btech', { branch: ['cse'], year: ['y3'] });
    expect(isRelevant(ruleClassifier.classify({ videoId: 'os', title: 'Deadlock in Operating System | Lecture 21' }, cse))).toBe(true);
  });

  it('offers popular creators, the chosen option’s first', () => {
    expect(examCreators(examInfo('banking')!, { exam: ['rbi'] })[0]).toBe('EduTap');
    expect(examCreators(examInfo('upsc')!, {})).toContain('StudyIQ IAS');
  });

  it('every goal is a built-in template with a category, and has sensible defaults', () => {
    for (const exam of EXAMS) {
      expect(DEFAULT_MODES.some((m) => m.id === exam.id), exam.id).toBe(true);
      expect(categoryOf(exam.id), exam.id).not.toBeNull();
      expect(buildExamMode(exam.id, defaultAnswers(exam)).topics.length, exam.id).toBeGreaterThan(2);
    }
  });

  it('understands goals that are typed', () => {
    expect(examFromText('btech')).toBe('btech');
    expect(examFromText('preparing for NDA')).toBe('defence');
    expect(examFromText('CTET')).toBe('teaching');
  });
});
