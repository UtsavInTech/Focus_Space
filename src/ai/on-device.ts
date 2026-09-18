/**
 * Chrome's built-in on-device model (Prompt API, stable for extensions since
 * Chrome 138). No key, no network, nothing leaves the browser. Available from
 * extension pages and the service worker; the one-time model download must be
 * started by a user action on an extension page.
 */

export interface LanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

export interface LanguageModelStatic {
  availability(options?: unknown): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create(options?: Record<string, unknown>): Promise<LanguageModelSession>;
}

export const LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

export const languageModel = (): LanguageModelStatic | null => (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel ?? null;

/** Starts (or joins) the model download. Call from a click on an extension page. */
export async function downloadOnDeviceModel(onProgress: (fraction: number) => void): Promise<void> {
  const lm = languageModel();
  if (!lm) throw new Error('On-device AI is not available in this browser.');
  const session = await lm.create({
    ...LANGUAGE_OPTIONS,
    monitor(monitor: DownloadMonitor) {
      monitor.addEventListener('downloadprogress', (event) => onProgress(event.loaded));
    },
  });
  session.destroy();
}
