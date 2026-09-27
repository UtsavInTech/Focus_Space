import { describe, expect, it } from 'vitest';
import { correctSubject, inferSubjects, subjectPhrases } from './subjects';

describe('subjectPhrases', () => {
  it('drops everything that is not the subject', () => {
    expect(subjectPhrases('I want to. learn system desing so add it as a space for now')).toEqual(['learn system desing']);
    expect(subjectPhrases('I want to learn')).toEqual([]);
  });

  it('splits a list into subjects', () => {
    expect(subjectPhrases('I would like these modes:\n- system design\n- learning Spanish\n- learning French\n- content creation')).toEqual(['system design', 'learning spanish', 'learning french', 'content creation']);
    expect(subjectPhrases('DSA, web dev and SQL')).toEqual(['dsa', 'web dev', 'sql']);
  });
});

describe('correctSubject', () => {
  it('fixes a small typo against known subjects, and leaves unknown ones alone', () => {
    expect(correctSubject('system desing')).toBe('system design');
    expect(correctSubject('pottery')).toBe('pottery');
  });
});

describe('inferSubjects', () => {
  it('turns the sentence from the bug report into one System Design Space', () => {
    const [only, ...rest] = inferSubjects('I want to. learn system desing so add it as a space for now');
    expect(rest).toEqual([]);
    expect(only.name).toBe('System Design');
  });

  it('makes one Space per subject in a spoken list', () => {
    expect(inferSubjects('hey I want system design, learning Spanish, learning French and content creation').map((s) => s.name)).toEqual(['System Design', 'Learn Spanish', 'Learn French', 'Content Creation']);
  });
});
