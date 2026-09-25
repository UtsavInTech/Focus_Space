import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
export { cx };

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('fs-btn', `fs-btn-${variant}`, size !== 'md' && `fs-btn-${size}`, block && 'fs-btn-block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="fs-spinner" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export function IconButton({ label, icon, size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <button type="button" className={cx('fs-icon-btn', size === 'sm' && 'fs-icon-btn-sm', className)} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="fs-switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Badge({ tone = 'neutral', icon, children, title }: { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className={cx('fs-badge', tone !== 'neutral' && `fs-badge-${tone}`)} title={title}>
      {icon}
      {children}
    </span>
  );
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => <span className="fs-spinner" role="status" aria-label={label} />;

export const Skeleton = ({ width = '100%', height = 14, radius }: { width?: number | string; height?: number | string; radius?: number }) => (
  <div className="fs-skeleton" style={{ width, height, borderRadius: radius }} aria-hidden />
);

export function ProgressBar({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'success' | 'warning'; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx('fs-progress', tone !== 'accent' && `fs-progress-${tone}`)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: SegmentOption<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="fs-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="fs-field">
      <label className="fs-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="fs-hint">{hint}</div>}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { small?: boolean }>(function TextInput({ className, small, ...rest }, ref) {
  return <input ref={ref} className={cx('fs-input', small && 'fs-input-sm', className)} {...rest} />;
});

/** `children` is the control. A row with none is a statement of fact, which some settings genuinely are. */
export function SettingRow({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="fs-setting">
      <div className="fs-setting-text">
        <span className="fs-label">{title}</span>
        {description && <span className="fs-hint">{description}</span>}
      </div>
      {children !== undefined && <div className="fs-setting-control">{children}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="fs-empty fs-animate-in">
      <div className="fs-empty-icon">{icon}</div>
      <h3 className="fs-h3">{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="fs-row-wrap">{actions}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', icon, children, action }: { tone?: 'info' | 'danger' | 'warning'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`fs-alert fs-alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon}
      <div className="fs-grow">{children}</div>
      {action}
    </div>
  );
}

export function SectionHeader({ title, subtitle, action, eyebrow }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="fs-section-head">
      <div>
        {eyebrow && <div className="fs-eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>}
        <h2 className="fs-h2">{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The FocusSpace mark: a target — outer ring, crosshair ticks, inner ring — with a play triangle at its
 * centre. Aim at one thing, then watch it. That is the product in one glyph, and it is why this replaced
 * the boxed gradient tile: a filled violet square said nothing, and read as a third-party badge stuck
 * onto whatever page it sat on.
 *
 * Colour is deliberately not fixed here. `tone="brand"` paints it FocusSpace red (`--fs-brand`) — the
 * default, and what the logo means. `tone="current"` inherits `currentColor`, for the places that need
 * it monochrome: white on a dark or coloured surface, grey when something is switched off. One
 * component either way, so the shape can never drift between them.
 *
 * `active` turns the outer ring and ticks slowly (see `.fs-mark` in ui/styles.css). `ring={false}`
 * leaves the play triangle alone, for sizes too small for a target to survive.
 */
export function FocusMark({
  size = 20,
  active = false,
  ring = true,
  tone = 'brand',
}: {
  size?: number;
  active?: boolean;
  ring?: boolean;
  /** 'brand' = FocusSpace red; 'current' = inherit currentColor. */
  tone?: 'brand' | 'current';
}) {
  return (
    <svg
      className={`fs-mark${active ? ' is-active' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      style={{ color: tone === 'brand' ? 'var(--fs-brand)' : undefined }}
      aria-hidden
      focusable="false"
    >
      {ring && (
        <g className="fs-mark-ring">
          <circle cx="16" cy="16" r="12.6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
          {/* The four crosshair ticks, crossing the outer ring at the compass points. */}
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.75">
            <path d="M16 2v6" />
            <path d="M16 24v6" />
            <path d="M2 16h6" />
            <path d="M24 16h6" />
          </g>
        </g>
      )}
      {ring && <circle cx="16" cy="16" r="8.4" stroke="currentColor" strokeWidth="1.7" />}
      {/* Optically centred: a triangle's visual centre sits left of its bounding box, hence the nudge. */}
      <path d="M13.2 11.5v9a.85.85 0 0 0 1.31.72l6.9-4.5a.85.85 0 0 0 0-1.44l-6.9-4.5a.85.85 0 0 0-1.31.72Z" fill="currentColor" transform="translate(-0.9 0)" />
    </svg>
  );
}

/**
 * "FocusSpace", set the way the brand sets it: "Focus" in the surface's own text colour and "Space" in
 * FocusSpace red. Two spans rather than an image, so it takes the page's font, scales with it, and is
 * still selectable, searchable and read aloud as one word.
 *
 * The split is the point. Rendering the name as one evenly-coloured string is what every surface was
 * doing, and it threw away half the mark.
 */
export function Wordmark({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="fs-wordmark">
      <span className="fs-wordmark-name">
        Focus<span className="fs-wordmark-accent">Space</span>
      </span>
      {tagline && <span className="fs-wordmark-tagline">Intent-driven learning for YouTube</span>}
    </span>
  );
}

/** The lockup: mark plus wordmark. `word={false}` is the mark on its own. */
export function Logo({ size = 26, word = true, tagline = false }: { size?: number; word?: boolean; tagline?: boolean }) {
  return (
    <span className="fs-logo">
      <FocusMark size={size} />
      {word && <Wordmark tagline={tagline} />}
    </span>
  );
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
