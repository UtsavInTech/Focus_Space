import type { SavedNote } from '@/types/notes';
import type { ChatSession } from '@/types/chat';

/**
 * Filing saved work under the Space it was made in — how the Library is arranged.
 *
 * A note taken while learning DSA belongs with the rest of DSA: that is how anyone revising looks for
 * it. Work saved before Spaces were recorded, or made outside one (the bubble on YouTube's home), keeps
 * its place under a clearly named group instead of vanishing from the list.
 */

export const NO_SPACE = { id: '', name: 'Not in a Space' } as const;

export interface SpaceRef {
  id: string;
  name: string;
}

export type LibraryItem = SavedNote | ChatSession;

const isNote = (item: LibraryItem): item is SavedNote => 'provenance' in item;

/** Which Space an item belongs to. Chats carry a Space id; notes carry the Space itself. */
export function spaceOf(item: LibraryItem, spaces: SpaceRef[]): SpaceRef {
  if (isNote(item)) return item.provenance.space ?? NO_SPACE;
  if (!item.modeId) return NO_SPACE;
  return { id: item.modeId, name: spaces.find((s) => s.id === item.modeId)?.name ?? NO_SPACE.name };
}

export interface SpaceGroup<T extends LibraryItem> {
  space: SpaceRef;
  items: T[];
}

/**
 * Items grouped by Space, the busiest first, with "Not in a Space" last. Order within a group is the
 * order given (the Library hands these over newest-first).
 */
export function groupBySpace<T extends LibraryItem>(items: T[], spaces: SpaceRef[]): SpaceGroup<T>[] {
  const groups = new Map<string, SpaceGroup<T>>();
  for (const item of items) {
    const space = spaceOf(item, spaces);
    const key = space.id || NO_SPACE.id;
    const group = groups.get(key) ?? { space: { id: key, name: space.name }, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.space.id === NO_SPACE.id ? 1 : b.space.id === NO_SPACE.id ? -1 : b.items.length - a.items.length));
}
