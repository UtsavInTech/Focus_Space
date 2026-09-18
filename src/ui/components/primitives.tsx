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

export function SettingRow({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="fs-setting">
      <div className="fs-setting-text">
        <span className="fs-label">{title}</span>
        {description && <span className="fs-hint">{description}</span>}
      </div>
      <div className="fs-setting-control">{children}</div>
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

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="fs-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B7DFF" />
          <stop offset="1" stopColor="#5B47F0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#fs-logo-g)" />
      <circle cx="16" cy="16" r="8.2" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2.2" />
      <path d="M16 7.8a8.2 8.2 0 0 1 8.2 8.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.2" fill="#fff" />
    </svg>
  );
}

export function Logo({ size = 26, word = true }: { size?: number; word?: boolean }) {
  return (
    <span className="fs-logo">
      <LogoMark size={size} />
      {word && <span>FocusSpace</span>}
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
