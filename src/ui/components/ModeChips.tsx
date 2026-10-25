import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import { SpaceIcon } from '../icons';

const KIND_LABEL = { learning: 'Learning', media: 'Music & video', general: 'General', institute:'Institute' } as const;

export function ModePicker({ modes, value, onChange, placeholder = 'Choose a space' }: { modes: LearningMode[]; value: string | null; onChange: (mode: LearningMode) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const current = modes.find((m) => m.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    setCursor(Math.max(0, modes.findIndex((m) => m.id === value)));
    const onDown = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, modes, value]);

  const choose = (mode: LearningMode) => {
    onChange(mode);
    setOpen(false);
  };

  return (
    <div
      className="fs-dropdown"
      ref={ref}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === 'Escape') setOpen(false);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setCursor((c) => (c + 1) % modes.length);
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setCursor((c) => (c - 1 + modes.length) % modes.length);
        }
        if (e.key === 'Enter' && modes[cursor]) {
          e.preventDefault();
          choose(modes[cursor]);
        }
      }}
    >
      <button type="button" className="fs-dropdown-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="fs-dropdown-icon">
          <SpaceIcon name={current?.icon ?? 'sparkles'} size={18} />
        </span>
        <span className="fs-grow">
          <span className="fs-h3 fs-truncate" style={{ display: 'block' }}>
            {current?.name ?? placeholder}
          </span>
          {current && (
            <span className="fs-caption fs-truncate" style={{ display: 'block' }}>
              {KIND_LABEL[current.kind]} · {current.topics.length} topics
            </span>
          )}
        </span>
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="fs-dropdown-menu" role="listbox" aria-label="Spaces">
          {modes.map((mode, i) => (
            <button key={mode.id} type="button" role="option" aria-selected={mode.id === value} className="fs-dropdown-item" data-active={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => choose(mode)}>
              <SpaceIcon name={mode.icon} size={17} />
              <span className="fs-truncate">{mode.name}</span>
              {mode.id === value && <Check aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
