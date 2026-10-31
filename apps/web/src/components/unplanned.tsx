// D-99: « Fait hors plan » from Ma semaine: trace in a few seconds a task done without having been planned —
// an existing task of a project (checked) or a new one (created already done). The API traces it as unplanned.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, post } from '../lib/api.ts';
import { fmtMin } from '../lib/format.ts';
import { useAction, useDomainLookup, useMe } from '../lib/hooks.ts';
import type { Project, Task } from '../lib/types.ts';
import { DurationOptions } from './tasks.tsx';
import { DomainDot, Panel } from './ui.tsx';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function UnplannedPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const dl = useDomainLookup();
  const month = me.data?.today.slice(0, 7);
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined); // null = Inbox
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('30');
  const [actual, setActual] = useState('');
  const projects = useQuery({
    queryKey: ['projects', 'unplanned-picker'],
    queryFn: () => get<Project[]>('/projects?status=active,ready,paused'),
    enabled: open,
  });
  const tasks = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => get<Task[]>(`/tasks?projectId=${projectId}`),
    enabled: open && !!projectId,
  });
  const close = () => {
    setQ('');
    setProjectId(undefined);
    setTitle('');
    setActual('');
    onClose();
  };
  const actualMin = actual ? Math.max(1, Math.round(Number(actual.replace(',', '.')) * 60)) : null;
  const check = useAction((id: string) => post(`/tasks/${id}/complete`, actualMin ? { actualMin } : {}), {
    toast: 'Tâche faite, tracée hors plan.',
    onSuccess: close,
  });
  const create = useAction(
    () =>
      post('/tasks/done', {
        title: title.trim(),
        projectId,
        durationMin: Number(duration),
        ...(actualMin ? { actualMin } : {}),
      }),
    { toast: 'Tâche ajoutée et tracée hors plan.', onSuccess: close },
  );
  // Month projects first: they are the likeliest to receive an unplanned task.
  const list = (projects.data ?? [])
    .filter((p) => !q || fold(p.title).includes(fold(q)))
    .sort(
      (a, b) =>
        Number(b.monthFlag === month) - Number(a.monthFlag === month) || a.title.localeCompare(b.title),
    );
  const chosen = projects.data?.find((p) => p.id === projectId);
  const open$ = (tasks.data ?? []).filter((t) => t.status === 'todo');
  return (
    <Panel open={open} onClose={close} title="Fait hors plan" width={560}>
      <p className="m-0 text-[14px]" style={{ color: 'var(--text-muted)' }}>
        Une tâche faite sans être prévue cette semaine : elle compte dans « Fait » et dans la mesure de la
        dérive (rapports).
      </p>
      {projectId === undefined ? (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher un projet…"
            aria-label="Chercher un projet"
          />
          <div className="card overflow-auto" style={{ maxHeight: '52vh' }}>
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                className="row-line w-full flex items-center gap-2.5 text-left border-0 cursor-pointer"
                style={{ padding: '10px 14px', background: 'var(--surface)' }}
                onClick={() => setProjectId(p.id)}
              >
                <DomainDot color={dl.color(p.domainIds[0])} size={8} />
                <span className="flex-1 min-w-0 truncate text-[15px]">{p.title}</span>
                {p.monthFlag === month && (
                  <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    du mois
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              className="row-line w-full flex items-center gap-2.5 text-left border-0 cursor-pointer"
              style={{ padding: '10px 14px', background: 'var(--surface-2)', color: 'var(--text-muted)' }}
              onClick={() => setProjectId(null)}
            >
              Sans projet (Inbox)
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold flex-1 min-w-0 truncate">
              {chosen?.title ?? 'Inbox'}
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setProjectId(undefined)}>
              Changer
            </button>
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) create.mutate(undefined);
            }}
          >
            <span className="label-caps">Nouvelle tâche, déjà faite</span>
            <div className="flex flex-wrap gap-2">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ce que j'ai fait…"
                aria-label="Titre de la tâche"
                style={{ flex: '1 1 240px', minWidth: 0 }}
              />
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                aria-label="Durée estimée"
                style={{ flex: '0 1 112px' }}
              >
                <DurationOptions />
              </select>
              <button type="submit" className="btn btn-primary" disabled={!title.trim() || create.isPending}>
                ✓ Fait
              </button>
            </div>
          </form>
          {projectId && (
            <div className="flex flex-col gap-2">
              <span className="label-caps">Ou une tâche existante</span>
              <div className="card overflow-auto" style={{ maxHeight: '36vh' }}>
                {open$.length === 0 && (
                  <div className="px-4 py-3 text-[14px]" style={{ color: 'var(--text-faint)' }}>
                    Aucune tâche à faire dans ce projet.
                  </div>
                )}
                {open$.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="row-line w-full flex items-center gap-2.5 text-left border-0 cursor-pointer"
                    style={{ padding: '10px 14px', background: 'var(--surface)' }}
                    disabled={check.isPending}
                    onClick={() => check.mutate(t.id)}
                    title="Marquer comme faite (hors plan)"
                  >
                    <span aria-hidden style={{ color: 'var(--text-ghost)' }}>
                      ○
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[15px]">{t.title}</span>
                    {t.inPlan && (
                      <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                        déjà prévue
                      </span>
                    )}
                    <span className="mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      {t.durationMin ? fmtMin(t.durationMin) : '—'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-[14px]" style={{ color: 'var(--text-muted)' }}>
            Temps réellement passé (facultatif)
            <input
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              inputMode="decimal"
              placeholder="en heures, ex. 1,5"
              style={{ width: 150 }}
            />
          </label>
        </div>
      )}
    </Panel>
  );
}
