/**
 * Lesson titles for the Studio, from YouTube's public oEmbed endpoint. Titles are display data only:
 * they live in this process's memory for a day and are never written to the database (YouTube API
 * Services policy: no long-lived copies of YouTube data). A title that can't be fetched is simply left
 * out; the Studio then shows the lesson's number instead.
 */

const DAY = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const PARALLEL = 6;

export type TitleFetch = (videoId: string) => Promise<string | null>;

export const oembedTitle: TitleFetch = async (videoId) => {
  const watch = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  const data = (await response.json()) as { title?: unknown };
  return typeof data.title === 'string' ? data.title.slice(0, 300) : null;
};

export class TitleCache {
  private entries = new Map<string, { title: string | null; at: number }>();

  constructor(private readonly fetchTitle: TitleFetch = oembedTitle, private readonly now: () => number = Date.now) {}

  /** Titles for these ids, fetching at most a few at a time. Missing or failed ids are absent. */
  async titles(videoIds: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(videoIds)];
    const stale = wanted.filter((id) => {
      const entry = this.entries.get(id);
      return !entry || this.now() - entry.at > DAY;
    });
    for (let i = 0; i < stale.length; i += PARALLEL) {
      await Promise.all(stale.slice(i, i + PARALLEL).map((id) => this.load(id)));
    }
    const out: Record<string, string> = {};
    for (const id of wanted) {
      const title = this.entries.get(id)?.title;
      if (title) out[id] = title;
    }
    return out;
  }

  private async load(id: string) {
    const title = await this.fetchTitle(id).catch(() => null);
    // Oldest first out, so memory stays bounded however many courses are viewed.
    if (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(id, { title, at: this.now() });
  }
}
