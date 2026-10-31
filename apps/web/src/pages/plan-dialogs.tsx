// Vue Plan side pieces: the full edit / create panels of meta-objectives, objectives and projects opened from
// the view (D-97, the same panels as their pages) and the floating draft bar (D-92). All writes go through the API.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError, get } from '../lib/api.ts';
import { toast } from '../lib/hooks.ts';
import type { MetaObjective, Objective, ProjectDetail, Resource } from '../lib/types.ts';
import { MetaPanel, ObjectivePanel } from './objectives.tsx';
import { NewProjectPanel, ProjectEditPanel } from './projects.tsx';

export type Editing =
  | { kind: 'meta'; id: string }
  | { kind: 'objective'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'newMeta' }
  | { kind: 'newObjective'; quarter?: string; metaObjectiveId?: string | null }
  /** D-104: from the toolbar (to the reserve) or from an objective frame (pre-filled, end of its path). */
  | { kind: 'newProject'; objectiveId?: string; objectiveTitle?: string };

/** One panel at a time, fetched fresh: saving it refetches the plan, the draft in progress is kept (D-91). */
export function PlanEditors({
  editing,
  domainIds,
  onClose,
}: {
  editing: Editing | null;
  domainIds: string[];
  onClose: () => void;
}) {
  const id = editing && 'id' in editing ? editing.id : null;
  const metas = useQuery({
    queryKey: ['meta-objectives'],
    queryFn: () => get<MetaObjective[]>('/meta-objectives'),
    enabled: !!editing,
  });
  const meta = useQuery({
    queryKey: ['meta-objective', id],
    queryFn: () => get<MetaObjective>(`/meta-objectives/${id}`),
    enabled: editing?.kind === 'meta',
  });
  const objective = useQuery({
    queryKey: ['objective', id],
    queryFn: () => get<Objective & { resources: Resource[] }>(`/objectives/${id}`),
    enabled: editing?.kind === 'objective',
  });
  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => get<ProjectDetail>(`/projects/${id}`),
    enabled: editing?.kind === 'project',
  });
  if (!editing) return null;
  const page = (to: '/meta-objectifs/$id' | '/objectifs/$id' | '/projets/$id') => (
    <Link to={to} params={{ id: id! }} className="btn btn-sm">
      Ouvrir la page
    </Link>
  );
  switch (editing.kind) {
    case 'meta':
      return meta.data && meta.data.id === id ? (
        <MetaPanel key={id} open meta={meta.data} onClose={onClose} footer={page('/meta-objectifs/$id')} />
      ) : null;
    case 'objective':
      return objective.data && objective.data.id === id && metas.data ? (
        <ObjectivePanel
          key={id}
          open
          objective={objective.data}
          metas={metas.data}
          onClose={onClose}
          footer={page('/objectifs/$id')}
        />
      ) : null;
    case 'project':
      return project.data && project.data.id === id ? (
        <ProjectEditPanel key={id} open p={project.data} onClose={onClose} footer={page('/projets/$id')} />
      ) : null;
    case 'newMeta':
      return (
        <MetaPanel
          open
          onClose={onClose}
          defaults={{ primaryDomainId: domainIds.length === 1 ? domainIds[0] : undefined }}
        />
      );
    case 'newObjective':
      return metas.data ? (
        <ObjectivePanel
          open
          metas={metas.data}
          onClose={onClose}
          defaults={{ quarter: editing.quarter, metaObjectiveId: editing.metaObjectiveId }}
          onCreated={(o) => toast(`Objectif « ${o.title} » créé.`)}
        />
      ) : null;
    case 'newProject':
      return (
        <NewProjectPanel
          open
          onClose={onClose}
          stay
          objective={
            editing.objectiveId ? { id: editing.objectiveId, title: editing.objectiveTitle ?? '' } : undefined
          }
        />
      );
  }
}

// ---------- Floating draft bar (D-92) ----------

export function ApplyBar({
  changes,
  looseLabels,
  canApply,
  applying,
  error,
  onReset,
  onApply,
  onReload,
}: {
  changes: string[];
  looseLabels: string[];
  canApply: boolean;
  applying: boolean;
  error: { text: string; conflict: boolean } | null;
  onReset: () => void;
  onApply: () => void;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const n = changes.length;
  return (
    <div
      role="region"
      aria-label="Brouillon du plan"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(16px + env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        zIndex: 45,
        width: 'min(640px, calc(100vw - 32px))',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 10px 30px rgba(0,0,0,.18)',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-[14.5px] font-semibold text-left cursor-pointer"
          style={{ background: 'none', border: 0, padding: 0, color: 'var(--text)' }}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▾' : '▸'} Brouillon : {n ? `${n} changement${n > 1 ? 's' : ''}` : 'aucun changement'}
          {looseLabels.length ? ` · ${looseLabels.length} hors objectif` : ''}
        </button>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" disabled={applying} onClick={onReset}>
          Annuler tout
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!canApply || applying}
          onClick={onApply}
        >
          {applying ? 'Application…' : 'Appliquer'}
        </button>
      </div>
      {error && (
        <div className="text-[14px] flex flex-wrap gap-2 items-center" style={{ color: 'var(--status-red)' }}>
          {error.text}
          {error.conflict && (
            <button type="button" className="btn btn-sm" onClick={onReload}>
              Recharger
            </button>
          )}
        </div>
      )}
      {open && (
        <ul
          className="m-0 pl-4 text-[14px] flex flex-col gap-1"
          style={{ maxHeight: '35vh', overflow: 'auto' }}
        >
          {changes.map((c, i) => (
            <li key={`${i}-${c}`}>{c}</li>
          ))}
          {looseLabels.map((t) => (
            <li key={t} style={{ color: 'var(--text-faint)' }}>
              « {t} » : brouillon hors objectif (non enregistré)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;
