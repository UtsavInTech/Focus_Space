import { useState, type ReactNode } from 'react';
import { onLinkClick } from '../router';
import { useExtension } from '../extension';
import { hasStoreListing, installHref, onPhoneOrTablet, sendLinkToComputer } from '../install';

/**
 * On a phone or tablet the store cannot install anything, so the install button sends the link to a
 * computer instead — the phone's share sheet, or a copied link — and says what happened.
 */
export function SendLinkButton({ className, label }: { className: string; label: string }) {
  const [note, setNote] = useState<string | null>(null);
  const send = async () => {
    const result = await sendLinkToComputer();
    if (result === 'failed') return;
    setNote(result === 'copied' ? 'Link copied — open it on your computer' : 'Sent — open it on your computer');
    window.setTimeout(() => setNote(null), 3500);
  };
  return (
    <button type="button" className={className} onClick={() => void send()} aria-live="polite">
      {note ?? label}
    </button>
  );
}

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

  if (onPhoneOrTablet()) {
    return (
      <>
        <SendLinkButton className={cls} label={size === 'lg' ? 'Send the link to my computer' : 'Send link'} />
        {forVisitors}
        {size === 'lg' && <p className="fsw-install-note">FocusSpace is a Chrome extension for your computer.</p>}
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
