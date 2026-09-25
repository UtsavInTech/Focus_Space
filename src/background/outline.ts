import { condenseTranscript, transcriptKey, type OutlineRequest, type OutlineSection } from '@/learning/outline/outline';
import { apiBaseUrl, status as authStatus } from './auth';
import { installId } from './install-id';

/**
 * Whole-video outlines from the FocusSpace API (server/outline). Asks for a stored one first — a small
 * GET — and only uploads the transcript when this video has never been outlined with it. Silent on any
 * failure: the outline makes chat better, and chat works exactly as before without it.
 */

/** Per service-worker lifetime; the server's store is the real cache. */
const memo = new Map<string, OutlineSection[] | null>();
const pending = new Map<string, Promise<OutlineSection[] | null>>();

export async function videoOutline(full: OutlineRequest): Promise<OutlineSection[] | null> {
  const base = await apiBaseUrl();
  // Only the condensed transcript travels (learning/outline condenseTranscript) — a long lecture's full captions are megabytes.
  const request = { ...full, segments: condenseTranscript(full.segments) };
  if (!base || request.segments.length < 3) return null;
  const key = await transcriptKey(request.segments);
  const id = `${request.videoId}:${key}`;
  if (memo.has(id)) return memo.get(id) ?? null;
  const running = pending.get(id);
  if (running) return running;

  const task = (async () => {
    const { accessToken } = await authStatus();
    const identity: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : { 'X-FocusSpace-Install': await installId() };
    try {
      const stored = await fetch(`${base}/v1/outline?videoId=${encodeURIComponent(request.videoId)}&key=${key}`, { headers: identity });
      const found = (await stored.json().catch(() => null)) as { sections?: OutlineSection[] | null } | null;
      if (stored.ok && found?.sections?.length) return found.sections;

      const made = await fetch(`${base}/v1/outline`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...identity }, body: JSON.stringify(request) });
      const json = (await made.json().catch(() => null)) as { sections?: OutlineSection[] | null } | null;
      return made.ok && json?.sections?.length ? json.sections : null;
    } catch {
      return null;
    }
  })();
  pending.set(id, task);
  try {
    const sections = await task;
    // A failure is not remembered: the next panel open tries again.
    if (sections) memo.set(id, sections);
    while (memo.size > 50) memo.delete(memo.keys().next().value as string);
    return sections;
  } finally {
    pending.delete(id);
  }
}
