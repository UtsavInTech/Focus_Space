/**
 * Feed composition: subscriptions first, discovery woven in.
 *
 *   sub sub sub sub  DISCOVERY  sub sub sub sub  DISCOVERY  …
 *   (subscriptions run out) ── "More from YouTube" ── discovery …
 *
 * Both lists must already be relevance-filtered and ranked. Nothing is ever
 * added to fill space.
 */

export type FeedEntry<P, S> =
  | { type: 'primary'; key: string; item: P }
  | { type: 'discovery'; key: string; item: S; spotlight: boolean }
  | { type: 'divider'; key: string; label: string };

export interface ComposeOptions<S> {
  /** A discovery item after every N subscription items. */
  every?: number;
  /** The first discovery item that passes this becomes a highlighted "best match". */
  isSpotlight?: (item: S) => boolean;
  idOf: { primary: (item: unknown) => string; discovery: (item: S) => string };
  dividerLabel?: string;
}

export function composeFeed<P, S>(primary: P[], discovery: S[], options: ComposeOptions<S>): FeedEntry<P, S>[] {
  const every = Math.max(1, options.every ?? 4);
  const out: FeedEntry<P, S>[] = [];
  const seen = new Set<string>();
  let spotlightUsed = false;
  let d = 0;

  const pushDiscovery = () => {
    while (d < discovery.length) {
      const item = discovery[d++];
      const id = options.idOf.discovery(item);
      if (seen.has(id)) continue;
      seen.add(id);
      const spotlight = !spotlightUsed && !!options.isSpotlight?.(item);
      spotlightUsed ||= spotlight;
      out.push({ type: 'discovery', key: `d:${id}`, item, spotlight });
      return true;
    }
    return false;
  };

  primary.forEach((item, i) => {
    const id = options.idOf.primary(item);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ type: 'primary', key: `p:${id}`, item });
    if ((i + 1) % every === 0) pushDiscovery();
  });

  if (d < discovery.length) {
    if (out.length) out.push({ type: 'divider', key: 'divider:more', label: options.dividerLabel ?? 'More from YouTube' });
    while (pushDiscovery());
  }
  return out;
}
