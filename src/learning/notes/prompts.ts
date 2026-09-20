import type { NoteFormat, NoteScopeKind } from '@/types/notes';
import type { LearningContext } from '../context/context';
import { formatTimestamp } from '../knowledge/timestamps';
import type { Grounding } from './grounding';
import { LANGUAGE_INSTRUCTION } from './language';

/**
 * Independent of `AiPrompt` in src/learning/ai/actions.ts (WS3-owned) —
 * same shape, deliberately not imported from there, so WS2 has no
 * dependency on a file it doesn't own. WS3 wires this into the AI action
 * system at integration (docs/V5_CONTRACT.md §F).
 */
export interface NotePrompt {
  system: string;
  user: string;
}

const SCOPE_LABEL: Record<NoteScopeKind, string> = {
  'current-section': 'the current section only',
  range: 'the selected time range',
  'watched-so-far': 'everything watched so far in this video',
  'full-video': 'the complete video',
  revision: 'a quick revision recap',
  ask: 'a question the learner asked',
};

const NOTES_INSTRUCTION = 'Write structured study notes: a heading per concept covered, bullet points for facts, definitions and steps, and short code blocks where the evidence includes code or syntax.';
const MINDMAP_FORMAT = 'Write a hierarchical outline, not prose: one concept or detail per line, nested under its parent using 2 spaces of indentation per level. No markdown headers, no paragraphs, no bullet markers other than plain indentation.';

/**
 * How big and how deep the map should be — from the evidence, not the clock. A long lecture with many
 * distinct concepts earns a large, deep map; a short one, or one with thin evidence, a small one. The
 * old prompt said nothing about size, and the model returned a handful of lines for a three-hour lecture.
 */
export function mindmapGuidance(ctx: LearningContext, scopeKind: NoteScopeKind, grounding: Grounding): string {
  const minutes = ctx.range ? (ctx.range.endSec - ctx.range.startSec) / 60 : 0;
  const concepts = grounding.conceptTitles.length;
  const branches = Math.max(3, Math.min(9, concepts || Math.round(minutes / 7) || 3));
  const long = scopeKind !== 'current-section' && (minutes >= 25 || concepts >= 6);
  const root = scopeKind === 'current-section' ? 'the concept this section teaches' : `the subject of the whole video ("${ctx.videoTitle}")`;
  return [
    `Start with a single root line: ${root}.`,
    `Under it, about ${branches} main branches — one per major concept the evidence covers, in the order they are taught.`,
    long
      ? 'Go three to four levels deep where the evidence supports it: under each concept, its definition or purpose, the steps or cases, key details, and examples or pitfalls the instructor gives.'
      : 'Two to three levels deep: under each concept, the few details the evidence actually gives.',
    'Keep each line short (a phrase, not a sentence). Every line must be a distinct idea from the evidence — no filler, no repeating a parent in its child, no generic knowledge the video does not teach. If the evidence is thin, a smaller map is the right answer.',
  ].join(' ');
}
const REVISION_INSTRUCTION = 'These are quick revision notes for reviewing before continuing or before an exam: be concise — definitions, key facts, formulas and common pitfalls only, minimal elaboration.';

const SYSTEM = [
  'You are FocusSpace, generating study notes grounded in a specific YouTube video the learner is watching.',
  "Base every fact strictly on the evidence provided below. Course, playlist, chapter and position information is context only — never write notes that just restate it (position in a playlist, chapter names, \"next video\", channel bio). The notes must be about the subject matter being taught, not the video's structure.",
  'When the instructor stresses, repeats or gives a distinctive explanation of something, you may label it "Instructor emphasis:", "Notable explanation:" or "Useful intuition:" — never claim other teachers do not cover it, or that this explanation is unique, unless the evidence itself makes that comparison.',
  'If the evidence does not support a fact, leave it out. Do not guess, and do not fill gaps from general knowledge the evidence does not contain.',
].join(' ');

function orientationBlock(ctx: LearningContext, scopeKind: NoteScopeKind): string {
  const lines = [
    `Video: ${ctx.videoTitle}${ctx.channel ? ` — ${ctx.channel}` : ''}`,
    ctx.learningPath.currentTopic ? `Space: ${ctx.mode.name} (topic: ${ctx.learningPath.currentTopic})` : '',
    ctx.playlist ? `Course: ${ctx.playlist.title}${ctx.playlist.position ? `, video #${ctx.playlist.position} of ${ctx.playlist.total}` : ''}` : '',
    `Notes requested for: ${SCOPE_LABEL[scopeKind]}`,
  ].filter(Boolean);
  return ['[Context — where this sits in the course. Do not write notes about this list itself.]', ...lines].join('\n');
}

function evidenceBlock(ctx: LearningContext, grounding: Grounding): string {
  const lines: string[] = [];
  if (grounding.outline) lines.push('Concept structure in this range (from chapters, description or transcript — use it to organise the notes; it is not the notes itself):', grounding.outline);
  if (ctx.transcriptWindow) {
    lines.push(`Transcript excerpt (${formatTimestamp(ctx.transcriptWindow.startSec)}–${formatTimestamp(ctx.transcriptWindow.endSec)}):`, `"""${ctx.transcriptWindow.text}"""`);
  } else if (grounding.hasStructure) {
    lines.push('No transcript is available for this part of the video. Write notes only from the concept structure above, and do not invent explanations, examples or details the structure does not give you.');
  } else if (grounding.mentions.length) {
    lines.push(`This video is said to cover, without a transcript or chapters to ground detail: ${grounding.mentions.join(', ')}. List these as topics only — do not invent explanations for them.`);
  }
  return ['[Evidence — base every fact strictly on this]', ...lines].join('\n');
}

export function buildNotePrompt(ctx: LearningContext, scopeKind: NoteScopeKind, format: NoteFormat, grounding: Grounding, terms: string[]): NotePrompt {
  const formatRule = format === 'mindmap' ? `${MINDMAP_FORMAT} ${mindmapGuidance(ctx, scopeKind, grounding)}` : NOTES_INSTRUCTION;
  const revisionRule = scopeKind === 'revision' ? REVISION_INSTRUCTION : '';
  const languageRule = LANGUAGE_INSTRUCTION[ctx.language];
  const termsRule = terms.length ? `Keep these terms exactly as written, in every language: ${terms.join(', ')}.` : '';

  const user = [orientationBlock(ctx, scopeKind), '', evidenceBlock(ctx, grounding), '', 'Task:', formatRule, revisionRule, languageRule, termsRule].filter(Boolean).join('\n');
  return { system: SYSTEM, user };
}
