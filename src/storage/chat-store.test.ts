import { afterEach, describe, expect, it } from 'vitest';
import { fakeChrome } from '@/test/fake-chrome';
import type { ChatMessage } from '@/types/chat';
import { ownedKeys } from './ownership';
import { getItem } from './storage';
import { deleteChatSession, MAX_MESSAGES, MAX_SESSIONS, saveChatSession } from './chat-store';

const msg = (i: number): ChatMessage => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'learner', text: `turn ${i}`, at: i, videoId: 'v', currentTime: 0 });

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('saved AI conversations', () => {
  it('a conversation is saved as it grows — one row, updated in place, newest first', async () => {
    fakeChrome({});
    await saveChatSession({ id: 'a', videoId: 'v', modeId: 'dsa', title: 'Linked Lists', messages: [msg(0), msg(1)] }, 10);
    await saveChatSession({ id: 'b', videoId: '', modeId: 'dsa', title: 'YouTube home', messages: [msg(0)] }, 20);
    await saveChatSession({ id: 'a', videoId: 'v', modeId: 'dsa', title: 'Linked Lists', messages: [msg(0), msg(1), msg(2), msg(3)] }, 30);
    const { sessions } = await getItem('chatSessions');
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(sessions[0]).toMatchObject({ createdAt: 10, updatedAt: 30 });
    expect(sessions[0].messages).toHaveLength(4);
  });

  it('keeps the newest conversations and the latest turns of each', async () => {
    fakeChrome({});
    for (let i = 0; i < MAX_SESSIONS + 5; i++) await saveChatSession({ id: `s${i}`, videoId: '', modeId: '', messages: [msg(0)] }, i);
    await saveChatSession({ id: 'long', videoId: '', modeId: '', messages: Array.from({ length: MAX_MESSAGES + 10 }, (_, i) => msg(i)) }, 999);
    const { sessions } = await getItem('chatSessions');
    expect(sessions).toHaveLength(MAX_SESSIONS);
    expect(sessions[0].messages).toHaveLength(MAX_MESSAGES);
    expect(sessions[0].messages.at(-1)?.text).toBe(`turn ${MAX_MESSAGES + 9}`);
  });

  it('can be deleted', async () => {
    fakeChrome({});
    await saveChatSession({ id: 'a', videoId: '', modeId: '', messages: [msg(0)] });
    await deleteChatSession('a');
    expect((await getItem('chatSessions')).sessions).toEqual([]);
  });

  it('belongs to the person signed in — another account never sees it', () => {
    expect(ownedKeys()).toContain('chatSessions');
  });
});
