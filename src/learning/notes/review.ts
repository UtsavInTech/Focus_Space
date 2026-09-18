/**
 * Deterministic safety net over a generated note — the same spirit as
 * `reviewQuiz` in src/learning/ai/actions.ts (WS3), independently
 * implemented here since WS2 does not touch that file. Catches what the
 * prompt asked the model not to do, in case it did it anyway.
 */

export interface NoteIssue {
  code: 'comparative-claim' | 'metadata-only';
  detail: string;
}

/** "Nobody else teaches this", "this is the best explanation on YouTube" — unsupported uniqueness/superiority claims. */
const COMPARATIVE = /\b(?:only (?:teacher|instructor|creator|channel|video|course|one)\b[^.]{0,60}\b(?:teach|explain|cover|show)|no(?:body| one) else (?:teaches|explains|covers)|unique(?:ly)? (?:compared to|among|versus)|better than (?:other|any other) (?:teacher|instructor|channel|course)|best (?:explanation|teacher|course) (?:on|in) (?:youtube|the internet))/i;

/** A line that's just navigation/metadata ("Chapter 3: …", "Video #5 of 12", "Next video: …") rather than subject matter. */
const METADATA_LINE = /^#{0,6}\s*(?:this (?:video|lecture|section|course)\b|video\s*#?\d|chapter\s*\d|lecture\s*\d|part\s*\d|position\s*\d|playlist\s*:|course\s*:|next (?:video|lecture)\s*:|channel\s*:)/i;

/**
 * `contentTerms`: technical terms actually being taught in this range (see
 * language.ts). A note with zero overlap with them almost certainly didn't
 * use the evidence at all — it's describing the video, not its content.
 */
export function auditNote(text: string, contentTerms: string[]): NoteIssue[] {
  const issues: NoteIssue[] = [];
  if (COMPARATIVE.test(text)) issues.push({ code: 'comparative-claim', detail: 'Makes an unsupported comparison to other teachers, channels or courses.' });

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const metaLines = lines.filter((l) => METADATA_LINE.test(l));
  const hasContentTerm = contentTerms.length === 0 || contentTerms.some((t) => text.includes(t));
  if (lines.length > 0 && (metaLines.length / lines.length > 0.5 || !hasContentTerm)) {
    issues.push({ code: 'metadata-only', detail: 'Reads like course or video metadata (position, chapters, navigation) rather than the subject matter.' });
  }
  return issues;
}
