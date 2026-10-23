import { inferModeIntent } from './intent';
import { isExamId, type ExamId } from './exams';

/**
 * "I'm preparing for UPSC", "ssc cgl", "neet 2026" → the exam, when the words clearly name one. Used by
 * the setup guide so a typed or spoken exam builds the same Space as tapping it.
 */
/** "I'm preparing for", "studying for the"… — the words around an exam name, never the name itself. */
const LEAD_IN = /\b(i\s*am|i'm|im|my|currently|preparing|prepare|preparation|prep|studying|study|for|the|exam|exams|aspirant|target(?:ing)?|cracking|crack)\b/gi;

export function examFromText(text: string): ExamId | null {
  // The words as said first ("CAT exam" is a phrase of its own), then without the lead-in, because short
  // names ("NDA", "JEE") only count when they are the whole answer.
  const core = text.replace(LEAD_IN, ' ').replace(/\s+/g, ' ').trim();
  for (const candidate of [text, core]) {
    const suggestion = candidate ? inferModeIntent(candidate) : null;
    if (suggestion && suggestion.confidence !== 'low' && isExamId(suggestion.templateId)) return suggestion.templateId;
  }
  return null;
}
