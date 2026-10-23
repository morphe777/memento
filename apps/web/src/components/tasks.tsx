// TaskRow / TaskList (drag & drop reorder = sequence, F-10), TaskDrawer, QuickAdd, GroupPicker, Resources.
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { del, get, patch, post } from '../lib/api.ts';
import { fmtDateShort, STATUS_LABEL } from '../lib/format.ts';
import { useAction, useDomainLookup, useGroups } from '../lib/hooks.ts';
import type { Project, Resource, Task, TaskDetail } from '../lib/types.ts';
import { DescriptionBlock } from './markdown.tsx';
import { ConfirmDialog, Duration, ExperienceBadge, Field, Panel, TaskCheck } from './ui.tsx';

export function LockIcon() {
  return (
    <svg
      aria-label="Verrouillée : attend la tâche précédente"
      role="img"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      style={{ flex: 'none' }}
    >
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Handle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label="Déplacer"
      className="flex-none border-0 bg-transparent cursor-grab grid place-items-center"
      style={{ width: 28, minHeight: 32, color: 'var(--text-ghost)', touchAction: 'none' }}
      {...props}
    >
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden>
        {[2, 8, 14].map((y) => (
          <g key={y}>
            <circle cx="2.5" cy={y} r="1.4" fill="currentColor" />
            <circle cx="7.5" cy={y} r="1.4" fill="currentColor" />
          </g>
        ))}
      </svg>
    </button>
  );
}

function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 5 : undefined,
        position: 'relative',
        opacity: isDragging ? 0.8 : 1,
      }}
    >
      {children(disabled ? <span style={{ width: 28 }} /> : <Handle {...attributes} {...listeners} />)}
    </div>
  );
}

export function useSortSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Ordered task list of a project or the Inbox; order = implicit prerequisite in sequential projects (DM-51). */
export function TaskList({
  tasks,
  projectId,
  color,
  onOpen,
  showDone = true,
}: {
  tasks: Task[];
  projectId: string | null;
  color: (t: Task) => string;
  onOpen: (id: string) => void;
  showDone?: boolean;
}) {
  const sensors = useSortSensors();
  const [order, setOrder] = useState(tasks.map((t) => t.id));
  useEffect(() => setOrder(tasks.map((t) => t.id)), [tasks]);
  const reorder = useAction((ids: string[]) => post('/tasks/reorder', { projectId, ids }));
  const toggle = useAction((t: Task) =>
    post(`/tasks/${t.id}/${t.status === 'done' ? 'uncomplete' : 'complete'}`),
  );
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visible = order
    .map((id) => byId.get(id))
    .filter((t): t is Task => !!t && (showDone || t.status !== 'done') && t.status !== 'cancelled');
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
    setOrder(next);
    reorder.mutate(next);
  };
  if (!visible.length)
    return (
      <div className="px-5 py-6 text-[14px]" style={{ color: 'var(--text-faint)' }}>
        Aucune tâche.
      </div>
    );
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={visible.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {visible.map((t, i) => (
          <SortableRow key={t.id} id={t.id} disabled={t.status === 'done'}>
            {(handle) => (
              <div
                className="flex gap-3 items-start"
                style={{
                  padding: '12px 16px 12px 6px',
                  borderBottom: '1px solid var(--divider)',
                  opacity: t.status === 'done' ? 0.5 : t.locked ? 0.55 : 1,
                  background: 'var(--surface)',
                }}
              >
                {handle}
                <span
                  className="mono text-[12px] flex-none pt-1"
                  style={{ width: 18, color: 'var(--text-ghost)' }}
                >
                  {i + 1}
                </span>
                <TaskCheck
                  done={t.status === 'done'}
                  color={color(t)}
                  label={t.title}
                  onToggle={() => toggle.mutate(t)}
                />
                <button
                  type="button"
                  className="flex-1 min-w-0 flex flex-col gap-1 text-left border-0 bg-transparent p-0 cursor-pointer"
                  onClick={() => onOpen(t.id)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-[15px] font-semibold hover:underline"
                      style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined }}
                    >
                      {t.title}
                    </span>
                    {t.isExperience && <ExperienceBadge />}
                    {t.locked && (
                      <span style={{ color: 'var(--text-faint)' }}>
                        <LockIcon />
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] flex flex-wrap gap-2" style={{ color: 'var(--text-faint)' }}>
                    {t.isFree && <span>Libre</span>}
                    {t.dueDate && (
                      <span style={{ color: 'var(--late-text)' }}>Deadline {fmtDateShort(t.dueDate)}</span>
                    )}
                    {t.recurrenceRule && <span>Récurrente</span>}
                    {t.inPlan && <span>Dans le plan de la semaine</span>}
                    {t.postponeCount > 0 && <span>Reportée {t.postponeCount} fois</span>}
                    {t.locked && <span>Après la tâche précédente</span>}
                  </span>
                </button>
                <Duration min={t.durationMin} />
              </div>
            )}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

/** G-03: create a task in ≤ 2 actions (type + Enter). */
export function QuickAdd({
  projectId,
  placeholder,
  defaultDuration = 30,
}: {
  projectId: string | null;
  placeholder: string;
  defaultDuration?: 30 | 60 | 120 | null;
}) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState<string>(defaultDuration ? String(defaultDuration) : '');
  const add = useAction(
    (t: string) => post('/tasks', { title: t, projectId, durationMin: duration ? Number(duration) : null }),
    { onSuccess: () => setTitle('') },
  );
  return (
    <form
      className="flex gap-2 items-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) add.mutate(title.trim());
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 min-w-0"
      />
      <select
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        aria-label="Durée"
        style={{ width: 96 }}
      >
        <option value="">Durée ?</option>
        <option value="30">30 min</option>
        <option value="60">1 h</option>
        <option value="120">2 h</option>
      </select>
      <button type="submit" className="btn" disabled={!title.trim() || add.isPending}>
        Ajouter
      </button>
    </form>
  );
}

export function DurationSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Non estimée</option>
      <option value="30">30 min</option>
      <option value="60">1 h</option>
      <option value="120">2 h (déconseillé)</option>
    </select>
  );
}

const RECURRENCES = [
  { value: '', label: 'Aucune' },
  { value: 'FREQ=WEEKLY', label: 'Chaque semaine' },
  { value: 'FREQ=MONTHLY', label: 'Chaque mois' },
  { value: 'FREQ=MONTHLY;INTERVAL=3', label: 'Chaque trimestre' },
  { value: 'FREQ=YEARLY', label: 'Chaque année' },
];

/** Side panel for a task (/projets/:id?tache=:tid). */
export function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => get<TaskDetail>(`/tasks/${taskId}`),
    enabled: !!taskId,
  });
  const t = q.data;
  return (
    <Panel open={!!taskId} onClose={onClose} title={t ? t.title : 'Tâche'} width={560}>
      {t && <TaskForm key={`${t.id}-${t.updatedAt}`} t={t} onClose={onClose} />}
    </Panel>
  );
}

function TaskForm({ t, onClose }: { t: TaskDetail; onClose: () => void }) {
  const dl = useDomainLookup();
  const [f, setF] = useState({
    title: t.title,
    durationMin: t.durationMin,
    isExperience: t.isExperience,
    isFree: t.isFree,
    dueDate: t.dueDate ?? '',
    recurrenceRule: t.recurrenceRule ?? '',
    domainId: t.domainId ?? '',
  });
  const inbox = !t.projectId;
  const save = useAction(
    () =>
      patch(`/tasks/${t.id}`, {
        title: f.title,
        durationMin: f.durationMin,
        isExperience: f.isExperience,
        isFree: f.isFree,
        dueDate: f.dueDate || null,
        ...(inbox ? { recurrenceRule: f.recurrenceRule || null, domainId: f.domainId || null } : {}),
      }),
    { toast: 'Tâche enregistrée.' },
  );
  const complete = useAction(() => post(`/tasks/${t.id}/${t.status === 'done' ? 'uncomplete' : 'complete'}`));
  const cancel = useAction(
    () => patch(`/tasks/${t.id}`, { status: t.status === 'cancelled' ? 'todo' : 'cancelled' }),
    { onSuccess: onClose },
  );
  const saveDescription = useAction((description: string) => patch(`/tasks/${t.id}`, { description }), {
    toast: 'Description enregistrée.',
  });
  const [deleting, setDeleting] = useState(false);
  const remove = useAction(() => del(`/tasks/${t.id}`), { onSuccess: onClose, toast: 'Tâche supprimée.' });
  const projects = useQuery({
    queryKey: ['projects', 'movable'],
    queryFn: () => get<Project[]>('/projects?status=idea,active,paused'),
  });
  const move = useAction((projectId: string | null) => post(`/tasks/${t.id}/move`, { projectId }), {
    toast: 'Tâche déplacée.',
  });
  const siblings = useQuery({
    queryKey: ['tasks', t.projectId ?? 'inbox'],
    queryFn: () => get<Task[]>(`/tasks?projectId=${t.projectId ?? 'inbox'}`),
  });
  const addDep = useAction((id: string) => post(`/tasks/${t.id}/dependencies`, { dependsOnId: id }));
  const rmDep = useAction((id: string) => del(`/tasks/${t.id}/dependencies/${id}`));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <>
      <div className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
        {STATUS_LABEL[t.status]} · créée par {t.createdBy === 'me' ? 'moi' : t.createdBy}{' '}
        {t.locked && '· verrouillée (attend la tâche précédente)'}
      </div>
      <Field label="Titre">
        <input value={f.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <DescriptionBlock
        text={t.description}
        lines={8}
        saving={saveDescription.isPending}
        onSave={(text, done) => saveDescription.mutate(text, { onSuccess: done })}
      />
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Durée">
          <DurationSelect value={f.durationMin} onChange={(v) => set('durationMin', v)} />
        </Field>
        <Field label="Deadline">
          <input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[14px]">
        <input
          type="checkbox"
          checked={f.isExperience}
          onChange={(e) => set('isExperience', e.target.checked)}
        />{' '}
        Expérience (hors budget, compte dans les souvenirs)
      </label>
      {!inbox && (
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={f.isFree} onChange={(e) => set('isFree', e.target.checked)} /> Libre
          : faisable n'importe quand (sort de la séquence)
        </label>
      )}
      {inbox && (
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Récurrence">
            <select value={f.recurrenceRule} onChange={(e) => set('recurrenceRule', e.target.value)}>
              {RECURRENCES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
              {f.recurrenceRule && !RECURRENCES.some((r) => r.value === f.recurrenceRule) && (
                <option value={f.recurrenceRule}>{f.recurrenceRule}</option>
              )}
            </select>
          </Field>
          <Field label="Domaine">
            <select value={f.domainId} onChange={(e) => set('domainId', e.target.value)}>
              <option value="">Aucun (Inbox)</option>
              {dl.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => save.mutate(undefined)}
          disabled={save.isPending}
        >
          Enregistrer
        </button>
        <button type="button" className="btn" onClick={() => complete.mutate(undefined)}>
          {t.status === 'done' ? 'Rouvrir' : 'Marquer faite'}
        </button>
        <button type="button" className="btn" onClick={() => cancel.mutate(undefined)}>
          {t.status === 'cancelled' ? 'Réactiver' : 'Annuler la tâche'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-danger"
          style={{ borderColor: 'transparent' }}
          onClick={() => setDeleting(true)}
        >
          Supprimer
        </button>
      </div>
      <ConfirmDialog
        open={deleting}
        title="Supprimer la tâche ?"
        busy={remove.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate(undefined)}
      >
        <p className="m-0">
          « {t.title} » sera supprimée définitivement, avec ses prérequis et ses ressources. Les rapports déjà
          générés ne changent pas.
        </p>
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Pour garder une trace sans la faire, préfère « Annuler la tâche ».
        </p>
      </ConfirmDialog>

      <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="label-caps">Prérequis explicites</div>
        {t.dependsOn.map((id) => {
          const s = siblings.data?.find((x) => x.id === id);
          return (
            <div key={id} className="flex items-center justify-between text-[14px]">
              <span>{s?.title ?? 'Tâche d’un autre projet'}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => rmDep.mutate(id)}>
                Retirer
              </button>
            </div>
          );
        })}
        <select
          value=""
          onChange={(e) => e.target.value && addDep.mutate(e.target.value)}
          aria-label="Ajouter un prérequis"
        >
          <option value="">+ Doit être fait après…</option>
          {(siblings.data ?? [])
            .filter((s) => s.id !== t.id && !t.dependsOn.includes(s.id) && s.status !== 'cancelled')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="label-caps">Déplacer</div>
        <select
          value={t.projectId ?? ''}
          onChange={(e) => move.mutate(e.target.value || null)}
          aria-label="Déplacer vers"
        >
          <option value="">Inbox</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} ({STATUS_LABEL[p.status]})
            </option>
          ))}
        </select>
      </div>
      <Resources ownerType="task" ownerId={t.id} resources={t.resources} />
    </>
  );
}

/** DM-70: links to documentation. */
export function Resources({
  ownerType,
  ownerId,
  resources,
}: {
  ownerType: 'objective' | 'project' | 'task' | 'group';
  ownerId: string;
  resources: Resource[];
}) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const add = useAction(() => post('/resources', { ownerType, ownerId, label: label || url, url }), {
    onSuccess: () => {
      setLabel('');
      setUrl('');
    },
  });
  const remove = useAction((id: string) => del(`/resources/${id}`));
  return (
    <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="label-caps">Ressources</div>
      {resources.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2 text-[14px]">
          {/^https?:\/\//.test(r.url) ? (
            <a href={r.url} target="_blank" rel="noreferrer noopener" className="underline truncate">
              {r.label}
            </a>
          ) : (
            <span className="truncate" title={r.url}>
              {r.label}{' '}
              <span className="mono text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {r.url}
              </span>
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => remove.mutate(r.id)}
            aria-label={`Retirer ${r.label}`}
          >
            ✕
          </button>
        </div>
      ))}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) add.mutate(undefined);
        }}
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Libellé"
          aria-label="Libellé"
          style={{ flex: '1 1 120px' }}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL ou chemin"
          aria-label="URL ou chemin"
          style={{ flex: '2 1 200px' }}
        />
        <button type="submit" className="btn" disabled={!url.trim()}>
          Ajouter
        </button>
      </form>
    </div>
  );
}

/** Groups multi-select (DM-91): domains are deduced from groups. */
/** Groups by domain, laid out as a table: domain in the left cell, its groups wrap inside the right cell. */
export function GroupPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const groups = useGroups();
  const dl = useDomainLookup();
  const byDomain = dl.domains
    .map((d) => ({ d, groups: (groups.data ?? []).filter((g) => g.domainId === d.id) }))
    .filter((x) => x.groups.length);
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(96px, max-content) minmax(0, 1fr)' }}>
      {byDomain.map(({ d, groups: gs }, i) => {
        const line = i < byDomain.length - 1 ? '1px solid var(--divider)' : undefined;
        return (
          <Fragment key={d.id}>
            <span
              className="flex items-center gap-1.5 text-[12px] pr-3"
              style={{
                color: 'var(--text-muted)',
                borderBottom: line,
                padding: '8px 12px 8px 0',
                minHeight: 30,
              }}
            >
              <span className="dot" style={{ background: dl.colorOf(d) }} />
              {d.name}
            </span>
            <div
              className="flex flex-wrap items-center gap-1.5 min-w-0"
              style={{ borderBottom: line, padding: '8px 0' }}
            >
              {gs.map((g) => {
                const on = value.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}
                    className="rounded-full text-[12px] cursor-pointer"
                    style={{
                      minHeight: 30,
                      padding: '0 10px',
                      border: `1px solid ${on ? dl.colorOf(d) : 'var(--border)'}`,
                      background: on ? 'var(--bin)' : 'var(--surface)',
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
