import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { ArrowUp, AudioLines, Mic, Square } from 'lucide-react';
import type { VoicePurpose } from '@/types/setup';
import { sendMessage } from '@/messaging/runtime';
import { audioContext, blobToBase64, MicrophoneBlockedError, VoiceConversation } from './voice';

/**
 * The message box, shaped like every chat people already know:
 *
 *   [ type here …                    🎙  (●) ]      ← empty: the mic dictates, the round button talks
 *   [ what I typed                   🎙  (↑) ]      ← with text: the round button sends it
 *
 * The mic turns speech into text in the box (FocusSpace's transcription, then it's yours to edit); the
 * round button starts a spoken conversation. One outline, on the box itself (.fs-focus-host).
 */

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** Start a spoken conversation (voice mode). */
  onTalk: () => void;
  placeholder: string;
  disabled?: boolean;
  /** Grows with what is typed (FocusSpace AI) rather than staying one line (the guide). */
  multiline?: boolean;
  /** Setup is open to everyone; chat voice needs an account (server/usage/voice.ts). */
  purpose: VoicePurpose;
  /** False when this person can't use voice here — the voice buttons then ask them to sign in. */
  voiceAllowed: boolean;
  onNeedSignIn: () => void;
  /** Tells the transcriber what to expect. */
  hint?: string;
  className: string;
  inputRef?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  label: string;
  maxLength?: number;
  /** Called after the textarea resizes — FocusSpace AI's own fitting rules. */
  fit?: (el: HTMLTextAreaElement | null) => void;
  onError?: (message: string) => void;
}

export function Composer(props: ComposerProps) {
  const { value, onChange, onSend, onTalk, placeholder, disabled, multiline, purpose, voiceAllowed, onNeedSignIn, hint, className, label, maxLength, fit, onError } = props;
  const ownRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const ref = props.inputRef ?? ownRef;
  const [dictating, setDictating] = useState<'off' | 'listening' | 'hearing'>('off');
  const dictation = useRef<VoiceConversation | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useLayoutEffect(() => {
    if (multiline) fit?.(ref.current as HTMLTextAreaElement | null);
  }, [value, multiline, fit, ref]);

  useEffect(
    () => () => {
      dictation.current?.close();
    },
    [],
  );

  const stopDictation = () => {
    dictation.current?.close();
    dictation.current = null;
    setDictating('off');
  };

  /** Speech → text in the box, added to what is already there. */
  const dictate = async () => {
    if (!voiceAllowed) return onNeedSignIn();
    if (dictation.current) {
      if (dictating === 'listening') dictation.current.stopListening();
      else stopDictation();
      return;
    }
    audioContext();
    const conversation = new VoiceConversation({
      synthesize: async () => null,
      transcribe: async (audio, mime) => {
        const res = await sendMessage('voice/transcribe', { audio: await blobToBase64(audio), mime, hint, purpose }).catch(() => null);
        if (res && !res.ok) onError?.(res.error);
        return res?.ok ? res.text : null;
      },
      onState: (s) => setDictating(s === 'listening' ? 'listening' : s === 'hearing' || s === 'thinking' ? 'hearing' : dictation.current ? 'hearing' : 'off'),
      onLevel: () => undefined,
      onHeard: (text) => {
        const before = valueRef.current.trim();
        onChange(before ? `${before} ${text}` : text);
        stopDictation();
        window.setTimeout(() => ref.current?.focus(), 0);
      },
      onMissed: stopDictation,
    });
    try {
      await conversation.start();
    } catch (err) {
      onError?.(err instanceof MicrophoneBlockedError ? 'The microphone is blocked for YouTube. Allow it from the icon at the left of the address bar.' : 'Your browser won’t let FocusSpace listen right now.');
      return;
    }
    dictation.current = conversation;
    conversation.listen();
  };

  const hasText = !!value.trim();
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    // Enter sends, Shift+Enter breaks the line; never mid-composition (Hindi and other IMEs use Enter to commit).
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (hasText && !disabled) onSend();
  };
  const common = {
    value,
    placeholder: dictating === 'listening' ? 'Listening… tap the mic when you’re done' : dictating === 'hearing' ? 'Writing down what you said…' : placeholder,
    'aria-label': label,
    maxLength,
    disabled,
    onKeyDown,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };

  return (
    <form
      className={`${className} fs-focus-host${dictating !== 'off' ? ' is-dictating' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (hasText && !disabled) onSend();
      }}
    >
      {multiline ? <textarea ref={ref as RefObject<HTMLTextAreaElement>} rows={1} {...common} /> : <input ref={ref as RefObject<HTMLInputElement>} {...common} />}
      <button
        type="button"
        className={`fs-cmp-mic${dictating !== 'off' ? ' is-on' : ''}`}
        onClick={() => void dictate()}
        disabled={disabled || dictating === 'hearing'}
        aria-label={dictating === 'listening' ? 'Stop dictating' : 'Dictate'}
        title={voiceAllowed ? (dictating === 'listening' ? 'Done' : 'Dictate: speak and it types') : 'Sign in to use voice'}
      >
        {dictating === 'listening' ? <Square size={12} aria-hidden /> : <Mic size={17} aria-hidden />}
      </button>
      {hasText ? (
        <button type="submit" className="fs-cmp-go" aria-label="Send" title="Send" disabled={disabled}>
          <ArrowUp size={17} aria-hidden />
        </button>
      ) : (
        <button type="button" className="fs-cmp-go" aria-label="Talk" title={voiceAllowed ? 'Talk hands-free' : 'Sign in to talk'} disabled={disabled} onClick={() => (voiceAllowed ? onTalk() : onNeedSignIn())}>
          <AudioLines size={17} aria-hidden />
        </button>
      )}
    </form>
  );
}
