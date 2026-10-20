import { useId } from 'react';

/** A brief architectural entrance that settles; the reading area stays still. */
export function PageAtmosphere() {
  const id = useId().replace(/:/g, '');
  return <div className="fsw-page-atmosphere" aria-hidden="true">
    {['left', 'right'].map(side => <div className={`fsw-page-ribs fsw-page-ribs-${side}`} key={side}>
      {[0, 1, 2].map(index => <svg key={index} viewBox="0 0 100 400" preserveAspectRatio="none" focusable="false">
        <defs><linearGradient id={`${id}-${side}-${index}`}><stop offset="0" stopColor="#c9ccc1" /><stop offset=".45" stopColor="#fffdf1" /><stop offset=".8" stopColor="#e3e5db" /><stop offset="1" stopColor="#a5ad9b" /></linearGradient></defs>
        <path d="M0 0H48V110C48 175 92 185 92 260V400H44V260C44 197 0 172 0 110Z" fill={`url(#${id}-${side}-${index})`} />
      </svg>)}
    </div>)}
  </div>;
}
