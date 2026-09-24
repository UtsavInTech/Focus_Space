import { useRef, useState } from 'react';
import { Check, Mic, NotebookPen, Send, Volume2, X } from 'lucide-react';
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
import { noteFromAnswer } from '@/learning/notes/from-answer';
import { saveChatSession } from '@/storage/chat-store';

/**
 * FocusSpace AI's conversation: a genuine back-and-forth, distinct from the
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

interface SpeechResultLike {
  isFinal: boolean;
  [alternative: number]: { transcript: string };
}

interface SpeechEventLike {
  results: { length: number; [index: number]: SpeechResultLike };
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechEventLike) => void) | null;
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
  /** One saved conversation per panel opened — the Library shows it as it ends. */
  const sessionId = useRef(`chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  /** What was in the box when dictation started — speech is added to it, never over it. */
  const micBase = useRef('');
  /** True between the two presses of the mic: a session that ends on silence is restarted, not abandoned. */
  const wantsMic = useRef(false);
  const questionRef = useRef('');
  questionRef.current = question;
  /** Answers already kept in the Library, so the button can say so. */
  const [saved, setSaved] = useState<string[]>([]);

  async function submit(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const fromVoice = voiceOrigin;
    setError(null);
    setQuestion('');
    micBase.current = '';
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

  /** Keeps an answer worth keeping — see learning/notes/from-answer.ts. */
  async function saveAnswer(turn: ChatMessage) {
    if (!video?.id || saved.includes(turn.id)) return;
    const askedAt = history.findIndex((m) => m.id === turn.id);
    const asked = [...history.slice(0, askedAt)].reverse().find((m) => m.role === 'learner')?.text ?? null;
    const note = noteFromAnswer({
      answer: turn,
      question: asked,
      video,
      space: mode ? { id: mode.id, name: mode.name } : null,
      topic: mode?.topics.find((t) => t.id === topicId)?.name ?? null,
      language,
      hasTranscript: !!transcript?.length,
    });
    const stored = await sendMessage('notes/save', { note }).catch(() => null);
    if (stored) setSaved((ids) => [...ids, turn.id]);
  }

  function toggleMic() {
    if (listening) {
      wantsMic.current = false;
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    micBase.current = question.trim();
    wantsMic.current = true;
    setListening(true);
    startRecognition(Ctor);
  }

  function startRecognition(Ctor: new () => SpeechRecognitionLike) {
    const recognition = new Ctor();
    recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.continuous = true;
    // Interim words appear as they are spoken; each event rebuilds the whole dictation, so nothing is doubled.
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let heard = '';
      for (let i = 0; i < event.results.length; i++) heard += `${event.results[i][0]?.transcript ?? ''} `;
      const spoken = heard.replace(/\s+/g, ' ').trim();
      if (!spoken) return;
      setQuestion([micBase.current, spoken].filter(Boolean).join(' '));
      setVoiceOrigin(true);
    };
    recognition.onerror = () => {
      wantsMic.current = false;
      setListening(false);
    };
    recognition.onend = () => {
      // Chrome ends a continuous session on a long silence; keep listening until the learner says stop.
      if (!wantsMic.current) {
        setListening(false);
        return;
      }
      micBase.current = questionRef.current.trim();
      try {
        startRecognition(Ctor);
      } catch {
        setListening(false);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  const empty = history.length === 0;

  /*
   * Three parts, and only three: a header, a thread that scrolls, and a composer that does not. The
   * composer used to live *inside* the scrolling body, which is why it floated in the middle of an
   * empty panel and drifted as answers arrived. Each part is a plain region on one surface — the panel
   * itself is the only thing with a border, so there is no container-inside-a-container outline.
   */
  return (
    <div className="fs-ai-panel">
      <header className="fs-ai-panel-head">
        <span className="fs-ai-panel-title">FocusSpace AI</span>
        <button type="button" className="fs-icon-plain" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="fs-ai-thread">
        {empty && (
          <p className="fs-ai-empty">
            {homepage ? 'Ask anything about this page — what to watch, or what to learn next.' : 'Ask anything about this video. FocusSpace knows where you are in it.'}
          </p>
        )}

        {history.map((m) =>
          m.role === 'learner' ? (
            <div key={m.id} className="fs-ai-turn fs-ai-turn-you">
              <p>{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="fs-ai-turn fs-ai-turn-ai">
              <RichText text={m.text} />
              <div className="fs-ai-turn-actions">
                {speakSupported && (
                  <button type="button" className="fs-icon-plain" aria-label="Read aloud" onClick={() => speak(m.text)}>
                    <Volume2 size={14} aria-hidden />
                  </button>
                )}
                {!!video?.id && (
                  <button
                    type="button"
                    className="fs-icon-plain"
                    aria-label={saved.includes(m.id) ? 'Saved to your notes' : 'Save this answer to your notes'}
                    title={saved.includes(m.id) ? 'Saved to your notes' : 'Save to notes'}
                    disabled={saved.includes(m.id)}
                    onClick={() => void saveAnswer(m)}
                  >
                    {saved.includes(m.id) ? <Check size={14} aria-hidden /> : <NotebookPen size={14} aria-hidden />}
                  </button>
                )}
              </div>
            </div>
          ),
        )}

        {loading && (
          <p className="fs-ai-thinking" aria-busy="true">
            <span />
            <span />
            <span />
          </p>
        )}

        {/* A monthly-allowance message (Layer 2C) is an expected, calm state, not a failure — it gets the plain note style, never the red "danger" tint. */}
        {error && (
          <p className={`fs-ai-note${error.code === 'quota_exceeded' ? '' : ' fs-error'}`}>
            {error.text}
            {error.code === 'quota_exceeded' && (
              <button type="button" className="fs-link" onClick={() => void sendMessage('site/open', { path: '/pricing' })}>
                See plans
              </button>
            )}
          </p>
        )}
      </div>

      {/*
       * One composer, one outline. The border belongs to the form; the input inside it is transparent
       * and borderless, so focus moves a single ring rather than lighting up a box within a box.
       */}
      <form
        className={`fs-ai-composer${listening ? ' is-listening' : ''}`}
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
          placeholder={listening ? 'Listening…' : homepage ? 'Ask about this page…' : 'Ask about this video…'}
          aria-label="Ask FocusSpace AI"
          maxLength={500}
        />
        {speechSupported && (
          <button type="button" className={`fs-ai-mic${listening ? ' is-listening' : ''}`} aria-label={listening ? 'Stop listening' : 'Ask by voice'} aria-pressed={listening} onClick={toggleMic}>
            <Mic size={16} aria-hidden />
          </button>
        )}
        <button type="submit" className="fs-ai-send" aria-label="Send" disabled={!question.trim() || loading}>
          <Send size={15} aria-hidden />
        </button>
      </form>
    </div>
  );
}
