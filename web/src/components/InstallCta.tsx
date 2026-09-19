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

  if (ext.status === 'connected') {
    return (
      <>
        <button type="button" className={cls} onClick={() => void ext.openHome().catch(() => undefined)}>
          Open FocusSpace
        </button>
        {withYouTube && (
          <a className={`fsw-btn fsw-btn-ghost${size === 'lg' ? ' fsw-btn-lg' : ''}`} href="https://www.youtube.com/" target="_blank" rel="noreferrer">
            Open YouTube
          </a>
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
