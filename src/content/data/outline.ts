import { useEffect, useState } from 'react';
import type { KnowledgeMap, Transcript, TranscriptSegment } from '@/learning/knowledge/types';
import type { OutlineRequest, OutlineSection } from '@/learning/outline/outline';
import { sendMessage } from '@/messaging/runtime';

/** What the API needs to find — or make — the outline for these captions. */
export function outlineRequest(video: { id: string; title: string; channelTitle: string }, segments: TranscriptSegment[], durationSec: number | null, map: KnowledgeMap | null): OutlineRequest {
  // The creator's own chapters and description timestamps: hints for a first generation, never copied blindly.
  const hints = (map?.nodes ?? []).filter((n) => n.source === 'chapters' || n.source === 'description').map((n) => ({ startSec: n.startSec, title: n.title }));
  return { videoId: video.id, title: video.title, channel: video.channelTitle, durationSec, hints, segments };
}

/**
 * The outline, or null — never an error, and never longer than `timeoutMs`: a first viewer's outline is
 * being made while they wait, and a mind map should not hang on it. It still finishes in the background
 * and is stored, so the next request finds it.
 */
export function fetchOutline(request: OutlineRequest, timeoutMs = 20_000): Promise<OutlineSection[] | null> {
  return Promise.race([
    sendMessage('outline/get', request).catch(() => null),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/**
 * The whole-video outline for the watch page (src/learning/outline), fetched only while `enabled` —
 * a panel that uses it is open — so merely watching a video never costs an AI call. Null until it
 * arrives, and whenever there is no transcript or no FocusSpace API; nothing waits on it.
 */
export function useVideoOutline(
  enabled: boolean,
  video: { id: string; title: string; channelTitle: string },
  transcript: Transcript | null,
  durationSec: number | null,
  map: KnowledgeMap | null,
): OutlineSection[] | null {
  const [outline, setOutline] = useState<{ key: string; sections: OutlineSection[] } | null>(null);
  const segments = transcript?.videoId === video.id ? transcript.segments : null;
  // Same video, same captions → same request. The hints only shape a first generation, so they are not part of it.
  const key = segments?.length ? `${video.id}:${segments.length}:${segments[segments.length - 1].startSec}` : null;

  useEffect(() => {
    if (!enabled || !key || !segments || outline?.key === key) return;
    let alive = true;
    fetchOutline(outlineRequest(video, segments, durationSec, map), 120_000).then((sections) => {
      if (alive && sections?.length) setOutline({ key, sections });
    });
    return () => {
      alive = false;
    };
    // `segments`/`map` are represented by `key`; re-running on their identity would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return outline && outline.key === key ? outline.sections : null;
}
