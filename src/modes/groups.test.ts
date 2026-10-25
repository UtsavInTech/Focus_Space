import { describe, expect, it } from 'vitest';
import { buildExamMode, defaultAnswers, examInfo } from './exams';
import { upgradeTopics } from './curricula';
import { discoveryQueriesFor } from '@/learning/discovery';
import { groupId, parsePath, scopeIds, subjectAsTopic, subjectOf, subjectsOf, withSubtopic, withTopic } from './groups';

describe('subjects: a Space as subject → its parts', () => {
  const neet = buildExamMode('neet', defaultAnswers(examInfo('neet')!));

  it('NEET splits Chemistry into Physical, Organic and Inorganic, like Biology into Botany and Zoology', () => {
    const subjects = subjectsOf(neet);
    expect(subjects.map((s) => s.title)).toEqual(['Biology', 'Physics', 'Chemistry']);
    expect(subjects[2].topics.map((t) => t.name)).toEqual(['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry']);
    expect(subjects[1].topics.length).toBeGreaterThan(2);
  });

  it('an older NEET Space (one Physics, one Chemistry topic) catches up, keeping Botany’s id', () => {
    const old = ['Botany', 'Zoology', 'Physics', 'Chemistry'].map((name, i) => ({ id: `${['biology', 'biology', 'physics', 'chemistry'][i]}-${name.toLowerCase()}`, name, keywords: [], group: ['Biology', 'Biology', 'Physics', 'Chemistry'][i] }));
    const upgraded = upgradeTopics('neet', old);
    expect(upgraded.map((t) => t.name)).toContain('Organic Chemistry');
    expect(upgraded.find((t) => t.name === 'Botany')?.id).toBe(old[0].id);
  });

  it('a subject page covers all its topics and searches YouTube for each', () => {
    const chem = subjectOf(neet, groupId('Chemistry'))!;
    expect(scopeIds(neet, chem.id)).toHaveLength(3);
    const queries = discoveryQueriesFor(neet, subjectAsTopic(chem));
    expect(queries).toEqual(expect.arrayContaining(['Chemistry neet', 'organic chemistry neet']));
  });

  it('a topic page keeps going: one search per subtopic', () => {
    const botany = neet.topics.find((t) => t.name === 'Botany')!;
    const queries = discoveryQueriesFor(neet, botany);
    expect(queries).toContain('photosynthesis neet');
    expect(queries.length).toBeGreaterThan(8);
  });

  it('learners add subtopics and topics where they are, never twice', () => {
    const organic = neet.topics.find((t) => t.name === 'Organic Chemistry')!;
    const once = withSubtopic(neet.topics, organic.id, 'Named Reactions');
    expect(withSubtopic(once, organic.id, 'named reactions')).toEqual(once);
    expect(once.find((t) => t.id === organic.id)!.keywords).toContain('named reactions');

    const added = withTopic(neet.topics, 'Environmental Chemistry', 'Chemistry');
    const at = added.topics.findIndex((t) => t.id === added.id);
    expect(added.topics[at - 1].name).toBe('Inorganic Chemistry');
    expect(added.topics[at].group).toBe('Chemistry');
  });

  it('a course FocusSpace does not know becomes a path from what the learner writes', () => {
    const topics = parsePath('Accounting: journal entries, ledger\n- Business Law\nEconomics: micro, macro');
    expect(subjectsOf({ ...neet, topics }).map((s) => s.title)).toEqual(['Accounting', 'Subjects', 'Economics']);
    expect(topics.filter((t) => t.group === 'Accounting').map((t) => t.name)).toEqual(['journal entries', 'ledger']);
  });

  it('college and school goals come as subjects too', () => {
    expect(subjectsOf(buildExamMode('bsc', { majors: ['physics', 'chemistry'] })).map((s) => s.title)).toEqual(['Physics', 'Chemistry']);
    expect(subjectsOf(buildExamMode('school', { stream: ['pcb'], class: ['c12'] })).map((s) => s.title)).toEqual(['Physics', 'Chemistry', 'Biology']);
    expect(buildExamMode('mbbs', { year: ['p1'] }).topics.map((t) => t.name)).toEqual(['Anatomy', 'Physiology', 'Biochemistry']);
  });
});
