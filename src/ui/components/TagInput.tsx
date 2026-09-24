import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { parseList } from '@/learning/text';
import { cx } from './primitives';

export function TagInput({ values, onChange, placeholder, tone, label }: { values: string[]; onChange: (values: string[]) => void; placeholder?: string; tone?: 'danger'; label: string }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (text: string) => {
    const additions = parseList(text).filter((v) => !values.some((x) => x.toLowerCase() === v.toLowerCase()));
    if (additions.length) onChange([...values, ...additions]);
    setDraft('');
  };

  return (
    <div className={cx('fs-tags', 'fs-focus-host', tone === 'danger' && 'fs-tags-danger')} onClick={() => inputRef.current?.focus()}>
      {values.map((v) => (
        <span className="fs-tag" key={v}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            <X />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        aria-label={label}
        placeholder={values.length ? '' : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,\n]/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            commit(draft + text);
          }
        }}
      />
    </div>
  );
}
