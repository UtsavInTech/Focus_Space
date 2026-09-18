import type { InnerTubeConfig } from '@/integrations/youtube/innertube-client';

/**
 * Isolated-world side of the main-world bridge (src/content/bridge/main-world.ts).
 */

export function spaNavigate(url: string): void {
  const target = new URL(url, location.origin);
  if (target.origin !== location.origin) {
    location.assign(target.href);
    return;
  }
  document.dispatchEvent(new CustomEvent('focusspace:navigate', { detail: JSON.stringify({ url: target.pathname + target.search }) }));
}

let configPromise: Promise<InnerTubeConfig | null> | null = null;

/** The page's client config, as youtube.com itself uses it. Resolves null if unavailable. */
export function getPageConfig(): Promise<InnerTubeConfig | null> {
  configPromise ??= new Promise((resolve) => {
    const timer = window.setTimeout(() => done(null), 12_000);
    function done(value: InnerTubeConfig | null) {
      window.clearTimeout(timer);
      document.removeEventListener('focusspace:config', onConfig);
      if (!value) configPromise = null; // allow a retry later
      resolve(value);
    }
    function onConfig(event: Event) {
      try {
        const raw = JSON.parse(String((event as CustomEvent).detail)) as Record<string, unknown> | null;
        if (!raw || typeof raw.INNERTUBE_CLIENT_VERSION !== 'string') return done(null);
        done({
          clientName: String(raw.INNERTUBE_CLIENT_NAME ?? 'WEB'),
          clientNameId: String(raw.INNERTUBE_CONTEXT_CLIENT_NAME ?? '1'),
          clientVersion: raw.INNERTUBE_CLIENT_VERSION,
          apiKey: typeof raw.INNERTUBE_API_KEY === 'string' ? raw.INNERTUBE_API_KEY : undefined,
          context: raw.INNERTUBE_CONTEXT && typeof raw.INNERTUBE_CONTEXT === 'object' ? (raw.INNERTUBE_CONTEXT as Record<string, unknown>) : undefined,
          sessionIndex: raw.SESSION_INDEX !== undefined ? String(raw.SESSION_INDEX) : undefined,
          delegatedSessionId: typeof raw.DELEGATED_SESSION_ID === 'string' ? raw.DELEGATED_SESSION_ID : undefined,
          loggedIn: raw.LOGGED_IN === true,
        });
      } catch {
        done(null);
      }
    }
    document.addEventListener('focusspace:config', onConfig);
    document.dispatchEvent(new CustomEvent('focusspace:config-request'));
  });
  return configPromise;
}
