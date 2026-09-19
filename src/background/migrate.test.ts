import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '@/test/fake-chrome';
import { DEFAULT_MODES } from '@/modes/templates';
import { pruneUnusedTemplates } from '@/modes/service';
import { defaultsFor, SCHEMA_VERSION } from '@/storage/schema';

const untouched = (id: string) => structuredClone(DEFAULT_MODES.find((m) => m.id === id)!);
const edited = (id: string) => ({ ...untouched(id), updatedAt: 5 });
const own = (id: string) => ({ ...untouched('dsa'), id, name: id, createdAt: 9, updatedAt: 9 });

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.resetModules();
});

/** Each test gets a fresh module, so the run-once promise does not leak between them. */
const migrate = async () => (await import('./migrate')).migrate();

describe('a new install', () => {
  it('starts with no Spaces — the templates are suggestions, not owned Spaces', () => {
    expect(defaultsFor('modes')).toEqual([]);
    expect(defaultsFor('settings').activeModeId).toBeNull();
    expect(defaultsFor('ownership')).toEqual({ owner: 'guest', epoch: 0 });
  });

  it('has nothing to migrate, and records the schema', async () => {
    const data = fakeChrome({});
    await migrate();
    expect(data).toEqual({ schemaVersion: SCHEMA_VERSION });
  });
});

describe('pruning seeded templates', () => {
  const settings = { activeModeId: 'dsa', defaultModeId: 'dsa' };

  it('removes templates nobody touched, keeps the active one and anything edited or made by the learner', () => {
    const kept = pruneUnusedTemplates([untouched('dsa'), untouched('sql'), edited('java'), own('mine'), untouched('relax')], settings, {});
    expect(kept.map((m) => m.id)).toEqual(['dsa', 'java', 'mine']);
  });

  it('keeps a template holding saved videos', () => {
    const kept = pruneUnusedTemplates([untouched('dsa'), untouched('sql')], settings, { sql: { joins: [{ videoId: 'v' } as never] } });
    expect(kept.map((m) => m.id)).toEqual(['dsa', 'sql']);
  });
});

describe('upgrading an install from before schema 5', () => {
  it('rebuilds the Spaces of an install that never stored them, then prunes — the active Space survives', async () => {
    // Pre-5: settings stored, but `modes` never written because the learner never edited a Space.
    const data = fakeChrome({ schemaVersion: 4, settings: { onboarded: true, activeModeId: 'web-dev', defaultModeId: 'dsa' } });
    await migrate();
    expect((data.modes as { id: string }[]).map((m) => m.id)).toEqual(['dsa', 'web-dev']);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('without stored settings, reads DSA back as the old default rather than deleting it', async () => {
    const data = fakeChrome({ schemaVersion: 4 });
    await migrate();
    expect((data.modes as { id: string }[]).map((m) => m.id)).toEqual(['dsa']);
  });

  it('existing data belongs to whoever is signed in — it is never offered to anyone', async () => {
    const data = fakeChrome({ schemaVersion: 4, auth: { user: { id: 'user-a', email: 'a@x' }, accessToken: 't', refreshToken: 'r' } });
    await migrate();
    expect(data.ownership).toEqual({ owner: 'user-a', epoch: 0 });
  });

  it('signed out, existing data is the guest’s', async () => {
    const data = fakeChrome({ schemaVersion: 4 });
    await migrate();
    expect(data.ownership).toEqual({ owner: 'guest', epoch: 0 });
  });

  it('runs once, even when startup and onInstalled both ask', async () => {
    const data = fakeChrome({ schemaVersion: 4, modes: [untouched('dsa'), own('mine')], settings: { activeModeId: 'mine' } });
    const { migrate: run } = await import('./migrate');
    await Promise.all([run(), run()]);
    data.modes = [own('added-later')];
    await run();
    expect(data.modes).toEqual([own('added-later')]);
  });
});
