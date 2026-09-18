import type { LearningMode } from '@/types/domain';
import type { GeneratedNote, NoteFormat, NoteLanguage, NoteProvenance, NoteScopeKind } from '@/types/notes';
import { buildLearningContext, type LearningContext } from '../context/context';
import type { KnowledgeMap, TranscriptSegment } from '../knowledge/types';
import type { LearningPath } from '../path/path';
import { groundingFor, type Grounding } from './grounding';
import { technicalTerms } from './language';
import { buildNotePrompt, type NotePrompt } from './prompts';
import { auditNote, type NoteIssue } from './review';
import { parseMindMap } from './mindmap';
import { resolveScope, type NoteScope } from './scope';

/**
 * WS2's entry point: turns "notes for this scope, in this language, in this
 * format" into a `GeneratedNote`. Two layers, deliberately split so the
 * deterministic half is fully testable without a provider:
 *
 *  - `buildNoteRequest` (pure): resolves the scope to a range, builds the
 *    span-based `LearningContext` (context.ts), computes grounding, and
 *    constructs the prompt. No network, no AI, no randomness.
 *  - `generateNote` (async): refuses to call the provider at all when there
 *    is no evidence, otherwise calls the injected `complete` function
 *    (production wires this to a real AiProvider at integration — see
 *    docs/V5_CONTRACT.md §F/§H; tests inject a deterministic stub) and
 *    assembles the result.
 */

export interface NoteRequestInputs {
  video: { id: string; title: string; channelTitle: string };
  mode: LearningMode;
  topicId: string | null;
  path: LearningPath | null;
  map: KnowledgeMap | null;
  transcript: TranscriptSegment[] | null;
  currentTime: number;
  durationSec: number | null;
  scope: NoteScope;
  format: NoteFormat;
  language: NoteLanguage;
}

export interface NoteRequest {
  context: LearningContext;
  scopeKind: NoteScopeKind;
  grounding: Grounding;
  prompt: NotePrompt;
  terms: string[];
}

export function buildNoteRequest(inputs: NoteRequestInputs): NoteRequest {
  const resolved = resolveScope(inputs.scope, inputs.map, inputs.currentTime, inputs.durationSec);
  const context = buildLearningContext({
    video: inputs.video,
    mode: inputs.mode,
    topicId: inputs.topicId,
    path: inputs.path,
    map: inputs.map,
    transcript: inputs.transcript,
    currentTime: inputs.currentTime,
    range: resolved.range,
    language: inputs.language,
  });
  const grounding = groundingFor(inputs.map, resolved.range, context.transcriptWindow);
  const terms = technicalTerms(grounding.conceptTitles, inputs.mode.topics.map((t) => t.name), `${grounding.outline}\n${context.transcriptWindow?.text ?? ''}`);
  const prompt = buildNotePrompt(context, resolved.kind, inputs.format, grounding, terms);
  return { context, scopeKind: resolved.kind, grounding, prompt, terms };
}

export type NoteGenerationResult =
  | { ok: true; note: GeneratedNote; issues: NoteIssue[] }
  | { ok: false; code: 'no-evidence' | 'empty'; reason: string };

export async function generateNote(inputs: NoteRequestInputs, complete: (prompt: NotePrompt) => Promise<string>): Promise<NoteGenerationResult> {
  const request = buildNoteRequest(inputs);

  // Refuse before ever calling the provider — no evidence means nothing to ground a note in, not a prompt-engineering problem.
  if (!request.grounding.hasEvidence) {
    return { ok: false, code: 'no-evidence', reason: 'No transcript, chapters, description or comment evidence is available for this part of the video.' };
  }

  const raw = (await complete(request.prompt)).trim();
  if (!raw) return { ok: false, code: 'empty', reason: 'The AI returned an empty note.' };

  const issues = auditNote(raw, request.terms);

  const provenance: NoteProvenance = {
    videoTitle: inputs.video.title,
    channel: inputs.video.channelTitle,
    playlist: request.context.playlist ? { id: request.context.playlist.id, title: request.context.playlist.title, position: request.context.playlist.position, total: request.context.playlist.total } : null,
    topic: request.context.learningPath.currentTopic,
    scope: request.scopeKind,
    sources: request.grounding.sources,
    hasTranscript: request.grounding.hasTranscript,
    generatedAt: Date.now(),
  };
  // Contract semantics (src/types/notes.ts): range is null only for the whole video.
  const range = provenance.scope === 'full-video' ? null : request.context.range;

  const note: GeneratedNote =
    inputs.format === 'mindmap'
      ? {
          format: 'mindmap',
          language: inputs.language,
          videoId: inputs.video.id,
          range,
          markdown: null,
          mindmap: parseMindMap(raw, request.context.currentConcept ?? inputs.video.title),
          conceptIds: request.grounding.conceptIds,
          contextVersion: request.context.version,
          provenance,
        }
      : {
          format: 'notes',
          language: inputs.language,
          videoId: inputs.video.id,
          range,
          markdown: raw,
          mindmap: null,
          conceptIds: request.grounding.conceptIds,
          contextVersion: request.context.version,
          provenance,
        };

  return { ok: true, note, issues };
}
