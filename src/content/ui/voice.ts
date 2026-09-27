import { VOICE_MAX_SECONDS } from '@/types/setup';

/**
 * A spoken conversation with FocusSpace — the setup guide and FocusSpace AI both use this.
 *
 * What makes it feel like talking rather than taking turns with a form:
 *  - The microphone opens once for the whole conversation, so there is no start-up gap each turn.
 *  - It knows you've finished by the pause, not a button (END_SILENCE_MS), and ignores coughs.
 *  - Replies are spoken sentence by sentence as soon as each one is ready, not after the whole answer.
 *  - You can talk over it: speaking while it speaks stops it and it listens (barge-in).
 *
 * Playback goes through Web Audio rather than an <audio> element, so one loop can report a 0–1
 * loudness — yours while it listens, its own while it speaks — for the orb, and YouTube's page policies
 * on media sources never come into it.
 */

export type VoiceState = 'idle' | 'listening' | 'hearing' | 'thinking' | 'speaking';

/** Loudness (RMS of the waveform) that counts as speech rather than room noise. */
const SPEECH_LEVEL = 0.045;
/** Louder than its own voice leaking back through echo cancellation: you, talking over it. */
const BARGE_LEVEL = 0.09;
const BARGE_MS = 220;
/** Quiet after speech that means "I'm done" — short enough to feel like conversation. */
const END_SILENCE_MS = 850;
/** Nothing said at all in this long: stop, rather than record the room. */
const NO_SPEECH_MS = 9000;
/** A cough or a door is a spike; words last. Less loud time than this is not sent to be transcribed. */
const MIN_SPEECH_MS = 280;

let context: AudioContext | null = null;
/** One AudioContext for the page, created on the click that first turns voice on (autoplay rules). */
export function audioContext(): AudioContext {
  if (!context || context.state === 'closed') context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function rms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += v * v;
  return Math.sqrt(sum / buffer.length);
}

export class MicrophoneBlockedError extends Error {}

/**
 * Text as it should be heard: no markdown, no links, no symbols read out. Long answers are split into
 * sentence-sized pieces so the first one can be playing while the rest are still being made.
 */
export function speechChunks(text: string, max = 240): string[] {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*(#{1,6}|[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return [];
  const sentences = plain.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) ?? [plain];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const last = out[out.length - 1];
    // The first piece stays short so it starts quickly; later ones are grouped to fewer requests.
    if (last && out.length > 1 && last.length + s.length + 1 <= max) out[out.length - 1] = `${last} ${s}`;
    else out.push(s.length > max ? s.slice(0, max) : s);
  }
  return out;
}

export interface VoiceConversationOptions {
  /** Speech → text (the FocusSpace server). null or '' when it heard nothing. */
  transcribe: (audio: Blob, mime: string) => Promise<string | null>;
  /** Text → base64 audio in FocusSpace's natural voice. null when it couldn't. */
  synthesize: (text: string) => Promise<string | null>;
  onState: (state: VoiceState) => void;
  /** 0–1, many times a second. */
  onLevel: (level: number) => void;
  /** What they said — the caller answers it (and calls `say`, then `listenAfterSpeaking`). */
  onHeard: (text: string) => void;
  /** Nothing intelligible came back from a recording. */
  onMissed?: () => void;
}

export class VoiceConversation {
  private stream: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private playAnalyser: AnalyserNode | null = null;
  private readonly buffer = new Float32Array(1024);
  private frame = 0;
  private state: VoiceState = 'idle';
  private closed = false;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private keep = true;
  private listenStarted = 0;
  private loudMs = 0;
  private lastLoud = 0;
  private lastTick = 0;
  private bargeMs = 0;

  private playing: AudioBufferSourceNode | null = null;
  /** Bumped by every interruption; queued speech from an older generation is dropped. */
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: VoiceConversationOptions) {}

  /** Opens the microphone. Throws MicrophoneBlockedError when the browser or YouTube won't allow it. */
  async start(): Promise<void> {
    const ctx = audioContext();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      throw new MicrophoneBlockedError('Microphone blocked');
    }
    const source = ctx.createMediaStreamSource(this.stream);
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 1024;
    source.connect(this.micAnalyser);
    this.lastTick = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  get current(): VoiceState {
    return this.state;
  }

  private set(state: VoiceState) {
    if (this.state === state) return;
    this.state = state;
    this.options.onState(state);
  }

  /** The caller is working out an answer. */
  thinking(): void {
    if (this.state !== 'speaking' && this.state !== 'listening') this.set('thinking');
  }

  /** Back to waiting for a tap. */
  idle(): void {
    if (this.state !== 'speaking' && this.state !== 'listening') this.set('idle');
  }

  /* ── Listening ─────────────────────────────────────────────────────────── */

  listen(): void {
    if (this.closed || !this.stream || this.recorder) return;
    this.interrupt();
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    // A fixed bitrate: the server works out how long you spoke from the size (server/usage/voice.ts).
    const recorder = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    this.recorder = recorder;
    this.chunks = [];
    this.keep = true;
    this.listenStarted = performance.now();
    this.loudMs = 0;
    this.lastLoud = this.listenStarted;
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    recorder.onstop = () => void this.finished(recorder);
    recorder.start(200);
    this.set('listening');
  }

  /** Finish now and keep what was said (the orb tapped while listening). */
  stopListening(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  private async finished(recorder: MediaRecorder) {
    const heard = this.keep && this.loudMs >= MIN_SPEECH_MS && this.chunks.length > 0;
    const type = recorder.mimeType || 'audio/webm';
    const audio = new Blob(this.chunks, { type });
    this.recorder = null;
    if (this.closed) return;
    if (!heard) {
      this.set('idle');
      if (this.keep) this.options.onMissed?.();
      return;
    }
    this.set('hearing');
    const text = await this.options.transcribe(audio, type).catch(() => null);
    if (this.closed) return;
    if (!text?.trim()) {
      this.set('idle');
      this.options.onMissed?.();
      return;
    }
    this.set('thinking');
    this.options.onHeard(text.trim());
  }

  /* ── Speaking ──────────────────────────────────────────────────────────── */

  /** Speaks after anything already queued. Each piece's audio is requested now, so it's ready in time. */
  say(text: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    const generation = this.generation;
    const pieces = speechChunks(text).map((piece) => this.options.synthesize(piece).catch(() => null));
    this.queue = this.queue.then(async () => {
      for (const piece of pieces) {
        if (this.closed || generation !== this.generation) return;
        const audio = await piece;
        if (!audio || this.closed || generation !== this.generation) continue;
        await this.play(audio).catch(() => undefined);
      }
    });
    return this.queue;
  }

  /** Plays audio that was made earlier (a short "Okay…" while it thinks), after anything queued. */
  sayPrepared(audio: string | null): void {
    if (!audio || this.closed) return;
    const generation = this.generation;
    this.queue = this.queue.then(async () => {
      if (!this.closed && generation === this.generation) await this.play(audio).catch(() => undefined);
    });
  }

  /** In a conversation, a question is followed by listening — once everything queued has been said. */
  listenAfterSpeaking(): void {
    const generation = this.generation;
    void this.queue.then(() => {
      if (!this.closed && generation === this.generation && !this.recorder) this.listen();
    });
  }

  private async play(base64: string): Promise<void> {
    const ctx = audioContext();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const decoded = await ctx.decodeAudioData(bytes.buffer);
    const node = ctx.createBufferSource();
    node.buffer = decoded;
    this.playAnalyser = ctx.createAnalyser();
    this.playAnalyser.fftSize = 1024;
    node.connect(this.playAnalyser);
    this.playAnalyser.connect(ctx.destination);
    this.playing = node;
    this.bargeMs = 0;
    this.set('speaking');
    await new Promise<void>((resolve) => {
      node.onended = () => {
        if (this.playing === node) {
          this.playing = null;
          this.playAnalyser = null;
          if (this.state === 'speaking') this.set('idle');
        }
        resolve();
      };
      node.start();
    });
  }

  /** Stops speaking and drops everything queued (not the microphone). */
  interrupt(): void {
    this.generation++;
    this.queue = Promise.resolve();
    try {
      this.playing?.stop();
    } catch {
      // already ended
    }
    this.playing = null;
    this.playAnalyser = null;
    if (this.state === 'speaking') this.set('idle');
  }

  /* ── The loop: loudness, end of turn, barge-in ─────────────────────────── */

  private readonly tick = () => {
    if (this.closed) return;
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    const mic = this.micAnalyser ? rms(this.micAnalyser, this.buffer) : 0;

    if (this.playAnalyser) {
      this.options.onLevel(Math.min(1, rms(this.playAnalyser, this.buffer) * 5));
      // They started talking over it: stop and listen — the way people interrupt each other.
      this.bargeMs = mic > BARGE_LEVEL ? this.bargeMs + dt : 0;
      if (this.bargeMs >= BARGE_MS) this.listen();
    } else if (this.recorder) {
      this.options.onLevel(Math.min(1, mic * 8));
      if (mic > SPEECH_LEVEL) {
        this.loudMs += dt;
        this.lastLoud = now;
      }
      const heard = this.loudMs >= MIN_SPEECH_MS;
      if ((heard && now - this.lastLoud > END_SILENCE_MS) || (!heard && now - this.listenStarted > NO_SPEECH_MS) || now - this.listenStarted > VOICE_MAX_SECONDS * 1000) this.stopListening();
    } else {
      this.options.onLevel(0);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Ends the conversation: microphone off, nothing more said. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.frame);
    this.interrupt();
    if (this.recorder?.state === 'recording') {
      this.keep = false;
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.options.onLevel(0);
    this.state = 'idle';
  }
}

/**
 * One-off speech outside a conversation — the speaker button under an answer. Same natural voice;
 * calling it again (or `stopSpeech`) stops what is playing.
 */
let solo: VoiceConversation | null = null;
export function speakOnce(text: string, synthesize: (text: string) => Promise<string | null>, onState?: (speaking: boolean) => void): void {
  stopSpeech();
  const conversation = new VoiceConversation({ transcribe: async () => null, synthesize, onState: (s) => onState?.(s === 'speaking'), onLevel: () => undefined, onHeard: () => undefined });
  solo = conversation;
  audioContext();
  void conversation.say(text).then(() => {
    if (solo === conversation) {
      onState?.(false);
      solo = null;
    }
  });
}

export function stopSpeech(): void {
  solo?.close();
  solo = null;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Little acknowledgements a person makes while thinking. Made once when a conversation starts and
 * played the moment someone stops talking, so there is no dead air while the answer is worked out.
 */
export const FILLERS = ['Okay…', 'Hmm, okay.', 'Alright, one sec.', 'Got it.'];

/** Made once per page and reused by every conversation after — they never change, so never pay twice. */
const fillerCache: string[] = [];
let fillersRequested = false;

export function prepareFillers(synthesize: (text: string) => Promise<string | null>): () => string | null {
  if (!fillersRequested) {
    fillersRequested = true;
    for (const text of FILLERS) void synthesize(text).then((audio) => audio && fillerCache.push(audio)).catch(() => undefined);
  }
  let i = Math.floor(Math.random() * FILLERS.length);
  return () => (fillerCache.length ? fillerCache[i++ % fillerCache.length] : null);
}

