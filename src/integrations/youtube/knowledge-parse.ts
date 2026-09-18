import type { ChapterInput, CommentInput } from '@/learning/knowledge/types';
import { parseCount, textOf } from './innertube-parse';

/**
 * Knowledge-map evidence in YouTube's responses: chapters, playlists linked in
 * the description, and comment pages. Pure functions, tested against trimmed
 * real responses in __fixtures__/innertube.
 */

type Json = Record<string, unknown>;

/** Depth-first visit of every object in a response. Return false to skip a subtree. */
function walk(root: unknown, visit: (obj: Json, key: string) => boolean | void, maxDepth = 60) {
  const go = (node: unknown, key: string, depth: number) => {
    if (depth > maxDepth || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => go(n, key, depth + 1));
    if (visit(node as Json, key) === false) return;
    for (const [k, v] of Object.entries(node as Json)) if (v && typeof v === 'object') go(v, k, depth + 1);
  };
  go(root, '', 0);
}

/** Creator chapters first; YouTube's auto-generated chapters only when the creator made none. */
export function parseChapters(root: unknown): ChapterInput[] {
  const byKind: Record<'creator' | 'auto', ChapterInput[]> = { creator: [], auto: [] };
  walk(root, (obj, key) => {
    if (key !== 'markersMap' || typeof obj.key !== 'string') return;
    const kind = obj.key === 'DESCRIPTION_CHAPTERS' ? 'creator' : obj.key === 'AUTO_CHAPTERS' ? 'auto' : null;
    const chapters = (obj.value as Json | undefined)?.chapters;
    if (!kind || !Array.isArray(chapters) || byKind[kind].length) return false;
    for (const c of chapters) {
      const r = (c as Json).chapterRenderer as Json | undefined;
      if (!r || typeof r.timeRangeStartMillis !== 'number') continue;
      const title = textOf(r.title).trim();
      if (title) byKind[kind].push({ title, startSec: r.timeRangeStartMillis / 1000, auto: kind === 'auto' });
    }
    return false;
  });
  if (!byKind.creator.length && !byKind.auto.length) {
    // Fallback: the chapters engagement panel (macro markers).
    walk(root, (obj) => {
      const panel = obj.engagementPanelSectionListRenderer as Json | undefined;
      const id = String(panel?.panelIdentifier ?? panel?.targetId ?? '');
      const kind = /macro-markers-description-chapters/.test(id) ? 'creator' : /macro-markers-auto-chapters/.test(id) ? 'auto' : null;
      if (!panel || !kind) return;
      walk(panel, (item) => {
        const r = item.macroMarkersListItemRenderer as Json | undefined;
        if (!r) return;
        const start = (r.onTap as Json | undefined)?.watchEndpoint as Json | undefined;
        const title = textOf(r.title).trim();
        if (title && typeof start?.startTimeSeconds === 'number') byKind[kind].push({ title, startSec: start.startTimeSeconds, auto: kind === 'auto' });
        return false;
      });
      return false;
    });
  }
  const list = byKind.creator.length ? byKind.creator : byKind.auto;
  return list.sort((a, b) => a.startSec - b.startSec);
}

/** Watch-later, likes, mixes and uploads lists aren't courses. */
export const isCoursePlaylistId = (id: string) => /^[\w-]{10,}$/.test(id) && !/^(WL|LL|RD|UU|FL|OLAK|LM)/.test(id);

/** Playlists the creator links in the description ("Complete course: …list=PL…"), in order. */
export function parseDescriptionPlaylists(root: unknown): string[] {
  const ids: string[] = [];
  const add = (id: unknown) => {
    if (typeof id === 'string' && isCoursePlaylistId(id) && !ids.includes(id)) ids.push(id);
  };
  walk(root, (obj, key) => {
    if (key !== 'attributedDescription') return;
    for (const run of Array.isArray(obj.commandRuns) ? obj.commandRuns : []) {
      const cmd = ((run as Json).onTap as Json | undefined)?.innertubeCommand as Json | undefined;
      if (!cmd) continue;
      add((cmd.watchEndpoint as Json | undefined)?.playlistId);
      const browseId = (cmd.browseEndpoint as Json | undefined)?.browseId;
      if (typeof browseId === 'string' && browseId.startsWith('VL')) add(browseId.slice(2));
      const url = String((cmd.urlEndpoint as Json | undefined)?.url ?? '');
      const list = decodeURIComponent(url).match(/[?&]list=([\w-]+)/)?.[1];
      add(list);
    }
    if (typeof obj.content === 'string') for (const m of obj.content.matchAll(/[?&]list=([\w-]{10,})/g)) add(m[1]);
    return false;
  });
  return ids;
}

/** Token for the first page of comments on a watch page. */
export function parseCommentsToken(root: unknown): string | null {
  let token: string | null = null;
  walk(root, (obj) => {
    if (token) return false;
    const section = obj.itemSectionRenderer as Json | undefined;
    if (!section || section.sectionIdentifier !== 'comment-item-section') return;
    token = JSON.stringify(section).match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1] ?? null;
    return false;
  });
  return token;
}

export interface CommentsPage {
  comments: CommentInput[];
  continuation: string | null;
}

/** A page of comments (2024+ entity format), plus the token for the next page. */
export function parseCommentsPage(root: unknown): CommentsPage {
  const comments: CommentInput[] = [];
  const mutations = ((root as Json)?.frameworkUpdates as Json | undefined)?.entityBatchUpdate as Json | undefined;
  for (const m of Array.isArray(mutations?.mutations) ? mutations.mutations : []) {
    const c = ((m as Json).payload as Json | undefined)?.commentEntityPayload as Json | undefined;
    const props = c?.properties as Json | undefined;
    if (!props || typeof props.commentId !== 'string') continue;
    const author = (c?.author as Json | undefined) ?? {};
    const toolbar = (c?.toolbar as Json | undefined) ?? {};
    comments.push({
      id: props.commentId,
      text: textOf(props.content),
      likes: parseCount(String(toolbar.likeCountNotliked ?? '')) ?? 0,
      isCreator: author.isCreator === true,
      replyLevel: typeof props.replyLevel === 'number' ? props.replyLevel : 0,
    });
  }
  // The item continuation is the last continuationItemRenderer; sort-menu tokens live in the header.
  let continuation: string | null = null;
  walk((root as Json)?.onResponseReceivedEndpoints, (obj) => {
    const item = obj.continuationItemRenderer as Json | undefined;
    if (!item) return;
    const token = JSON.stringify(item).match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1];
    if (token) continuation = token;
    return false;
  });
  return { comments, continuation };
}
