import type { ReactNode } from 'react';
import { onLinkClick } from '../router';
import { useExtension } from '../extension';
import { hasStoreListing, installHref } from '../install';

/**
 * The site's main call to action, aware of whether FocusSpace is already here. A visitor without the
 * extension is asked to add it; someone who has it gets a way into it instead of an install button
 * for something they already installed.
 */
export function InstallCta({ size = 'md', label = 'Add to Chrome — Free', withYouTube = false, forVisitors }: { size?: 'md' | 'lg'; label?: string; withYouTube?: boolean; /** Shown next to the install button only for visitors without the extension. */ forVisitors?: ReactNode }) {
  const ext = useExtension();
  const cls = `fsw-btn fsw-btn-primary${size === 'lg' ? ' fsw-btn-lg' : ''}`;

  // Installed: FocusSpace lives on YouTube, so that is the way in. The second button opens its own Home
  // (Library, history, account) for the times the learner wants what they saved rather than a video.
  if (ext.status === 'connected') {
    return (
      <>
        <a className={cls} href="https://www.youtube.com/" target="_blank" rel="noreferrer">
          Open YouTube
        </a>
        {withYouTube && (
          <button type="button" className={`fsw-btn fsw-btn-ghost${size === 'lg' ? ' fsw-btn-lg' : ''}`} onClick={() => void ext.openHome().catch(() => undefined)}>
            Open FocusSpace
          </button>
        )}
      </>
    );
  }

  const href = installHref();
  return (
    <>
      {hasStoreListing() ? (
        <a className={cls} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        <a className={cls} href={href} onClick={onLinkClick(href)}>
          {label}
        </a>
      )}
      {forVisitors}
    </>
  );
}
