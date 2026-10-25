import { useEffect, useState } from 'react';
import { YtLink } from '@/ui/nav';

/**
 * Lesson titles. A course stores only video ids; the title is fetched at display time from YouTube's
 * public oEmbed endpoint and kept in memory only — never written to storage.
 */

const TITLE_TTL_MS = 1800000;
const MAX_TITLES = 1000;
const titles = new Map<string, { title: string; at: number }>();

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function remember(id: string, title: string) {
  if (titles.size >= MAX_TITLES) titles.delete(titles.keys().next().value!);
  titles.set(id, { title, at: Date.now() });
}

/** The lesson's title once known; `fallback` until then (or for good, if YouTube doesn't answer). */
export function useLessonTitle(id: string, fallback: string): string {
  const [title, setTitle] = useState(titles.get(id)?.title ?? fallback);

  useEffect(() => {
    const cached = titles.get(id);
    if (cached && Date.now() - cached.at < TITLE_TTL_MS) {
      setTitle(cached.title);
      return;
    }
    const abort = new AbortController();
    void fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(id))}&format=json`, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.title) return;
        remember(id, String(data.title));
        setTitle(String(data.title));
      })
      .catch(() => {});
    return () => abort.abort();
  }, [id]);

  return title;
}

export function InstituteVideo({ id, number }: { id: string; number: number }) {
  const title = useLessonTitle(id, `Lesson ${number}`);
  return (
    <YtLink href={watchUrl(id)}>
      {title} <span className="fs-caption">({id})</span>
    </YtLink>
  );
}
