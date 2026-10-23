import { inferModeIntent } from './intent';
import { isExamId, type ExamId } from './exams';

/**
 * "I'm preparing for UPSC", "ssc cgl", "neet 2026" → the exam, when the words clearly name one. Used by
 * the setup guide so a typed or spoken exam builds the same Space as tapping it.
 */
export function examFromText(text: string): ExamId | null {
  const suggestion = inferModeIntent(text);
  if (!suggestion || suggestion.confidence === 'low') return null;
  return isExamId(suggestion.templateId) ? suggestion.templateId : null;
}
