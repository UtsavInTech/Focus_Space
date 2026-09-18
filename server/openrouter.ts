import type { AiPrompt } from '@/learning/ai/actions';
import { ApiError } from './http';

/**
 * The only place in this server that talks to OpenRouter — same upstream
 * call as scripts/ai-endpoint/server.mjs, moved behind the FocusSpace API so
 * the key lives in exactly one process's environment and is never part of
 * any response, log line, or the extension bundle.
 */

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export function loadOpenRouterConfig(env: NodeJS.ProcessEnv = process.env): OpenRouterConfig {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY (it stays on this server, never in the extension or in responses).');
  return {
    apiKey,
    model: env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
    maxTokens: Number(env.MAX_TOKENS ?? 700),
  };
}

interface OpenRouterChoice {
  message?: { content?: string };
}
interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}
interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string };
  usage?: OpenRouterUsage;
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface OpenRouterResult {
  answer: string;
  /** Only when OpenRouter's response includes it (it usually does) — never a second call, never estimated. See docs/LAYER_2C_USAGE_ENTITLEMENTS.md. */
  usage: TokenUsage | null;
}

/** Never logs `prompt` or the key — only the caller decides what to log, and this function gives it nothing sensitive to log by accident. */
export async function callOpenRouter(prompt: AiPrompt, config: OpenRouterConfig, signal?: AbortSignal): Promise<OpenRouterResult> {
  let upstream: Response;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
    throw new ApiError(502, 'upstream_error', `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`);
  }

  const json = (await upstream.json().catch(() => null)) as OpenRouterResponse | null;
  if (!upstream.ok) throw new ApiError(502, 'upstream_error', json?.error?.message ?? `OpenRouter returned HTTP ${upstream.status}.`);

  const answer = (json?.choices ?? [])
    .map((c) => c?.message?.content ?? '')
    .join('\n')
    .trim();
  if (!answer) throw new ApiError(502, 'upstream_error', 'OpenRouter returned an empty answer.');
  const usage = json?.usage ? { promptTokens: json.usage.prompt_tokens ?? null, completionTokens: json.usage.completion_tokens ?? null } : null;
  return { answer, usage };
}
