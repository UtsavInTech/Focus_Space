import { detectPage, type PageContext } from '@/integrations/youtube/urls';

/**
 * YouTube is an SPA: /watch, /results, /shorts, channels… swap without reloads.
 * We listen to YouTube's own navigation events, the History API, and keep a
 * low-frequency URL check as a safety net if those events ever change.
 */
/** `cause` is the event that revealed the change — 'popstate' means browser back/forward. */
export function watchNavigation(onChange: (ctx: PageContext, cause: string) => void): () => void {
  let lastHref = '';
  const check = (event?: Event) => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    onChange(detectPage(location.href), event?.type ?? 'poll');
  };

  const events: [EventTarget, string][] = [
    [document, 'yt-navigate-start'],
    [document, 'yt-navigate-finish'],
    [document, 'yt-page-data-updated'],
    [window, 'popstate'],
  ];
  events.forEach(([target, name]) => target.addEventListener(name, check));
  const interval = window.setInterval(() => check(), 800);
  check();

  return () => {
    events.forEach(([target, name]) => target.removeEventListener(name, check));
    window.clearInterval(interval);
  };
}
