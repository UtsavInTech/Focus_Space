import type { NotePrompt } from '../notes/prompts';
import { buildNoteRequest, generateNote, type NoteGenerationResult, type NoteRequestInputs } from '../notes/generator';
import { pickProvider, type AiProvider } from './service';
import { approxTokens, type UsageSink } from './usage';

/**
 * Wires WS2's `generateNote()` complete-function boundary to the real
 * `AiProvider` — the only thing this file does. Grounding, prompt
 * construction and the `GeneratedNote` shape are entirely WS2's
 * (src/learning/notes/generator.ts), untouched and unbypassed; this is
 * provider plumbing, reusing the exact same `pickProvider` selection and
 * usage accounting as `run()`/`chat()` in service.ts.
 */
export async function generateNoteWithProvider(
  inputs: NoteRequestInputs,
  providers: AiProvider[],
  usage?: UsageSink,
  signal?: AbortSignal,
): Promise<NoteGenerationResult | { ok: false; code: 'unavailable' | 'failed' | 'quota_exceeded'; reason: string }> {
  const found = await pickProvider(providers);
  if (!found || found.availability !== 'available') {
    return {
      ok: false,
      code: 'unavailable',
      reason: found?.availability === 'downloadable' || found?.availability === 'downloading' ? 'The on-device model is not downloaded yet.' : 'No AI provider is set up.',
    };
  }

  // For the wire payload only (the learner's endpoint sees which context produced the request) —
  // generateNote() below builds its own context internally; this is the same pure, cheap call, not a second path.
  const { context } = buildNoteRequest(inputs);

  const complete = async (prompt: NotePrompt) => {
    const text = await found.provider.complete(prompt, { action: inputs.format === 'mindmap' ? 'mindmap' : 'notes', context }, signal);
    usage?.record({ provider: found.provider.id, action: inputs.format, at: Date.now(), cached: false, approxTokens: approxTokens(text) });
    return text;
  };

  // generateNote() (WS2, pure grounding logic) has no try/catch of its own around `complete()` — a
  // thrown provider error (network failure, or a Layer 2C quota_exceeded) must not escape uncaught:
  // the message channel would reject it into a generic "couldn't reach AI service" for the learner,
  // losing the server's real, more useful reason (e.g. their monthly allowance).
  try {
    return await generateNote(inputs, complete);
  } catch (err) {
    const code = err instanceof Error && (err as Error & { code?: string }).code === 'quota_exceeded' ? 'quota_exceeded' : 'failed';
    return { ok: false, code, reason: err instanceof Error ? err.message : 'The AI request failed.' };
  }
}
