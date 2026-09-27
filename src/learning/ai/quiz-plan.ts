/**
 * How a quiz walks through a video: five questions for every 15 minutes of the part chosen ("Watched so
 * far" or "Full video"), one round at a time, so a six-hour course is never written up front. At most
 * `QUIZ_MAX_QUESTIONS` per quiz: past five hours the blocks simply grow, so the questions still spread
 * across the whole length.
 */

export const QUIZ_BLOCK_SEC = 15 * 60;
export const QUIZ_MAX_QUESTIONS = 100;
export const QUIZ_ROUND_QUESTIONS = 5;
const MAX_ROUNDS = QUIZ_MAX_QUESTIONS / QUIZ_ROUND_QUESTIONS;
/** Less than this is too little to ask five questions about. */
export const QUIZ_MIN_SPAN_SEC = 60;

export interface QuizBlock {
  startSec: number;
  endSec: number;
}

export function quizBlocks(startSec: number, endSec: number): QuizBlock[] {
  const length = endSec - startSec;
  if (!(length >= QUIZ_MIN_SPAN_SEC)) return [];
  const rounds = Math.min(MAX_ROUNDS, Math.ceil(length / QUIZ_BLOCK_SEC));
  const size = length / rounds;
  return Array.from({ length: rounds }, (_, i) => ({ startSec: Math.round(startSec + i * size), endSec: Math.round(i === rounds - 1 ? endSec : startSec + (i + 1) * size) }));
}
