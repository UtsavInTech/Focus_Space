import type { ChatMessage } from '@/types/chat';
import type { GeneratedNote, NoteLanguage } from '@/types/notes';
import { CONTEXT_VERSION } from '../context/context';

/**
 * An Ask AI answer, kept as a note.
 *
 * A chat explanation is often the one that finally lands — "explain it like I'm five" — so it belongs in
 * the Library beside the written notes, under the same Space and video, rather than vanishing when the
 * panel closes. The question is kept with the answer: without it the reply reads like it is about nothing.
 */
export function noteFromAnswer(input: {
  answer: ChatMessage;
  question: string | null;
  video: { id: string; title: string; channelTitle: string };
  space: { id: string; name: string } | null;
  topic: string | null;
  language: NoteLanguage;
  hasTranscript: boolean;
  now?: number;
}): GeneratedNote {
  const at = Math.max(0, Math.floor(input.answer.currentTime));
  const asked = input.question?.trim();
  return {
    format: 'notes',
    language: input.language,
    videoId: input.video.id,
    range: { startSec: at, endSec: at },
    markdown: asked ? `**You asked:** ${asked}\n\n${input.answer.text}` : input.answer.text,
    mindmap: null,
    conceptIds: [],
    contextVersion: CONTEXT_VERSION,
    provenance: {
      videoTitle: input.video.title,
      channel: input.video.channelTitle,
      space: input.space,
      playlist: null,
      topic: input.topic,
      scope: 'ask',
      sources: [],
      hasTranscript: input.hasTranscript,
      generatedAt: input.now ?? Date.now(),
    },
  };
}
