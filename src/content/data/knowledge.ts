import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LearningMode } from '@/types/domain';
import type { WatchPage } from '@/integrations/youtube/innertube-client';
import { buildKnowledgeMap, knowledgeSignature, type KnowledgeInputs } from '@/learning/knowledge/fuse';
import { conceptStops, locateConcept, type ConceptPosition, type ConceptStop } from '@/learning/knowledge/locate';
import { KNOWLEDGE_VERSION, type CommentInput, type KnowledgeMap, type Transcript } from '@/learning/knowledge/types';
import type { KnowledgeCacheStore } from '@/storage/schema';
import { getItem, updateItem } from '@/storage/storage';
import { onCaptions, requestCaptions, type CaptionsStatus } from '../youtube/captions';
import { currentVideoElement } from '../youtube/metadata';
import { WATCH } from '../youtube/selectors';
import { cached } from './cache';
import { pageYouTube } from './youtube';

/**
 * Knowledge Map on the watch page.
 *
 * - Evidence arrives progressively: chapters + description come with the watch
 *   data; comments are fetched (≤ 2 pages, after the player settles) only when
 *   chapters don't already give a detailed outline; the transcript arrives
 *   when YouTube's player loads captions or the learner asks for it.
 * - A map is rebuilt only when its input signature changes, and persisted per
 *   video (versioned, capped), so revisits are instant.
 * - Playback position → concept is resolved locally on `timeupdate`; React
 *   state changes only when the concept changes.
 */

const MAX_MAPS = 60;
const COMMENT_PAGES = 2;

/* ─── Transcripts (session memory; re-captured on the next visit) ─────────── */

const transcripts = new Map<string, Transcript>();
const transcriptListeners = new Set<(t: Transcript) => void>();

/** Call once at startup: the player can load captions before any UI exists. */
export function startTranscriptCapture(): () => void {
  return onCaptions((t) => {
    const previous = transcripts.get(t.videoId);
    if (previous?.kind === 'manual' && t.kind === 'asr') return; // uploaded captions beat auto-generated
    transcripts.set(t.videoId, t);
    if (transcripts.size > 6) transcripts.delete(transcripts.keys().next().value as string);
    transcriptListeners.forEach((l) => l(t));
  });
}

export const transcriptFor = (videoId: string) => transcripts.get(videoId) ?? null;

/* ─── Comments ─────────────────────────────────────────────────────────────── */

export const loadComments = (videoId: string, token: string): Promise<CommentInput[]> =>
  cached(`comments:${videoId}`, 30 * 60_000, async () => {
    const out: CommentInput[] = [];
    let next: string | null = token;
    for (let page = 0; page < COMMENT_PAGES && next; page++) {
      const result = await pageYouTube.comments(next);
      out.push(...result.comments);
      next = result.continuation;
    }
    return out;
  });

/** Detailed creator chapters make comments unnecessary; coarse ones on a long video don't. */
export function commentsWanted(page: Pick<WatchPage, 'chapters' | 'commentsToken'>, durationSec: number | null, mode: Pick<LearningMode, 'kind'>): boolean {
  if (mode.kind === 'media' || !page.commentsToken) return false;
  return page.chapters.length < 2 || (page.chapters.length <= 4 && (durationSec ?? 0) >= 40 * 60);
}

/* ─── Map cache ────────────────────────────────────────────────────────────── */

let store: Promise<KnowledgeCacheStore> | null = null;
const loadStore = () => (store ??= getItem('knowledgeMaps').catch((): KnowledgeCacheStore => ({ version: KNOWLEDGE_VERSION, entries: {} })));

async function storedMap(videoId: string): Promise<KnowledgeMap | null> {
  return (await loadStore()).entries[videoId]?.map ?? null;
}

async function saveMap(map: KnowledgeMap) {
  const entry = { signature: map.signature, savedAt: Date.now(), map };
  (await loadStore()).entries[map.videoId] = entry;
  await updateItem('knowledgeMaps', (s) => {
    const entries = { ...s.entries, [map.videoId]: entry };
    const ids = Object.keys(entries).sort((a, b) => entries[a].savedAt - entries[b].savedAt);
    for (const old of ids.slice(0, Math.max(0, ids.length - MAX_MAPS))) delete entries[old];
    return { version: KNOWLEDGE_VERSION, entries };
  }).catch(() => undefined);
}

const idle = () =>
  new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 1000 });
    else window.setTimeout(resolve, 50);
  });

/* ─── Hooks ────────────────────────────────────────────────────────────────── */

/** The video's real duration (never an ad's). */
/** The playing video's length right now, if the player knows it — never an ad's length, never another video's. */
export function readVideoDuration(videoId: string): number | null {
  const video = currentVideoElement();
  if (!video || document.querySelector(WATCH.adShowing)) return null;
  const flexyId = document.querySelector(WATCH.flexy)?.getAttribute('video-id');
  if (flexyId && flexyId !== videoId) return null;
  return Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration) : null;
}

export function useVideoDuration(videoId: string): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    let found = false;
    const read = () => {
      const seconds = readVideoDuration(videoId);
      if (seconds !== null) {
        found = true;
        setDuration(seconds);
      }
    };
    read();
    const timer = window.setInterval(() => (found ? window.clearInterval(timer) : read()), 1500);
    return () => window.clearInterval(timer);
  }, [videoId]);
  return duration;
}

export interface KnowledgeState {
  map: KnowledgeMap | null;
  stops: ConceptStop[];
  transcript: Transcript | null;
  transcriptStatus: CaptionsStatus | 'idle' | 'loading';
  /** Explicit learner action: have the player load captions (restored afterwards). */
  requestTranscript: () => Promise<Transcript | null>;
}

export function useKnowledge(videoId: string, page: WatchPage | null, mode: LearningMode, durationSec: number | null): KnowledgeState {
  const [transcript, setTranscript] = useState<Transcript | null>(() => transcriptFor(videoId));
  const [comments, setComments] = useState<CommentInput[] | null>(null);
  const [map, setMap] = useState<KnowledgeMap | null>(null);
  const [transcriptStatus, setTranscriptStatus] = useState<KnowledgeState['transcriptStatus']>('idle');
  const ready = !!page && page.videoId === videoId;

  useEffect(() => {
    setTranscript(transcriptFor(videoId));
    setComments(null);
    setMap(null);
    setTranscriptStatus('idle');
    const listener = (t: Transcript) => t.videoId === videoId && setTranscript(t);
    transcriptListeners.add(listener);
    return () => void transcriptListeners.delete(listener);
  }, [videoId]);

  const wantComments = ready && commentsWanted(page, durationSec, mode);
  useEffect(() => {
    if (!ready || !wantComments || !page.commentsToken) return;
    let alive = true;
    // Let the player and the rail settle first.
    const timer = window.setTimeout(() => {
      loadComments(videoId, page.commentsToken!)
        .then((list) => alive && setComments(list))
        .catch(() => alive && setComments([]));
    }, 1500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [ready, wantComments, videoId, page?.commentsToken]);

  const vocabulary = useMemo(
    () => [...mode.topics.map((t) => t.name), ...mode.topics.flatMap((t) => t.keywords), ...mode.keywords].filter((k) => k && !k.startsWith('~')).slice(0, 120),
    [mode],
  );

  useEffect(() => {
    if (!ready) return;
    const inputs: KnowledgeInputs = { videoId, durationSec, chapters: page.chapters, description: page.description, comments: wantComments ? comments : [], transcript, vocabulary };
    const signature = knowledgeSignature(inputs);
    let alive = true;
    void (async () => {
      const stored = await storedMap(videoId);
      if (!alive) return;
      if (stored?.version === KNOWLEDGE_VERSION) {
        const richer = (!transcript && stored.sources.transcript) || (wantComments && comments === null && stored.sources.comments);
        if (stored.signature === signature || richer) {
          setMap(stored);
          return;
        }
      }
      await idle();
      if (!alive) return;
      const built = buildKnowledgeMap(inputs);
      setMap(built);
      if (built.nodes.length) void saveMap(built);
    })();
    return () => {
      alive = false;
    };
  }, [ready, videoId, page, comments, wantComments, transcript, durationSec, vocabulary]);

  const stops = useMemo(() => (map ? conceptStops(map) : []), [map]);

  const requestTranscript = useCallback(async () => {
    const existing = transcriptFor(videoId);
    if (existing) return existing;
    setTranscriptStatus('loading');
    let status = await requestCaptions(videoId);
    // Clicked during an ad (or before the player loaded this video): wait for the lesson, then try once more.
    if (status === 'ad' || status === 'not-ready') {
      for (let i = 0; i < 60 && (document.querySelector(WATCH.adShowing) || status === 'not-ready'); i++) {
        await new Promise((r) => window.setTimeout(r, 500));
        if (status === 'not-ready' && i >= 6) break;
      }
      if (!transcriptFor(videoId) && !document.querySelector(WATCH.adShowing)) status = await requestCaptions(videoId);
    }
    setTranscriptStatus(transcriptFor(videoId) ? 'captured' : status);
    return transcriptFor(videoId);
  }, [videoId]);

  return { map, stops, transcript, transcriptStatus, requestTranscript };
}

/**
 * Current concept from the playback time: local, and re-renders only when the
 * concept changes. While an ad plays, the <video> element reports the ad's
 * time, so the last content time is kept instead.
 */
export function usePlaybackConcept(videoId: string, stops: ConceptStop[]) {
  const [position, setPosition] = useState<ConceptPosition | null>(null);
  const lastKey = useRef('');
  const lastTime = useRef(0);

  useEffect(() => {
    lastKey.current = '';
    lastTime.current = 0;
    setPosition(null);
    let video: HTMLVideoElement | null = null;
    const update = () => {
      if (!video || document.querySelector(WATCH.adShowing)) return;
      const flexyId = document.querySelector(WATCH.flexy)?.getAttribute('video-id');
      if (flexyId && flexyId !== videoId) return;
      lastTime.current = video.currentTime;
      if (!stops.length) return;
      const next = locateConcept(stops, video.currentTime);
      const key = next.current?.id ?? 'none';
      if (key !== lastKey.current) {
        lastKey.current = key;
        setPosition(next);
      }
    };
    const attach = () => {
      const v = currentVideoElement();
      if (v && v !== video) {
        video?.removeEventListener('timeupdate', update);
        video?.removeEventListener('seeked', update);
        video = v;
        v.addEventListener('timeupdate', update);
        v.addEventListener('seeked', update);
      }
      update();
    };
    attach();
    const timer = window.setInterval(attach, 3000); // YouTube can swap the <video> element
    return () => {
      window.clearInterval(timer);
      video?.removeEventListener('timeupdate', update);
      video?.removeEventListener('seeked', update);
    };
  }, [videoId, stops]);

  /** Playback position of the lesson itself (never an ad's). */
  const currentTime = useCallback(() => {
    const flexyId = document.querySelector(WATCH.flexy)?.getAttribute('video-id');
    const video = currentVideoElement();
    if (!video || (flexyId && flexyId !== videoId) || document.querySelector(WATCH.adShowing)) return lastTime.current;
    return video.currentTime;
  }, [videoId]);

  const seek = useCallback((sec: number) => {
    const video = currentVideoElement();
    if (!video) return;
    video.currentTime = sec;
    void video.play().catch(() => undefined);
  }, []);

  return { position, currentTime, seek };
}
