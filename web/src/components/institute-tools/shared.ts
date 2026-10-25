import type { FormEvent } from 'react';

/** A signed-in call to the institute API (GET without a body, POST with one). */
export type Call = <T>(path: string, body?: unknown) => Promise<T>;

/** Runs one staff action: owns the busy flag and turns a failure into the page's error line. */
export type Act = (fn: () => Promise<void>) => Promise<void>;

/** Every tool form submits the same way: no navigation, just its fields. */
export function formFields(event: FormEvent<HTMLFormElement>): FormData {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

export const watchOrPlaylistUrl = (item: { type: 'video' | 'playlist'; videoId?: string; playlistId?: string }) =>
  item.type === 'video' ? `https://www.youtube.com/watch?v=${item.videoId}` : `https://www.youtube.com/playlist?list=${item.playlistId}`;
