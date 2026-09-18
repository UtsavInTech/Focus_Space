import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { Power, X } from 'lucide-react';
import { OverlayRootContext } from '@/ui/components/Modal';
import { setFocusEnabled } from '@/modes/service';
import { LogoMark } from '@/ui/components/primitives';

/**
 * What FocusSpace looks like when it is switched off: one small pill in the
 * bottom-left, and nothing else.
 *
 * With Focus Mode off, the home view, the sidebar section and the watch rail
 * are all unmounted — YouTube is exactly YouTube. That is the point, but it
 * also means there is no way back in without opening the extension popup or
 * remembering a keyboard shortcut, which is how a switched-off extension
 * quietly becomes an uninstalled one. The pill is the way back, and it can be
 * dismissed for the session by anyone who genuinely wants a clean page.
 *
 * Bottom-left, deliberately: the bottom-right belongs to the AI bubble, and
 * these two must never stack on top of each other.
 */
export function FocusOffPill() {
  const overlayRoot = useContext(OverlayRootContext);
  const [dismissed, setDismissed] = useState(false);

  if (!overlayRoot || dismissed) return null;

  return createPortal(
    <div className="fs-off-pill">
      <LogoMark size={18} />
      <span className="fs-off-pill-text">FocusSpace is off</span>
      <button type="button" className="fs-off-pill-on" onClick={() => void setFocusEnabled(true)}>
        <Power size={13} aria-hidden /> Turn on
      </button>
      <button type="button" className="fs-off-pill-x" aria-label="Hide until the next page load" onClick={() => setDismissed(true)}>
        <X size={14} aria-hidden />
      </button>
    </div>,
    overlayRoot,
  );
}
