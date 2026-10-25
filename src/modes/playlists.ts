import type { SavedVideo } from '@/types/domain';
import { getItem, updateItem } from '@/storage/storage';

/** User-curated topic playlists ("Save to: HTML & CSS"). Local only. */

export async function saveToTopic(modeId: string, topicId: string, video: Omit<SavedVideo, 'addedAt'>): Promise<void> {
  if((await getItem('modes')).find(m=>m.id===modeId)?.source)throw new Error('Institute course structure is read-only.');
  await updateItem('topicPlaylists', (all) => {
    const space = all[modeId] ?? {};
    const list = (space[topicId] ?? []).filter((v) => v.videoId !== video.videoId);
    return { ...all, [modeId]: { ...space, [topicId]: [...list, { ...video, addedAt: Date.now() }] } };
  });
}

export async function removeFromTopic(modeId: string, topicId: string, videoId: string): Promise<void> {
  if((await getItem('modes')).find(m=>m.id===modeId)?.source)throw new Error('Institute course structure is read-only.');
  await updateItem('topicPlaylists', (all) => {
    const space = all[modeId] ?? {};
    return { ...all, [modeId]: { ...space, [topicId]: (space[topicId] ?? []).filter((v) => v.videoId !== videoId) } };
  });
}

/** Accepts a watch/short/youtu.be URL or a bare 11-character id. */
export function parseVideoInput(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const url = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1, 12) || null;
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const v = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
    return v && /^[\w-]{11}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
