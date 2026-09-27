import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Mic, NotebookPen, Square, Volume2, X } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import type { NoteLanguage } from '@/types/notes';
import type { ChatMessage } from '@/types/chat';
import type { KnowledgeMap, TranscriptSegment } from '@/learning/knowledge/types';
import type { OutlineSection } from '@/learning/outline/outline';
import { buildLearningContext, type TranscriptSource } from '@/learning/context/context';
import { createChatMessage } from '@/learning/ai/chat';
import { looksLikeCommand, runCommand } from './ai-commands';
import type { HomepageContext } from '@/learning/ai/homepage-context';
import type { LearningPath } from '@/learning/path/path';
import { sendMessage } from '@/messaging/runtime';
import { RichText } from '@/ui/components/RichText';
import { FocusMark } from '@/ui/components/primitives';
import { noteFromAnswer } from '@/learning/notes/from-answer';
import { saveChatSession } from '@/storage/chat-store';
import { useCanSave } from '@/ui/account/use-can-save';
import { LimitActions } from './LimitActions';
import { SignInToSave } from './SignInToSave';
import { Composer } from './Composer';
import { FREE_MONTHLY_VOICE_MINUTES } from '@/billing/plans';
import { openSignIn } from '@/ui/account/use-can-save';
import { audioContext, blobToBase64, MicrophoneBlockedError, prepareFillers, speakOnce, stopSpeech, VoiceConversation, type VoiceState } from './voice';

/**
 * FocusSpace AI's conversation: a genuine back-and-forth about the video,
 * next to the single-shot actions (Explain, Example, Quiz me). Every turn rebuilds the
 * LearningContext at the *current* playback time (buildLearningContext —
 * the same function every other AI surface uses), so the conversation stays
 * timestamp-aware even as the learner keeps watching.
 *
 * Talking is this same pipeline, spoken: Talk opens a hands-free conversation inside the panel
 * (./voice.ts) — what you say is transcribed by FocusSpace's server and sent exactly like a typed
 * question, the answer appears in the thread and is spoken in the same natural voice as the setup guide,
 * then it listens again. You can talk over it; End (or typing) stops it. Every answer also has a
 * speaker button that reads it in that voice — never the browser's robotic one.
 */

/*
 * The composer grows with what is typed so a long question stays readable, but only so far: it is a
 * box beside a video, and a paragraph must never push the conversation off the panel. Up to
 * ROOMY_LINES it grows at the normal size; past that the text steps down one size so more of it fits;
 * past MAX_LINES (at that smaller size) it stops growing and scrolls.
 */
const COMPOSER_PAD = 16;
const ROOMY_LINE = 20;
const ROOMY_LINES = 5;
const COMPACT_LINE = 18;
const MAX_LINES = 8;
/** The API's own ceiling (server/validate.ts MAX_QUESTION_CHARS). */
const MAX_QUESTION_CHARS = 2000;

function fitComposer(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.fontSize = '';
  el.style.lineHeight = '';
  el.style.height = 'auto';
  if (el.scrollHeight > ROOMY_LINES * ROOMY_LINE + COMPOSER_PAD) {
    el.style.fontSize = '13px';
    el.style.lineHeight = `${COMPACT_LINE}px`;
  }
  const max = MAX_LINES * COMPACT_LINE + COMPOSER_PAD;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}

/** Asked of spoken questions, so the answer is something to listen to, not a page to read. */
const SPOKEN_STYLE = '\n\n(Spoken conversation: answer in two or three short, natural sentences, no lists or headings.)';

const synthesize = async (text: string) => {
  const res = await sendMessage('voice/speak', { text, purpose: 'chat' }).catch(() => null);
  return res?.ok ? res.audio : null;
};

/** Voice in FocusSpace AI is part of an account (server/usage/voice.ts); this is what a guest is told. */
const VOICE_NEEDS_ACCOUNT = `Talking with FocusSpace AI needs a free account. It includes ${FREE_MONTHLY_VOICE_MINUTES} minutes of voice a month. Typing works as it is.`;

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
  /** Whether those segments are uploaded captions or speech recognition — see TranscriptSource. */
  transcriptSource?: TranscriptSource | null;
  /** The whole-video outline (content/data/outline.ts) — null until it arrives, or when there is none. */
  outline?: OutlineSection[] | null;
  /**
   * Fetches the captions when they have not arrived yet. A question asked right after jumping into a
   * long video used to go out before its transcript did, and was answered as if there were none.
   */
  loadTranscript?: () => Promise<TranscriptSegment[] | null>;
  currentTime?: () => number;
  /** Moves the player to a time an answer cites — the same seek the Knowledge Map uses. Absent on pages without a video. */
  onSeek?: (sec: number) => void;
  /** The video's length, so a cited time past its end is never offered as a link. */
  durationSec?: number | null;
  homepage?: HomepageContext | null;
  language: NoteLanguage;
  onClose: () => void;
}

export function ChatPanel({ video, mode, topicId, path, map, transcript, transcriptSource, outline, loadTranscript, currentTime, onSeek, durationSec, homepage, language, onClose }: ChatPanelProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  /** A spoken conversation is running (Talk), and where it is. */
  const [talking, setTalking] = useState(false);
  const [talkState, setTalkState] = useState<VoiceState>('idle');
  const convo = useRef<VoiceConversation | null>(null);
  const filler = useRef<() => string | null>(() => null);
  const orbRef = useRef<HTMLSpanElement>(null);
  /** One saved conversation per panel opened — the Library shows it as it ends. */
  const sessionId = useRef(`chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  /** Answers already kept in the Library, so the button can say so. */
  const [saved, setSaved] = useState<string[]>([]);
  /** Chatting is open to everyone; keeping the conversation needs an account (ui/account/save-gate.ts). */
  const canSave = useCanSave();
  const [savePromptDismissed, setSavePromptDismissed] = useState(false);
  /** The id of the answer being read aloud, or null. Speech is never started by anything but a press. */
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  /*
   * Reading an answer aloud is a toggle, and only ever a toggle: one answer speaks at a time, the button
   * shows which, and pressing it again — or closing the panel, or asking something new — stops it.
   */
  const stopSpeaking = useCallback(() => {
    stopSpeech();
    setSpeakingId(null);
  }, []);

  const toggleSpeak = useCallback(
    (turn: ChatMessage) => {
      if (speakingId === turn.id) return stopSpeaking();
      if (!canSave) return setError({ text: VOICE_NEEDS_ACCOUNT, code: 'sign_in' });
      convo.current?.interrupt();
      setSpeakingId(turn.id);
      speakOnce(turn.text, synthesize, (speaking) => {
        if (!speaking) setSpeakingId((id) => (id === turn.id ? null : id));
      });
    },
    [speakingId, stopSpeaking, canSave],
  );

  const endTalk = useCallback(() => {
    convo.current?.close();
    convo.current = null;
    setTalking(false);
    setTalkState('idle');
  }, []);

  // Nothing should keep talking — or listening — into a panel that is gone.
  useEffect(
    () => () => {
      stopSpeech();
      convo.current?.close();
    },
    [],
  );

  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Opening FocusSpace AI means asking something: the cursor is in the box straight away (Talk is beside it).
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  /*
   * The thread scrolls on its own, so the newest turn has to be brought into view: a question to the
   * bottom, and an answer to its first line — a long answer is read from the top, not the end.
   */
  const lastId = history[history.length - 1]?.id;
  useEffect(() => {
    const thread = threadRef.current;
    const turns = thread?.querySelectorAll<HTMLElement>('.fs-ai-turn');
    const last = turns?.[turns.length - 1];
    if (!thread || !last) return;
    if (last.classList.contains('fs-ai-turn-ai')) thread.scrollTop += last.getBoundingClientRect().top - thread.getBoundingClientRect().top - 8;
    else thread.scrollTop = thread.scrollHeight;
  }, [lastId, loading]);

  async function submit(text: string, spoken = false) {
    const q = text.trim();
    if (!q || loading) return;
    stopSpeaking();
    if (!spoken) convo.current?.interrupt();
    const fromVoice = spoken;
    setError(null);
    if (!spoken) setQuestion('');
    const at = currentTime?.() ?? 0;
    const videoId = video?.id ?? '';
    const learnerTurn = createChatMessage('learner', q, videoId, at, fromVoice);
    const nextHistory = [...history, learnerTurn];
    setHistory(nextHistory);
    setLoading(true);
    // "Change the mode to music and play …" is something to do, not something to answer (./ai-commands.ts).
    if (looksLikeCommand(q)) {
      const done = await runCommand(q).catch(() => null);
      if (done) {
        setLoading(false);
        setHistory([...nextHistory, createChatMessage('assistant', done.reply, videoId, at, fromVoice)]);
        if (done.navigating) {
          // Long enough to read (or hear the start of) what it did; the page it opened is the real answer.
          void convo.current?.say(done.reply);
          window.setTimeout(() => {
            endTalk();
            onClose();
          }, 1400);
        } else if (spoken) {
          void convo.current?.say(done.reply);
          convo.current?.listenAfterSpeaking();
        }
        return;
      }
    }
    // Homepage/browse pages ground in HomepageContext, not the video pipeline — a video page keeps building
    // LearningContext exactly as before (buildLearningContext, untouched — see homepage-context.ts).
    const segments = homepage || transcript?.length || !loadTranscript ? transcript : await loadTranscript().catch(() => null);
    // The question goes in too, so the context carries what is said about it elsewhere in the video (knowledge/passages.ts) — found here, locally.
    const context = homepage ?? buildLearningContext({ video: video ?? { id: '', title: '', channelTitle: '' }, mode: mode!, topicId: topicId ?? null, path: path ?? null, map: map ?? null, transcript: segments ?? null, transcriptSource: transcriptSource ?? null, outline: outline ?? null, currentTime: at, language, question: q });
    const result = await sendMessage('chat/send', { context, history, question: spoken ? q + SPOKEN_STYLE : q, voice: fromVoice }).catch(() => null);
    setLoading(false);
    if (!result || !result.ok) {
      setError(!result ? { text: 'FocusSpace couldn’t reach its AI service. Reload the page and try again.' } : { text: result.error, code: result.code });
      if (spoken) convo.current?.idle();
      return;
    }
    if (spoken && convo.current) {
      void convo.current.say(result.answer);
      convo.current.listenAfterSpeaking();
    }
    // Typed questions get text only; a spoken one (Talk) is answered out loud as well, above.
    const answered = [...nextHistory, createChatMessage('assistant', result.answer, videoId, at, fromVoice)];
    setHistory(answered);
    if (canSave) void saveChatSession({ id: sessionId.current, videoId, modeId: mode?.id ?? '', title: video?.title || 'YouTube home', messages: answered }).catch(() => undefined);
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

  /** Talk: a hands-free spoken conversation, inside this panel. */
  async function startTalk() {
    if (convo.current) return endTalk();
    if (!canSave) return setError({ text: VOICE_NEEDS_ACCOUNT, code: 'sign_in' });
    audioContext(); // unlocked by this click, so the answer can be heard
    stopSpeaking();
    const conversation = new VoiceConversation({
      synthesize,
      transcribe: async (audio, mime) => {
        const hint = homepage ? 'Asking FocusSpace AI about the YouTube home page, or asking it to switch Space or play something.' : `Asking about the video “${video?.title ?? ''}”.`;
        const res = await sendMessage('voice/transcribe', { audio: await blobToBase64(audio), mime, hint, purpose: 'chat' }).catch(() => null);
        if (res && !res.ok) setError({ text: res.error });
        return res?.ok ? res.text : null;
      },
      onState: setTalkState,
      onLevel: (l) => orbRef.current?.style.setProperty('--fs-level', l.toFixed(3)),
      onHeard: (said) => {
        conversation.sayPrepared(filler.current());
        void submit(said, true);
      },
    });
    try {
      await conversation.start();
    } catch (err) {
      setError({ text: err instanceof MicrophoneBlockedError ? 'The microphone is blocked for YouTube. Allow it from the icon at the left of the address bar, or type instead.' : 'Your browser won’t let FocusSpace listen right now, type instead.' });
      return;
    }
    convo.current = conversation;
    filler.current = prepareFillers(synthesize);
    setTalking(true);
    setError(null);
    conversation.listen();
  }

  function tapOrb() {
    const c = convo.current;
    if (!c) return;
    if (talkState === 'listening') c.stopListening();
    else if (!loading && talkState !== 'hearing') c.listen();
  }


  /*
   * Three parts, and only three: a header, a thread that scrolls, and a composer that does not. The
   * composer used to live *inside* the scrolling body, which is why it floated in the middle of an
   * empty panel and drifted as answers arrived. Each part is a plain region on one surface — the panel
   * itself is the only thing with a border, so there is no container-inside-a-container outline.
   */
  return (
    <div className="fs-ai-panel">
      <header className="fs-ai-panel-head">
        <span className="fs-ai-panel-title">
          <FocusMark size={16} active />
          FocusSpace AI
        </span>
        <button type="button" className="fs-icon-plain" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </header>

      <div ref={threadRef} className="fs-ai-thread">

        {history.map((m) =>
          m.role === 'learner' ? (
            <div key={m.id} className="fs-ai-turn fs-ai-turn-you">
              <p>{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className={`fs-ai-turn fs-ai-turn-ai${speakingId === m.id ? ' is-speaking' : ''}`}>
              <RichText text={m.text} onSeek={homepage ? undefined : onSeek} maxSec={durationSec} />
              <div className="fs-ai-turn-actions">
                <button
                  type="button"
                  className={`fs-icon-plain${speakingId === m.id ? ' is-speaking' : ''}`}
                  aria-label={speakingId === m.id ? 'Stop reading aloud' : 'Read this answer aloud'}
                  title={speakingId === m.id ? 'Stop reading' : 'Read aloud'}
                  aria-pressed={speakingId === m.id}
                  onClick={() => toggleSpeak(m)}
                >
                  {speakingId === m.id ? <Square size={13} aria-hidden /> : <Volume2 size={14} aria-hidden />}
                </button>
                {!!video?.id && canSave && (
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

        {/* After an answer, never before: the learner sees what FocusSpace AI does, then why an account keeps it. */}
        {canSave === false && !loading && !savePromptDismissed && history.some((m) => m.role === 'assistant') && <SignInToSave kind="chat" onDismiss={() => setSavePromptDismissed(true)} />}

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
            {error.code === 'quota_exceeded' && <LimitActions />}
            {error.code === 'sign_in' && (
              <button type="button" className="fs-link" onClick={openSignIn}>
                Sign in
              </button>
            )}
          </p>
        )}
      </div>

      {/*
       * One composer, one outline. The border belongs to the form; the input inside it is transparent
       * and borderless, so focus moves a single ring rather than lighting up a box within a box.
       */}
      {talking ? (
        <div className="fs-ai-talk" data-state={loading && talkState !== 'speaking' ? 'thinking' : talkState}>
          <button type="button" className="fs-ai-talk-orb" onClick={tapOrb} aria-label={talkState === 'listening' ? 'Done talking' : 'Talk'}>
            <span ref={orbRef} aria-hidden>
              {talkState === 'speaking' ? <AudioLines size={16} aria-hidden /> : talkState === 'listening' ? <Square size={12} aria-hidden /> : <Mic size={16} aria-hidden />}
            </span>
          </button>
          <p className="fs-ai-talk-status" role="status">
            {talkState === 'listening' ? 'Listening… just talk' : talkState === 'hearing' || loading ? 'Thinking…' : talkState === 'speaking' ? 'Speaking. Talk over me any time' : 'Tap to talk'}
          </p>
          <button type="button" className="fs-ai-talk-end" onClick={endTalk}>
            End
          </button>
        </div>
      ) : (
        <Composer
          className="fs-ai-composer"
          multiline
          fit={fitComposer}
          inputRef={inputRef}
          value={question}
          onChange={setQuestion}
          onSend={() => void submit(question)}
          onTalk={() => void startTalk()}
          placeholder="Ask anything"
          label="Ask FocusSpace AI"
          maxLength={MAX_QUESTION_CHARS}
          purpose="chat"
          voiceAllowed={!!canSave}
          onNeedSignIn={() => setError({ text: VOICE_NEEDS_ACCOUNT, code: 'sign_in' })}
          hint={homepage ? 'A question for FocusSpace AI about YouTube, or asking it to switch Space or play something.' : `A question about the video “${video?.title ?? ''}”.`}
          onError={(text) => setError({ text })}
        />
      )}
    </div>
  );
}
