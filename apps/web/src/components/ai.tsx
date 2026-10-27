// D-58 / V-17: « Proposer avec l'IA » on the week, month and quarter tabs of Planifier. The AI proposal is
// shown for review (one reason per change, each change can be unchecked), then applied through the usual
// planning endpoints: same rules, same journal, nothing applied without the « Appliquer » click.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError, get, post, put } from '../lib/api.ts';
import { fmtMin } from '../lib/format.ts';
import { toast } from '../lib/hooks.ts';
import type { AiStatus } from '../lib/types.ts';
import { Panel } from './ui.tsx';

type Scope = 'week' | 'month' | 'quarter';
interface Change {
  action: 'keep' | 'add' | 'remove';
  id: string;
  title: string;
  kind?: 'week' | 'bonus';
  reason: string;
  durationMin?: number | null;
  warning?: string;
}
interface Proposal {
  scope: Scope;
  period: string;
  summary: string;
  model: string;
  changes: Change[];
}

const ACTION_LABEL: Record<Scope, Record<Change['action'], string>> = {
  week: { keep: 'Gardée', add: 'Ajoutée', remove: 'Retirée' },
  month: { keep: 'Gardé', add: 'Projet du mois', remove: 'Retiré du mois' },
  quarter: { keep: 'Gardé', add: 'Ce trimestre', remove: 'Reporté' },
};
const ACTION_COLOR: Record<Change['action'], string> = {
  keep: 'var(--text-muted)',
  add: 'var(--accent, #6B4FD8)',
  remove: 'var(--danger, #C0392B)',
};

export function StarIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16">
      <path
        d="M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.7l-3.7 2.4 1.1-4.3L2 6l4.4-.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AiProposeButton({
  scope,
  period,
  weekItems,
  postponeTo,
  disabled,
}: {
  scope: Scope;
  period: string;
  /** Week: the current selection, the base the proposal is applied on. */
  weekItems?: { taskId: string; kind: 'week' | 'bonus' }[];
  /** Quarter: where a non-kept objective goes. */
  postponeTo?: string;
  disabled?: boolean;
}) {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => get<AiStatus>('/ai/status') });
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const ready = !!status.data?.configured && !disabled;
  const run = async () => {
    setBusy(true);
    try {
      setProposal(await post<Proposal>('/ai/propose', { scope, period }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "L'IA n'a pas pu répondre.", 'error');
    } finally {
      setBusy(false);
    }
  };
  const title = !status.data
    ? undefined
    : !status.data.configured
      ? `IA non configurée : ${status.data.reason} (Configuration › IA)`
      : disabled
        ? 'Période passée'
        : `${status.data.providerLabel} · ${status.data.model}`;
  return (
    <>
      <button
        type="button"
        className={ready ? 'btn' : 'btn btn-disabled-v2'}
        disabled={!ready || busy}
        title={title}
        onClick={run}
        style={{ minHeight: 44, opacity: 1, padding: '0 18px' }}
      >
        <StarIcon />
        {busy ? "L'IA réfléchit…" : "Proposer avec l'IA"}
      </button>
      {proposal && (
        <ProposalPanel
          proposal={proposal}
          weekItems={weekItems ?? []}
          postponeTo={postponeTo}
          onClose={() => setProposal(null)}
        />
      )}
    </>
  );
}

function ProposalPanel({
  proposal,
  weekItems,
  postponeTo,
  onClose,
}: {
  proposal: Proposal;
  weekItems: { taskId: string; kind: 'week' | 'bonus' }[];
  postponeTo?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { scope, period, changes } = proposal;
  // Kept items need no action; new and removed ones are checked unless Mémento has a doubt.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(changes.filter((c) => c.action !== 'keep' && !c.warning).map((c) => c.id)),
  );
  const [busy, setBusy] = useState(false);
  const actionable = changes.filter((c) => c.action !== 'keep');
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const apply = async () => {
    setBusy(true);
    const errors: string[] = [];
    const chosen = actionable.filter((c) => checked.has(c.id));
    try {
      if (scope === 'week') {
        const items = new Map(weekItems.map((i) => [i.taskId, i.kind]));
        for (const c of changes) {
          if (c.action === 'keep' && c.kind) items.set(c.id, c.kind);
          if (!checked.has(c.id)) continue;
          if (c.action === 'add' && c.kind) items.set(c.id, c.kind);
          if (c.action === 'remove') items.delete(c.id);
        }
        await put(`/week-plans/${period}/items`, {
          items: [...items].map(([taskId, kind]) => ({ taskId, kind })),
        });
      } else {
        // Removals first: they free room under the month / quarter limits.
        for (const c of [...chosen].sort(
          (a, b) => (a.action === 'remove' ? -1 : 0) - (b.action === 'remove' ? -1 : 0),
        )) {
          try {
            if (scope === 'month')
              await post(`/projects/${c.id}/month`, { month: c.action === 'add' ? period : null });
            else
              await post(`/objectives/${c.id}/quarter`, {
                quarter: c.action === 'add' ? period : postponeTo,
              });
          } catch (e) {
            errors.push(`${c.title} : ${e instanceof ApiError ? e.message : 'erreur'}`);
          }
        }
      }
      await qc.invalidateQueries();
      if (errors.length) toast(`Appliqué en partie. ${errors.join(' · ')}`, 'error');
      else toast('Proposition de l’IA appliquée.');
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Application impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const total =
    scope === 'week'
      ? changes
          .filter(
            (c) => c.kind === 'week' && (c.action === 'keep' || (c.action === 'add' && checked.has(c.id))),
          )
          .reduce((n, c) => n + (c.durationMin ?? 0), 0)
      : null;

  return (
    <Panel open onClose={onClose} title="Proposition de l'IA" hint={`Modèle : ${proposal.model}`}>
      <p className="m-0 text-[15px] leading-relaxed">{proposal.summary}</p>
      {total !== null && (
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Semaine (hors bonus) après application : {fmtMin(total)}
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {changes.map((c) => (
          <li
            key={c.id}
            className="flex gap-3 items-start rounded-lg p-3"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            {c.action === 'keep' ? (
              <span
                className="w-[18px] text-center"
                aria-hidden="true"
                style={{ color: 'var(--text-muted)' }}
              >
                ✓
              </span>
            ) : (
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Appliquer : ${c.title}`}
                checked={checked.has(c.id)}
                onChange={() => toggle(c.id)}
              />
            )}
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{c.title}</span>
                <span className="text-[12px] font-semibold" style={{ color: ACTION_COLOR[c.action] }}>
                  {ACTION_LABEL[scope][c.action]}
                  {c.kind === 'bonus' ? ' · bonus' : ''}
                </span>
                {!!c.durationMin && (
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {fmtMin(c.durationMin)}
                    {scope !== 'week' ? ' restant' : ''}
                  </span>
                )}
              </div>
              <span className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
                {c.reason}
              </span>
              {c.warning && (
                <span className="text-[13px]" style={{ color: 'var(--warn, #B7791F)' }}>
                  ⚠ {c.warning}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!actionable.length && (
        <p className="m-0 text-[14px]" style={{ color: 'var(--text-muted)' }}>
          L'IA ne propose aucun changement.
        </p>
      )}
      <div className="flex flex-wrap gap-2 justify-end items-center">
        <Link
          to="/configuration/$onglet"
          params={{ onglet: 'ia' }}
          className="text-[13px] mr-auto"
          onClick={onClose}
        >
          Régler l'IA
        </Link>
        <button type="button" className="btn" onClick={onClose}>
          Ignorer
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !actionable.some((c) => checked.has(c.id))}
          onClick={apply}
        >
          Appliquer {checked.size ? `(${actionable.filter((c) => checked.has(c.id)).length})` : ''}
        </button>
      </div>
    </Panel>
  );
}
