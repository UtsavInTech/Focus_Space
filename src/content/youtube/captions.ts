import type { Transcript } from '@/learning/knowledge/types';

/**
 * Isolated-world side of caption capture (see the bridge, src/content/bridge/main-world.ts).
 * Transcripts arrive whenever YouTube's player loads captions; FocusSpace can
 * also ask for them explicitly (a learner action such as "Explain this").
 */

export type CaptionsStatus = 'captured' | 'none' | 'ad' | 'not-ready' | 'unsupported' | 'failed' | 'timeout';

export function onCaptions(listener: (transcript: Transcript) => void): () => void {
  const handle = (event: Event) => {
    try {
      const t = JSON.parse(String((event as CustomEvent).detail)) as Transcript;
      if (t && typeof t.videoId === 'string' && Array.isArray(t.segments) && t.segments.length) listener(t);
    } catch {
      /* malformed */
    }
  };
  document.addEventListener('focusspace:captions', handle);
  return () => document.removeEventListener('focusspace:captions', handle);
}

let nextRequest = 1;

/** A little longer than the bridge's own 45 s wait (main-world.ts), so it can report its real outcome. */
export function requestCaptions(videoId: string, timeoutMs = 50_000): Promise<CaptionsStatus> {
  const requestId = nextRequest++;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish('timeout'), timeoutMs);
    function finish(status: CaptionsStatus) {
      window.clearTimeout(timer);
      document.removeEventListener('focusspace:captions-status', onStatus);
      resolve(status);
    }
    function onStatus(event: Event) {
      try {
        const detail = JSON.parse(String((event as CustomEvent).detail)) as { requestId: number; status: CaptionsStatus };
        if (detail.requestId === requestId) finish(detail.status);
      } catch {
        /* ignore */
      }
    }
    document.addEventListener('focusspace:captions-status', onStatus);
    document.dispatchEvent(new CustomEvent('focusspace:captions-request', { detail: JSON.stringify({ videoId, requestId }) }));
  });
}
