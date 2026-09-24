import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeChrome } from '@/test/fake-chrome';
import { getItem } from '@/storage/storage';
import { addTemplateWithChannels } from './service';

/**
 * `addTemplateWithChannels` is the write path behind the optional creator-preference step shown after
 * picking a default mode/template (Phase 2B) — it must create the Space exactly like the plain
 * `addTemplate` always has, then apply channel preferences the same way the custom "New space" flow
 * already does (`setChannelRule` + a best-effort `channel/add`), and it must do nothing extra — not even
 * an empty write — when no channels were picked, since "skip" is a first-class choice, not a partial one.
 */

const messages: { type: string; payload: unknown }[] = [];

beforeEach(() => {
  messages.length = 0;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

function setup() {
  return fakeChrome({ modes: [] }, (type, payload) => {
    messages.push({ type, payload });
    if (type === 'spaces/authorize') return { ok: true, allowance: null };
    if (type === 'channel/add') return { ok: true, channel: { id: (payload as { input: string }).input, title: 'x' } };
    return { ok: true };
  });
}

describe('addTemplateWithChannels', () => {
  it('creates the template Space with no channels when the learner skips', async () => {
    setup();
    const mode = await addTemplateWithChannels('dsa', []);
    expect(mode?.id).toBe('dsa');
    const modes = await getItem('modes');
    expect(modes).toHaveLength(1);
    expect(modes[0].allowedChannels).toEqual([]);
    // No channel/add message at all — skipping must not look like "zero channels were selected and added".
    expect(messages.some((m) => m.type === 'channel/add')).toBe(false);
  });

  it('applies each picked channel as an allowed channel, same as the custom-mode flow', async () => {
    setup();
    const mode = await addTemplateWithChannels('dsa', [
      { id: 'UC123', title: 'Some DSA Channel', handle: '@somedsa' },
      { id: 'UC456', title: 'Another Channel' },
    ]);
    expect(mode).not.toBeNull();
    const modes = await getItem('modes');
    expect(modes[0].allowedChannels).toEqual([
      { id: 'UC123', title: 'Some DSA Channel', handle: '@somedsa' },
      { id: 'UC456', title: 'Another Channel' },
    ]);
    expect(messages.filter((m) => m.type === 'channel/add').map((m) => m.payload)).toEqual([{ input: 'UC123' }, { input: 'UC456' }]);
  });

  it('returns null for an unknown template id, writing nothing', async () => {
    setup();
    const mode = await addTemplateWithChannels('not-a-real-template', [{ id: 'UC1', title: 'x' }]);
    expect(mode).toBeNull();
    expect(await getItem('modes')).toEqual([]);
  });
});
