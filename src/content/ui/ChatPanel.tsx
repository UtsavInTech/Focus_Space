import { useRef, useState } from 'react';
import { Mic, Send, Volume2, X } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import type { NoteLanguage } from '@/types/notes';
import type { ChatMessage } from '@/types/chat';
import type { KnowledgeMap, TranscriptSegment } from '@/learning/knowledge/types';
import { buildLearningContext } from '@/learning/context/context';
import { createChatMessage } from '@/learning/ai/chat';
import type { HomepageContext } from '@/learning/ai/homepage-context';
import { prepareForSpeech } from '@/learning/ai/voice';
import type { LearningPath } from '@/learning/path/path';
import { sendMessage } from '@/messaging/runtime';
import { RichText } from '@/ui/components/RichText';
import { saveChatSession } from '@/storage/chat-store';

/**
 * "Ask AI…": a genuine back-and-forth conversation, distinct from the
 * single-shot "Ask about this moment". Every turn rebuilds the
 * LearningContext at the *current* playback time (buildLearningContext —
 * the same function every other AI surface uses), so the conversation stays
 * timestamp-aware even as the learner keeps watching.
 *
 * Voice is speech-to-text into this same pipeline, not a separate
 * conversational-assistant mode: recognised speech fills the input for the
 * learner to review/edit, exactly like typing — it is never auto-sent, and
 * the answer is never auto-spoken. Reading a reply aloud is one explicit tap
 * (the speaker icon on that message), never automatic.
 */

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const speechSupported = typeof window !== 'undefined' && !!speechRecognitionCtor();
const speakSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function speak(text: string) {
  if (!speakSupported) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(prepareForSpeech(text)));
}

export interface ChatPanelProps {
  /**
   * Video-moment mode (unchanged watch-page behaviour) when `homepage` is
   * omitted — every field below is required exactly as before. Pass
   * `homepage` instead (from a non-video page) to ground this same panel in
   * a `HomepageContext` rather than a video `LearningContext` — see
   * src/learning/ai/homepage-context.ts and chat.ts's routing.
   */
  video?: { id: string; title: string; channelTitle: string } | null;
  mode?: LearningMode;
  topicId?: string | null;
  path?: LearningPath | null;
  map?: KnowledgeMap | null;
  transcript?: TranscriptSegment[] | null;
  currentTime?: () => number;
  homepage?: HomepageContext | null;
  language: NoteLanguage;
  onClose: () => void;
}

export function ChatPanel({ video, mode, topicId, path, map, transcript, currentTime, homepage, language, onClose }: ChatPanelProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [listening, setListening] = useState(false);
  /** Whether the current text in the box came from speech recognition, untouched since — cleared the moment the learner edits it. Provenance only; never triggers anything automatic. */
  const [voiceOrigin, setVoiceOrigin] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // One saved conversation per panel opened — the Library shows it as it ends.
  const sessionId = useRef(`chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  async function submit(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const fromVoice = voiceOrigin;
    setError(null);
    setQuestion('');
    setVoiceOrigin(false);
    const at = currentTime?.() ?? 0;
    const videoId = video?.id ?? '';
    const learnerTurn = createChatMessage('learner', q, videoId, at, fromVoice);
    const nextHistory = [...history, learnerTurn];
    setHistory(nextHistory);
    setLoading(true);
    // Homepage/browse pages ground in HomepageContext, not the video pipeline — a video page keeps building
    // LearningContext exactly as before (buildLearningContext, untouched — see homepage-context.ts).
    const context = homepage ?? buildLearningContext({ video: video ?? { id: '', title: '', channelTitle: '' }, mode: mode!, topicId: topicId ?? null, path: path ?? null, map: map ?? null, transcript: transcript ?? null, currentTime: at, language });
    const result = await sendMessage('chat/send', { context, history, question: q, voice: fromVoice }).catch(() => null);
    setLoading(false);
    if (!result || !result.ok) {
      setError(!result ? { text: 'FocusSpace couldn’t reach its AI service. Reload the page and try again.' } : { text: result.error, code: result.code });
      return;
    }
    // Text is the primary response — always. Speaking it aloud is a separate, explicit action (the speaker icon below), never automatic.
    const answered = [...nextHistory, createChatMessage('assistant', result.answer, videoId, at, fromVoice)];
    setHistory(answered);
    void saveChatSession({ id: sessionId.current, videoId, modeId: mode?.id ?? '', title: video?.title || 'YouTube home', messages: answered }).catch(() => undefined);
  }

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    // One final transcript, not a running conversation: speech becomes text in the box for the learner to review and send, same as typing.
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript;
      if (text) {
        setQuestion(text);
        setVoiceOrigin(true);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <div className="fs-answer" role="region" aria-label="Ask AI">
      <div className="fs-answer-head">
        <span>Ask AI</span>
        <button type="button" className="fs-icon-plain" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="fs-answer-body">
        {history.length === 0 && <p className="fs-answer-note">{homepage ? 'What do you want to learn or watch? Ask about this YouTube page.' : 'Ask anything about what you’re watching — FocusSpace keeps track of where you are in the video.'}</p>}
        {history.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div className="fs-answer-note">{m.role === 'learner' ? 'You' : 'FocusSpace'}</div>
            {m.role === 'assistant' ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <RichText text={m.text} />
                </div>
                {speakSupported && (
                  <button type="button" className="fs-icon-plain" aria-label="Read aloud" onClick={() => speak(m.text)}>
                    <Volume2 size={14} aria-hidden />
                  </button>
                )}
              </div>
            ) : (
              <p>{m.text}</p>
            )}
          </div>
        ))}
        {loading && <p className="fs-answer-note" aria-busy="true">Thinking…</p>}
        {/* A monthly-allowance message (Layer 2C) is an expected, calm state, not a failure — it gets the plain note style, never the red "danger" tint. */}
        {error && (
          <p className={`fs-answer-note${error.code === 'quota_exceeded' ? '' : ' fs-error'}`}>
            {error.text}
            {error.code === 'quota_exceeded' && (
              <button type="button" className="fs-link" onClick={() => void sendMessage('site/open', { path: '/pricing' })}>
                See plans
              </button>
            )}
          </p>
        )}

        <form
          className="fs-ask"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(question);
          }}
        >
          <input
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setVoiceOrigin(false);
            }}
            placeholder={listening ? 'Listening…' : 'Ask AI…'}
            aria-label="Ask AI"
            maxLength={500}
          />
          {speechSupported && (
            <button type="button" className={`fs-icon-plain${listening ? ' is-listening' : ''}`} aria-label={listening ? 'Stop listening' : 'Ask by voice'} aria-pressed={listening} onClick={toggleMic}>
              <Mic size={16} aria-hidden />
            </button>
          )}
          <button type="submit" className="fs-icon-plain" aria-label="Send" disabled={!question.trim() || loading}>
            <Send size={16} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
