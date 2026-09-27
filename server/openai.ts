import type { AiPrompt } from '@/learning/ai/actions';
import { ApiError } from './http';

/**
 * The only place in this server that talks to OpenAI — same upstream
 * call as scripts/ai-endpoint/server.mjs, moved behind the FocusSpace API so
 * the key lives in exactly one process's environment and is never part of
 * any response, log line, or the extension bundle.
 */

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export function loadOpenAIConfig(env: NodeJS.ProcessEnv = process.env): OpenAIConfig {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Set OPENAI_API_KEY (it stays on this server, never in the extension or in responses).');
  return {
    apiKey,
    model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
    maxTokens: Number(env.MAX_TOKENS ?? 700),
  };
}

interface OpenAIChoice {
  message?: { content?: string };
}
interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}
interface OpenAIResponse {
  choices?: OpenAIChoice[];
  error?: { message?: string };
  usage?: OpenAIUsage;
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface OpenAIResult {
  answer: string;
  /** Only when OpenAI's response includes it (it usually does) — never a second call, never estimated. See docs/LAYER_2C_USAGE_ENTITLEMENTS.md. */
  usage: TokenUsage | null;
}

/** Never logs `prompt` or the key — only the caller decides what to log, and this function gives it nothing sensitive to log by accident. */
export async function callOpenAI(prompt: AiPrompt, config: OpenAIConfig, signal?: AbortSignal): Promise<OpenAIResult> {
  let upstream: Response;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal,
    });
  } catch (err) {
    throw new ApiError(502, 'upstream_error', `Could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`);
  }

  const json = (await upstream.json().catch(() => null)) as OpenAIResponse | null;
  if (!upstream.ok) throw new ApiError(502, 'upstream_error', json?.error?.message ?? `OpenAI returned HTTP ${upstream.status}.`);

  const answer = (json?.choices ?? [])
    .map((c) => c?.message?.content ?? '')
    .join('\n')
    .trim();
  if (!answer) throw new ApiError(502, 'upstream_error', 'OpenAI returned an empty answer.');
  const usage = json?.usage ? { promptTokens: json.usage.prompt_tokens ?? null, completionTokens: json.usage.completion_tokens ?? null } : null;
  return { answer, usage };
}

/**
 * A chat completion that must come back as one JSON object (OpenAI's JSON mode). For structured
 * understanding — "which Spaces did they ask for" — where free text would have to be parsed by guesswork.
 * Returns the parsed object; the caller validates its shape, since JSON mode guarantees syntax, not schema.
 */
export async function callOpenAIJson(prompt: AiPrompt, config: OpenAIConfig, signal?: AbortSignal): Promise<{ data: unknown; usage: TokenUsage | null }> {
  let upstream: Response;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        // Understanding, not writing: the same sentence should give the same actions every time.
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal,
    });
  } catch (err) {
    throw new ApiError(502, 'upstream_error', `Could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`);
  }
  const json = (await upstream.json().catch(() => null)) as OpenAIResponse | null;
  if (!upstream.ok) throw new ApiError(502, 'upstream_error', json?.error?.message ?? `OpenAI returned HTTP ${upstream.status}.`);
  const text = json?.choices?.[0]?.message?.content ?? '';
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(502, 'upstream_error', 'OpenAI returned an answer that was not JSON.');
  }
  const usage = json?.usage ? { promptTokens: json.usage.prompt_tokens ?? null, completionTokens: json.usage.completion_tokens ?? null } : null;
  return { data, usage };
}

/* ─── Voice ──────────────────────────────────────────────────────────────── */

export interface VoiceConfig {
  transcribeModel: string;
  speechModel: string;
  voice: string;
  /** How the voice should sound — gpt-4o-mini-tts follows plain-language direction on tone and accent. */
  style: string;
}

export function loadVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  return {
    transcribeModel: env.VOICE_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe',
    speechModel: env.VOICE_SPEECH_MODEL ?? 'gpt-4o-mini-tts',
    voice: env.VOICE_NAME ?? 'marin',
    style:
      env.VOICE_STYLE ??
      [
        'Sound like a real, warm person having a relaxed chat with a friend — never a robot, never an announcer.',
        'A light, friendly Indian English accent.',
        'Natural pitch that rises and falls with meaning; lively intonation; a little smile in the voice.',
        'Conversational pace — quicker on easy words, a touch slower on names — with short natural pauses at commas and after "okay" or "hmm".',
        'Casual acknowledgements ("okay", "alright", "got it") sound easy and relaxed, not read.',
      ].join(' '),
  };
}

/** Speech → text. `audio` is the recording's raw bytes (webm/opus from the browser's MediaRecorder). */
export async function transcribe(audio: Buffer, mime: string, apiKey: string, voice: VoiceConfig, prompt?: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  // OpenAI goes by the file name's extension, so it must match the bytes.
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'mp4' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('wav') ? 'wav' : 'webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append('model', voice.transcribeModel);
  // Names and words to expect: the model spells "Telusko" rather than hearing "telescope".
  if (prompt) form.append('prompt', prompt);
  let upstream: Response;
  try {
    upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal });
  } catch (err) {
    throw new ApiError(502, 'upstream_error', `Could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`);
  }
  const json = (await upstream.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
  if (!upstream.ok) throw new ApiError(502, 'upstream_error', json?.error?.message ?? `OpenAI returned HTTP ${upstream.status}.`);
  return (json?.text ?? '').trim();
}

/** Text → speech, as MP3 bytes. */
export async function speak(text: string, apiKey: string, voice: VoiceConfig, signal?: AbortSignal): Promise<Buffer> {
  let upstream: Response;
  try {
    upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: voice.speechModel, voice: voice.voice, input: text, instructions: voice.style, response_format: 'mp3' }),
      signal,
    });
  } catch (err) {
    throw new ApiError(502, 'upstream_error', `Could not reach OpenAI: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!upstream.ok) {
    const json = (await upstream.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiError(502, 'upstream_error', json?.error?.message ?? `OpenAI returned HTTP ${upstream.status}.`);
  }
  return Buffer.from(await upstream.arrayBuffer());
}
