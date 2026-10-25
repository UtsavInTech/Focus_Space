import { describe, expect, it } from 'vitest';
import type { WatchEntry } from '@/types/domain';
import { duration, studentReport } from './student-report';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 26, 15, 0); // 26 Oct 2026, 8:30 pm IST
const lessons = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'].map((videoId, i) => ({ videoId, topicId: 't', number: i + 1 }));
const entry = (videoId: string, progress: number, daysAgo: number, modeId = 'inst'): WatchEntry => ({
  videoId, title: '', channelTitle: '', channelId: null, modeId, topicId: null, watchedAt: NOW - daysAgo * DAY, progress, durationSec: 3600, playlistId: null, playlistIndex: null,
});

describe('the student\'s own institute report', () => {
  it('counts finished lectures, time and where the student is, from their own history only', () => {
    const history = [entry('aaaaaaaaaaa', 0.95, 5), entry('aaaaaaaaaaa', 0.4, 6), entry('bbbbbbbbbbb', 0.5, 1), entry('zzzzzzzzzzz', 1, 1), entry('ccccccccccc', 1, 0, 'personal')];
    const r = studentReport(history, 'inst', lessons, [], NOW);
    expect(r).toMatchObject({ done: 1, total: 4 });
    expect(r.seconds).toBe(Math.round(0.95 * 3600 + 0.5 * 3600));
    expect(r.current?.videoId).toBe('bbbbbbbbbbb');
    expect(r.next?.videoId).toBe('bbbbbbbbbbb');
    expect(duration(r.seconds)).toBe('1 h 27 min');
  });

  it('reads the quiz trend and the study week', () => {
    const scores = [4, 5, 8, 9].map((score, i) => ({ videoId: 'aaaaaaaaaaa', score, total: 10, at: NOW - (4 - i) * DAY, kind: 'quizme' as const }));
    const history = [entry('aaaaaaaaaaa', 1, 2), entry('bbbbbbbbbbb', 1, 1), entry('ccccccccccc', 0.2, 0)];
    const r = studentReport(history, 'inst', lessons, scores, NOW);
    expect(r.quiz).toMatchObject({ average: 65, count: 4, trend: 'rising' });
    expect(r.study.streak).toBe(5);
    expect(r.study.week.filter(Boolean)).toHaveLength(5);
    expect(r.study.usualTime).toBe('evenings');
  });

  it('is empty, not wrong, for a student who has not started', () => {
    const r = studentReport([], 'inst', lessons, undefined, NOW);
    expect(r).toMatchObject({ done: 0, seconds: 0, current: null, quiz: { average: null, trend: null }, study: { streak: 0, lastActive: null, usualTime: null } });
    expect(r.next?.number).toBe(1);
  });
});
