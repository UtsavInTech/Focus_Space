import { afterEach, describe, expect, it } from 'vitest';
import { fakeChrome } from '@/test/fake-chrome';
import { defaultsFor } from '@/storage/schema';
import { getItem } from '@/storage/storage';
import { addTemplate, missingTemplates, needsFirstSpace, setFocusEnabled } from './service';
import { DEFAULT_MODES } from './templates';

/** A new install owns no Space: the home page offers the templates, and picking one creates it. */

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('the first Space', () => {
  it('a new install is on, with no Space — the home page must show the picker', () => {
    const settings = defaultsFor('settings');
    expect(settings.focusEnabled).toBe(true);
    expect(needsFirstSpace(settings, defaultsFor('modes'))).toBe(true);
  });

  it('every template is offered as a suggestion until it is picked', () => {
    expect(missingTemplates([]).map((m) => m.id)).toEqual(DEFAULT_MODES.map((m) => m.id));
  });

  it('picking a suggestion creates that one Space, and only that one', async () => {
    fakeChrome({}, () => ({ ok: true, allowance: null }));
    await addTemplate('dsa');
    const modes = await getItem('modes');
    expect(modes.map((m) => m.id)).toEqual(['dsa']);
    expect(modes[0].createdAt).toBeGreaterThan(0); // a real, owned Space — not a seeded template
    expect(missingTemplates(modes).map((m) => m.id)).not.toContain('dsa');
  });

  it('turning Focus Mode back on with no Space keeps it on, so the picker can come back', async () => {
    fakeChrome({ settings: { ...defaultsFor('settings'), focusEnabled: false } });
    await setFocusEnabled(true);
    expect((await getItem('settings')).focusEnabled).toBe(true);
  });

  it('once a Space exists it is chosen, and the picker is not needed', async () => {
    const settings = { ...defaultsFor('settings'), activeModeId: null };
    fakeChrome({ settings, modes: [DEFAULT_MODES[0]] });
    await setFocusEnabled(true);
    const after = await getItem('settings');
    expect(after.activeModeId).toBe(DEFAULT_MODES[0].id);
    expect(needsFirstSpace(after, await getItem('modes'))).toBe(false);
  });
});
