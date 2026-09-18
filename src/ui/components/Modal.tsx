import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './primitives';

/**
 * Where overlays render. Extension pages use document.body; inside YouTube the
 * content script provides a container in its fixed overlay shadow root, so
 * modals are never clipped by YouTube's layout containers.
 */
export const OverlayRootContext = createContext<HTMLElement | null>(null);

export function Modal({ open, onClose, title, subtitle, children, footer, width }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const root = useContext(OverlayRootContext);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const first = dialogRef.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  const node = (
    <div className="fs-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className="fs-modal" role="dialog" aria-modal="true" style={width ? { width: `min(${width}px, 100%)` } : undefined} onKeyDown={(e) => e.stopPropagation()}>
        <div className="fs-modal-head">
          <div className="fs-stack-sm" style={{ gap: 4 }}>
            <h2 className="fs-h2">{title}</h2>
            {subtitle && <p className="fs-muted fs-body-sm">{subtitle}</p>}
          </div>
          <IconButton data-close label="Close" icon={<X />} onClick={onClose} />
        </div>
        <div className="fs-modal-body">{children}</div>
        {footer && <div className="fs-modal-foot">{footer}</div>}
      </div>
    </div>
  );
  return createPortal(node, root ?? document.body);
}
