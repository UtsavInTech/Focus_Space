import { useEffect, useState } from 'react';
import { YtLink } from '@/ui/nav';

/**
 * Lesson titles. A course stores only video ids; the title (and the channel's name) is fetched at display
 * time from YouTube's public oEmbed endpoint and kept in memory only — never written to storage.
 */

const TITLE_TTL_MS = 1800000;
const MAX_TITLES = 1000;

export interface LessonInfo {
  title: string;
  /** The channel's name, when YouTube said it. */
  author: string | null;
}

const titles = new Map<string, LessonInfo & { at: number }>();

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function remember(id: string, info: LessonInfo) {
  if (titles.size >= MAX_TITLES) titles.delete(titles.keys().next().value!);
  titles.set(id, { ...info, at: Date.now() });
}

/** The lesson's title and channel once known; `fallback` (and no channel) until then — or for good, if YouTube doesn't answer. */
export function useLessonInfo(id: string, fallback: string): LessonInfo {
  const cachedAtFirst = titles.get(id);
  const [info, setInfo] = useState<LessonInfo>(cachedAtFirst ? { title: cachedAtFirst.title, author: cachedAtFirst.author } : { title: fallback, author: null });

  useEffect(() => {
    if (!id) return;
    const cached = titles.get(id);
    if (cached && Date.now() - cached.at < TITLE_TTL_MS) {
      setInfo({ title: cached.title, author: cached.author });
      return;
    }
    // A new id on the same component (the featured lesson moving on) must not keep the last lesson's title.
    setInfo(cached ? { title: cached.title, author: cached.author } : { title: fallback, author: null });
    const abort = new AbortController();
    void fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(id))}&format=json`, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.title) return;
        const next = { title: String(data.title), author: data.author_name ? String(data.author_name) : null };
        remember(id, next);
        setInfo(next);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [id]);

  return info;
}

export function useLessonTitle(id: string, fallback: string): string {
  return useLessonInfo(id, fallback).title;
}

export function InstituteVideo({ id, number }: { id: string; number: number }) {
  const title = useLessonTitle(id, `Lesson ${number}`);
  return (
    <YtLink href={watchUrl(id)}>
      {title} <span className="fs-caption">({id})</span>
    </YtLink>
  );
}
