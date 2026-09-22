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
