// Pieces shared by Planifier › Semaine and Planifier › Mois (D-108, D-112): the time banner on top, the boxes
// that fold from their title, and the alerts on three levels.
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { fmtMin } from '../lib/format.ts';
import { useIsPhone } from '../lib/hooks.ts';
import { openTask } from './tasks.tsx';
import { InfoTip, Section } from './ui.tsx';

/** A box that folds from the chevron of its title, remembered on this device (user request 01/11/2026). */
export function useFold(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? '0' : '1');
    } catch {
      // private mode: not remembered
    }
  };
  return [open, toggle];
}

export function FoldButton({ open, onClick, what }: { open: boolean; onClick: () => void; what: string }) {
  const label = `${open ? 'Masquer' : 'Afficher'} ${what}`;
  return (
    <button
      type="button"
      className="icon-btn flex-none"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ width: 28, height: 28, minHeight: 28, color: 'var(--text-muted)' }}
    >
      <svg
        aria-hidden="true"
        width={14}
        height={14}
        viewBox="0 0 14 14"
        style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform 0.15s' }}
      >
        <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * The time of the period, at the top (user request 01/11/2026): it moves with each choice, so it stays in sight
 * while scrolling (PC / iPad); the breakdown is folded behind « Détail ».
 * F2 (D-137): the load = done in the period (dark part of the bar) + planned still to do (light part), against
 * the budget; once what is done reaches the budget, nothing is left.
 */
export function PlanTime({
  title,
  info,
  doneMin,
  usedMin,
  totalMin,
  overMin,
  overText,
  actions,
  detail,
}: {
  title: string;
  info: ReactNode;
  doneMin: number;
  usedMin: number;
  totalMin: number;
  overMin: number;
  overText: string;
  actions?: ReactNode;
  detail: ReactNode;
}) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const scale = Math.max(1, totalMin, usedMin);
  const width = (m: number) => `${Math.round((Math.max(0, m) / scale) * 100)}%`;
  const spent = totalMin > 0 && doneMin >= totalMin;
  const over = overMin > 0;
  return (
    <section
      className="card flex flex-col gap-2"
      style={{
        padding: '14px 20px',
        ...(phone ? {} : { position: 'sticky', top: 8, zIndex: 5, boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }),
      }}
    >
      <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap">
        <h2 className="h2 flex items-center gap-2">
          {title}
          <InfoTip>{info}</InfoTip>
        </h2>
        <span className="mono text-[22px]">
          {fmtMin(usedMin)}{' '}
          <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>/ {fmtMin(totalMin)}</span>
        </span>
        <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          fait {fmtMin(doneMin)} · prévu {fmtMin(Math.max(0, usedMin - doneMin))}
        </span>
        <span
          className="text-[14px] font-medium"
          style={{ color: over || spent ? 'var(--status-red)' : 'var(--ok)' }}
        >
          {spent
            ? 'Plus de budget disponible'
            : over
              ? `${fmtMin(overMin)} de trop : ${overText}`
              : `Reste ${fmtMin(Math.max(0, totalMin - usedMin))}`}
        </span>
        <span className="flex-1" />
        {actions}
        <button
          type="button"
          className="border-0 bg-transparent p-0 cursor-pointer underline underline-offset-2 text-[13px]"
          style={{ color: 'var(--text-muted)' }}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Masquer le détail' : 'Détail'}
        </button>
      </div>
      <div className="track flex" style={{ height: 10 }} title="Foncé : fait · clair : prévu">
        <div
          style={{
            height: 10,
            width: width(doneMin),
            background: over || spent ? 'var(--status-red)' : 'var(--text)',
          }}
        />
        <div
          style={{
            height: 10,
            width: width(usedMin - doneMin),
            background: over || spent ? 'var(--status-red)' : 'var(--primary)',
            opacity: over || spent ? 0.55 : 1,
          }}
        />
      </div>
      {open && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </div>
      )}
    </section>
  );
}

export type PlanAlertItem = { id: string; title: string; type: 'task' | 'project' | 'objective' };
export type PlanAlertRow = {
  level: 'critical' | 'warn' | 'info' | 'ok';
  code: string;
  text: string;
  items?: PlanAlertItem[];
};

const LEVEL_COLOR: Record<string, string> = {
  critical: 'var(--status-red)',
  warn: 'var(--status-orange)',
  info: 'var(--text-ghost)',
  ok: 'var(--status-green)',
};

/** D-108 / D-112: alerts on three levels; those that concern tasks / projects / objectives open their list. */
export function PlanAlerts({ alerts, okWord = 'valider' }: { alerts: PlanAlertRow[]; okWord?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section
      title="Alertes"
      info={
        <>
          <span className="tip-li">
            <b style={{ color: '#f08a80' }}>Rouge</b> : à traiter avant de {okWord} ;
          </span>
          <span className="tip-li">
            <b style={{ color: '#f0b45b' }}>Orange</b> : à surveiller ;
          </span>
          <span className="tip-li">
            <b>Gris</b> : pour information.
          </span>
        </>
      }
    >
      <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
        {alerts.map((a) => {
          const key = a.code + a.text;
          const items = a.items ?? [];
          const weight = a.level === 'critical' ? 600 : undefined;
          return (
            <li key={key} className="flex gap-2.5 text-[14px]">
              <span className="dot flex-none" style={{ marginTop: 6, background: LEVEL_COLOR[a.level] }} />
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                {items.length ? (
                  <button
                    type="button"
                    className="link-btn"
                    aria-expanded={open === key}
                    onClick={() => setOpen(open === key ? null : key)}
                    style={{ fontWeight: weight }}
                  >
                    {a.text} <span style={{ color: 'var(--text-faint)' }}>{open === key ? '▴' : '▾'}</span>
                  </button>
                ) : (
                  <span style={{ fontWeight: weight }}>{a.text}</span>
                )}
                {open === key && (
                  <ul className="m-0 pl-4 flex flex-col gap-0.5 text-[13px]">
                    {items.map((p) => (
                      <li key={p.id}>
                        {p.type === 'task' ? (
                          <button type="button" className="link-btn text-left" onClick={() => openTask(p.id)}>
                            {p.title}
                          </button>
                        ) : (
                          <Link
                            to={p.type === 'objective' ? '/objectifs/$id' : '/projets/$id'}
                            params={{ id: p.id }}
                          >
                            {p.title}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
