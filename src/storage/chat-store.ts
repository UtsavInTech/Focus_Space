import { CHAT_VERSION, type ChatMessage, type ChatSession } from '@/types/chat';
import { updateItem } from './storage';

/**
 * Saved AI conversations — what the Library's "AI chats" lists. A conversation is saved as it grows, one
 * row per panel opened, so reopening the Library shows it exactly as it ended. Kept small: the newest
 * conversations, and the latest turns of each.
 */
export const MAX_SESSIONS = 50;
export const MAX_MESSAGES = 60;

export async function saveChatSession(session: Omit<ChatSession, 'createdAt' | 'updatedAt'> & { messages: ChatMessage[] }, now = Date.now()): Promise<void> {
  await updateItem('chatSessions', (store) => {
    const existing = store.sessions.find((s) => s.id === session.id);
    const row: ChatSession = { ...session, messages: session.messages.slice(-MAX_MESSAGES), createdAt: existing?.createdAt ?? now, updatedAt: now };
    return { version: CHAT_VERSION, sessions: [row, ...store.sessions.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS) };
  });
}

export async function deleteChatSession(id: string): Promise<void> {
  await updateItem('chatSessions', (store) => ({ version: CHAT_VERSION, sessions: store.sessions.filter((s) => s.id !== id) }));
}
