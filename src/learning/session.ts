import type { LearningSession } from '@/types/domain';
import { getItems, setItems, updateItem } from '@/storage/storage';

/** Local learning sessions: intention + planned time, measured in wall-clock time. */

const HISTORY_LIMIT = 300;

export function elapsedMs(session: LearningSession, now = Date.now()): number {
  const end = session.endedAt ?? session.pausedAt ?? now;
  return Math.max(0, end - session.startedAt - session.pausedMs);
}

export const plannedMs = (session: LearningSession) => session.plannedMinutes * 60_000;
export const remainingMs = (session: LearningSession, now = Date.now()) => plannedMs(session) - elapsedMs(session, now);
export const isLive = (session: LearningSession | null): session is LearningSession =>
  !!session && (session.status === 'active' || session.status === 'paused');

/** Absolute time the planned duration elapses (only meaningful while active). */
export const plannedEndAt = (session: LearningSession) => session.startedAt + session.pausedMs + plannedMs(session);

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

function finalize(session: LearningSession, now: number): LearningSession {
  const pausedMs = session.pausedAt ? session.pausedMs + (now - session.pausedAt) : session.pausedMs;
  return { ...session, pausedMs, pausedAt: null, endedAt: now, status: 'completed' };
}

export interface StartSessionInput {
  modeId: string;
  topicId: string | null;
  goal: string;
  plannedMinutes: number;
}

export async function startSession(input: StartSessionInput): Promise<LearningSession> {
  const now = Date.now();
  const { session: current, sessionHistory } = await getItems(['session', 'sessionHistory']);
  const session: LearningSession = {
    id: `s_${now.toString(36)}`,
    modeId: input.modeId,
    topicId: input.topicId,
    goal: input.goal.trim(),
    plannedMinutes: Math.max(5, Math.min(600, Math.round(input.plannedMinutes))),
    startedAt: now,
    endedAt: null,
    pausedAt: null,
    pausedMs: 0,
    status: 'active',
    limitReachedAt: null,
  };
  const history = isLive(current) ? [finalize(current, now), ...sessionHistory].slice(0, HISTORY_LIMIT) : sessionHistory;
  await setItems({ session, sessionHistory: history });
  return session;
}

export async function pauseSession(): Promise<void> {
  await updateItem('session', (s) => (s && s.status === 'active' ? { ...s, status: 'paused', pausedAt: Date.now() } : s));
}

export async function resumeSession(): Promise<void> {
  await updateItem('session', (s) =>
    s && s.status === 'paused' && s.pausedAt ? { ...s, status: 'active', pausedMs: s.pausedMs + (Date.now() - s.pausedAt), pausedAt: null } : s,
  );
}

export async function extendSession(minutes: number): Promise<void> {
  await updateItem('session', (s) => (isLive(s) ? { ...s, plannedMinutes: s.plannedMinutes + minutes, limitReachedAt: null } : s));
}

export async function endSession(): Promise<LearningSession | null> {
  const { session, sessionHistory } = await getItems(['session', 'sessionHistory']);
  if (!isLive(session)) return null;
  const done = finalize(session, Date.now());
  await setItems({ session: null, sessionHistory: [done, ...sessionHistory].slice(0, HISTORY_LIMIT) });
  return done;
}

export async function markLimitReached(sessionId: string): Promise<boolean> {
  let changed = false;
  await updateItem('session', (s) => {
    if (!s || s.id !== sessionId || s.limitReachedAt) return s;
    changed = true;
    return { ...s, limitReachedAt: Date.now() };
  });
  return changed;
}
