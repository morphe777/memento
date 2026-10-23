// Shared components (dossier de dev §11), values copied from the validated mockups.
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { fmtMin } from '../lib/format.ts';
import { useDomainLookup } from '../lib/hooks.ts';

export function DomainDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="dot" style={{ background: color, width: size, height: size }} aria-hidden />;
}

/** Task check box: domain colour border, filled when done (G-08: colour on dot and box only). */
export function TaskCheck({
  done,
  color,
  onToggle,
  disabled,
  label,
}: {
  done: boolean;
  color: string;
  onToggle?: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={done ? `Marquer « ${label} » comme à faire` : `Marquer « ${label} » comme fait`}
      aria-pressed={done}
      onClick={onToggle}
      disabled={disabled}
      className="relative flex-none p-0 grid place-items-center cursor-pointer"
      style={{
        width: 26,
        height: 26,
        marginTop: 1,
        borderRadius: 7,
        border: `2px solid ${color}`,
        background: done ? color : 'var(--surface)',
        color: '#fff',
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {/* enlarge the touch target to 44 px without changing the visual */}
      <span className="absolute -inset-[9px]" aria-hidden />
      {done ? '✓' : ''}
    </button>
  );
}

export const ExperienceBadge = () => <span className="badge-experience">Expérience</span>;
export const BonusBadge = () => <span className="badge-bonus">Bonus</span>;
export const Duration = ({ min, small }: { min: number | null; small?: boolean }) => (
  <span className="chip-duration flex-none" style={small ? { fontSize: 12, padding: '3px 8px' } : undefined}>
    {min === null ? '?' : fmtMin(min)}
  </span>
);

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="h1">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-3 items-stretch">{actions}</div>}
    </div>
  );
}

export function Kpi({
  label,
  children,
  foot,
  minWidth = 150,
}: {
  label: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="card flex flex-col gap-1.5" style={{ borderRadius: 12, padding: '12px 16px', minWidth }}>
      <div className="label-caps">{label}</div>
      <div className="mono" style={{ fontSize: 20 }}>
        {children}
      </div>
      {foot}
    </div>
  );
}

/** Centred delay bar (R-06): centre = on time, left = late (orange), right = ahead (blue); ±4 h = half bar. */
export function DelayBar({
  title,
  color,
  deltaMin,
  to,
  showLegend = true,
}: {
  title: string;
  color: string;
  deltaMin: number;
  to?: { id: string };
  showLegend?: boolean;
}) {
  const a = (Math.min(Math.abs(deltaMin), 240) / 240) * 50;
  const late = deltaMin < 0;
  const onTime = Math.abs(deltaMin) < 15;
  const label = onTime ? "à l'heure" : `${late ? '−' : '+'}${fmtMin(Math.abs(deltaMin))}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DomainDot color={color} />
          {to ? (
            <Link to="/projets/$id" params={{ id: to.id }} className="text-[14px] font-medium truncate">
              {title}
            </Link>
          ) : (
            <span className="text-[14px] font-medium truncate">{title}</span>
          )}
        </div>
        <span
          className="mono text-[13px]"
          style={{ color: onTime ? 'var(--text-muted)' : late ? 'var(--late-text)' : 'var(--ahead-text)' }}
        >
          {label}
        </span>
      </div>
      <div className="relative" style={{ height: 10, background: 'var(--track)', borderRadius: 999 }}>
        {!onTime && (
          <div
            className="absolute top-0"
            style={{
              height: 10,
              left: late ? `${50 - a}%` : '50%',
              width: `${a}%`,
              background: late ? 'var(--late-bar)' : 'var(--ahead-bar)',
              borderRadius: 999,
            }}
          />
        )}
        <div
          className="absolute"
          style={{
            top: -3,
            left: '50%',
            width: 2,
            height: 16,
            background: 'var(--text)',
            transform: 'translateX(-1px)',
          }}
        />
      </div>
      {showLegend && (
        <div className="flex justify-between text-[11px]" style={{ color: 'var(--text-ghost)' }}>
          <span>retard</span>
          <span>avance</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars per domain, in priority order. */
export function DomainBars({
  rows,
  scaleMin,
  labelWidth = 92,
}: {
  rows: { name: string; color: string; minutes: number }[];
  scaleMin?: number;
  labelWidth?: number;
}) {
  const max = scaleMin ?? Math.max(60, ...rows.map((r) => r.minutes));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2.5 text-[13px]">
          <span className="flex-none truncate" style={{ width: labelWidth, color: 'var(--text-2)' }}>
            {r.name}
          </span>
          <div className="flex-1 track" style={{ height: 8 }}>
            <div
              style={{
                height: 8,
                width: `${Math.min(100, Math.round((r.minutes / max) * 100))}%`,
                background: r.color,
                borderRadius: 999,
              }}
            />
          </div>
          <span className="mono text-right flex-none" style={{ width: 56, color: 'var(--text-muted)' }}>
            {r.minutes ? fmtMin(r.minutes) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Domain mix rows from {domainId, minutes}[] (null = Inbox). */
export function useDomainRows(mix: { domainId: string | null; minutes: number }[]) {
  const dl = useDomainLookup();
  return mix
    .filter((m) => m.domainId !== null || m.minutes > 0)
    .map((m) => ({ name: dl.name(m.domainId), color: dl.color(m.domainId), minutes: m.minutes }));
}

export function Section({
  title,
  aside,
  info,
  children,
  className = '',
}: {
  title?: ReactNode;
  aside?: ReactNode;
  info?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card flex flex-col gap-4 ${className}`} style={{ padding: '18px 20px' }}>
      {(title || aside) && (
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          {title && (
            <h2 className="h2 flex items-center gap-2">
              {title}
              {info && <InfoTip>{info}</InfoTip>}
            </h2>
          )}
          {aside && (
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              {aside}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="text-[14px] py-6 text-center" style={{ color: 'var(--text-faint)' }}>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="py-10 text-center text-[14px]" style={{ color: 'var(--text-ghost)' }}>
      Chargement…
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="card p-4 text-[14px]" style={{ color: 'var(--late-text)' }}>
      {(error as Error)?.message ?? 'Erreur'}
    </div>
  );
}

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--late-text)' : 'var(--text-muted)';
  return (
    <span
      className="text-[12px] font-semibold rounded-full px-2.5 py-0.5"
      style={{ background: 'var(--bin)', color }}
    >
      {children}
    </span>
  );
}

// Only the top-most open panel reacts to Escape (a confirmation over an edit drawer).
const panelStack: number[] = [];
let panelSeq = 0;

/**
 * Side drawer (edits, D-40) or centred dialog (confirmations). Clicking outside or on ✕ calls `onClose`
 * (edit drawers save there); Escape calls `onCancel` (discard), which defaults to `onClose`.
 */
export function Panel({
  open,
  onClose,
  onCancel,
  title,
  children,
  side = true,
  width = 720,
  hint,
}: {
  open: boolean;
  onClose: () => void;
  onCancel?: () => void;
  title: ReactNode;
  children: ReactNode;
  side?: boolean;
  width?: number;
  hint?: ReactNode;
}) {
  const cancel = useRef(onCancel ?? onClose);
  cancel.current = onCancel ?? onClose;
  useEffect(() => {
    if (!open) return;
    const id = ++panelSeq;
    panelStack.push(id);
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelStack.at(-1) === id) {
        e.stopPropagation();
        cancel.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      panelStack.splice(panelStack.indexOf(id), 1);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex"
      style={{ justifyContent: side ? 'flex-end' : 'center', alignItems: side ? 'stretch' : 'flex-start' }}
    >
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 border-0 cursor-default"
        style={{ background: 'rgba(20,20,18,0.28)' }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex flex-col overflow-hidden"
        style={{
          width: `min(${width}px, 100vw)`,
          background: 'var(--bg)',
          borderLeft: side ? '1px solid var(--border)' : undefined,
          borderRadius: side ? 0 : 14,
          marginTop: side ? 0 : '8vh',
          maxHeight: side ? '100vh' : '84vh',
          boxShadow: '0 10px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}
        >
          <div className="h2 min-w-0 truncate">{title}</div>
          <span className="flex items-center gap-3 flex-none">
            {hint && (
              <span className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
                {hint}
              </span>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </span>
        </div>
        <div className="overflow-y-auto p-5 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/** Hint shown in the header of drawers that save on close. */
export const SAVE_HINT = 'Enregistré en fermant · Échap pour annuler';

/**
 * Small circled « i » that explains a setting (hover, focus or tap). A span, not a button, so that it is never
 * the control targeted by an enclosing <label>.
 */
export function InfoTip({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label="Aide"
      aria-expanded={open}
      className="info-tip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="5" r="0.95" fill="currentColor" />
        <path d="M8 7.3v4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {open && (
        <span role="tooltip" className={`info-pop ${align === 'right' ? 'align-right' : ''}`}>
          {children}
        </span>
      )}
    </span>
  );
}

/** Confirmation dialog for irreversible actions (deletion). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Supprimer',
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Panel open={open} onClose={onClose} title={title} side={false} width={480}>
      <div className="text-[15px] flex flex-col gap-2">{children}</div>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Panel>
  );
}

export function Field({
  label,
  children,
  hint,
  info,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  info?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="flex items-center gap-1.5">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </span>
      {children}
      {hint && (
        <span className="text-[12px] font-normal" style={{ color: 'var(--text-ghost)' }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg p-1 gap-1" style={{ background: 'var(--bin)' }} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className="border-0 rounded-md px-3 text-[13px] font-medium cursor-pointer"
          style={{
            minHeight: 34,
            background: value === o.value ? 'var(--surface)' : 'transparent',
            color: value === o.value ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: value === o.value ? '0 1px 2px rgba(0,0,0,0.08)' : undefined,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
