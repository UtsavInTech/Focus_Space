import { useEffect, useState, type MouseEvent } from 'react';

/**
 * A minimal history router — the site is two pages ("/" and "/pricing") plus
 * in-page anchors, which is not worth a routing dependency. Real paths rather
 * than hashes, because these pages are meant to be indexed and linked; the
 * host serves index.html for unknown paths (web/public/_redirects).
 */

export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onChange = () => setPath(location.pathname);
    window.addEventListener('popstate', onChange);
    window.addEventListener('fs:navigate', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('fs:navigate', onChange);
    };
  }, []);
  return path;
}

/**
 * `to` may be a path ("/pricing"), an in-page anchor ("#faq"), or both
 * ("/#features") — the last form is what a link in the nav needs when the
 * visitor is currently on another page.
 */
export function navigate(to: string): void {
  const [path, hash] = to.split('#');
  const target = path || location.pathname;

  if (target !== location.pathname) {
    history.pushState(null, '', target + (hash ? `#${hash}` : ''));
    window.dispatchEvent(new Event('fs:navigate'));
    // A new page starts at the top unless the link asked for a section.
    if (!hash) window.scrollTo({ top: 0 });
  }

  if (hash) {
    // The section may have only just mounted after the path change above.
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

/** Click handler for internal links that keeps middle-click and ⌘-click native. */
export function onLinkClick(to: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
}
