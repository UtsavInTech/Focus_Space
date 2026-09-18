/**
 * Voice is text chat with speech for input/output — not a separate AI
 * architecture. The UI layer (content/ui) owns the actual
 * SpeechRecognition/SpeechSynthesis browser APIs (DOM-only, no extension
 * permission, nothing paid); it recognises speech to text, sends the exact
 * same `chat/send` request as a typed turn (with `voice: true`), and can
 * speak the answer back. This file has no DOM dependency and stays
 * unit-testable like everything else in src/learning — it only has the
 * piece that's genuinely voice-specific and not UI: preparing an answer for
 * speech synthesis.
 */

/** Markdown/code reads oddly aloud — strip it before handing text to speech synthesis. */
export function prepareForSpeech(text: string): string {
  return text
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, ' Code block omitted. ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
