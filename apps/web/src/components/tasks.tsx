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
import { Fragment, useEffect, useRef, useState } from 'react';
import { del, get, patch, post } from '../lib/api.ts';
import { fmtDateShort, fmtMin, parseDuration, STATUS_LABEL } from '../lib/format.ts';
import { toast, useAction, useDomainLookup, useGroups } from '../lib/hooks.ts';
import type { Project, Resource, Task, TaskDetail } from '../lib/types.ts';
import { DescriptionBlock } from './markdown.tsx';
import {
  ConfirmDialog,
  Duration,
  ExperienceBadge,
  Field,
  Panel,
  SAVE_HINT,
  SearchSelect,
  TaskCheck,
} from './ui.tsx';

/**
 * D-61: time actually spent on a done task. Shows the estimate and, if entered, the real time (orange when
 * it is 1.5× the estimate or more); a click edits it (« 1h30 », « 4h »…), empty = as estimated.
 */
export function ActualTime({
  taskId,
  durationMin,
  actualMin,
}: {
  taskId: string;
  durationMin: number | null;
  actualMin: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const save = useAction((v: number | null) => patch(`/tasks/${taskId}`, { actualMin: v }), {
    toast: 'Temps réel enregistré.',
  });
  const over = actualMin !== null && durationMin !== null && actualMin >= durationMin * 1.5;
  const submit = () => {
    const v = text.trim() ? parseDuration(text) : null;
    if (text.trim() && (v === null || v < 1)) {
      toast('Durée illisible : écris par exemple 1h30, 4h ou 45min.', 'error');
      return;
    }
    if (v !== actualMin) save.mutate(v);
    setEditing(false);
  };
  if (editing)
    return (
      <span className="flex items-center gap-1.5">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          onBlur={submit}
          placeholder="ex. 1h30"
          aria-label="Temps réellement passé"
          style={{ width: 96, height: 32, minHeight: 32, padding: '0 8px', fontSize: 13 }}
        />
      </span>
    );
  return (
    <button
      type="button"
      className="border-0 bg-transparent cursor-pointer text-[12px] p-0 text-left inline-flex items-center gap-1 self-start"
      style={{ color: over ? 'var(--status-orange, #B7791F)' : 'var(--text-faint)' }}
      title="Temps réellement passé (si différent de l'estimation)"
      onClick={(e) => {
        e.stopPropagation();
        setText(actualMin ? fmtMin(actualMin).replace(/\s/g, '') : '');
        setEditing(true);
      }}
    >
      <ClockIcon />
      {actualMin !== null
        ? `réel ${fmtMin(actualMin)}${durationMin ? ` (prévu ${fmtMin(durationMin)})` : ''}`
        : 'temps réel ?'}
    </button>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

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
      className="row-wrap"
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
                className="row-line flex gap-3 items-start"
                style={{
                  padding: '12px 16px 12px 6px',
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
  withSchedule = false,
}: {
  projectId: string | null;
  placeholder: string;
  defaultDuration?: 30 | 60 | 120 | null;
  /** Inbox: deadline and recurrence can be set right away (RB-11). */
  withSchedule?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState<string>(defaultDuration ? String(defaultDuration) : '');
  const [dueDate, setDueDate] = useState('');
  const [rule, setRule] = useState('');
  const add = useAction(
    (t: string) =>
      post('/tasks', {
        title: t,
        projectId,
        durationMin: duration ? Number(duration) : null,
        ...(withSchedule ? { dueDate: dueDate || null, recurrenceRule: rule || null } : {}),
      }),
    {
      onSuccess: () => {
        setTitle('');
        setDueDate('');
        setRule('');
      },
    },
  );
  return (
    <form
      className="flex flex-wrap gap-2 items-center"
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
        style={{ flex: '1 1 240px', minWidth: 0 }}
      />
      <select
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        aria-label="Durée"
        style={{ flex: '0 1 112px', minWidth: 0 }}
      >
        <option value="">Durée ?</option>
        <option value="30">30 min</option>
        <option value="60">1 h</option>
        <option value="120">2 h</option>
      </select>
      {withSchedule && (
        <>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Deadline"
            title="Deadline (facultative)"
            style={{ flex: '1 1 150px', minWidth: 0 }}
          />
          <select
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            aria-label="Récurrence"
            style={{ flex: '1 1 170px', minWidth: 0 }}
          >
            {RECURRENCES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.value ? r.label : 'Pas de récurrence'}
              </option>
            ))}
          </select>
        </>
      )}
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
  if (!taskId) return null;
  if (!t || t.id !== taskId)
    return (
      <Panel open onClose={onClose} title="Tâche">
        <span style={{ color: 'var(--text-ghost)' }}>Chargement…</span>
      </Panel>
    );
  return <TaskForm key={t.id} t={t} onClose={onClose} />;
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
    actual: t.actualMin ? fmtMin(t.actualMin).replace(/\s/g, '') : '',
  });
  const inbox = !t.projectId;
  const actualMin = f.actual.trim() ? parseDuration(f.actual) : null;
  const body = () => ({
    title: f.title,
    durationMin: f.durationMin,
    isExperience: f.isExperience,
    isFree: f.isFree,
    dueDate: f.dueDate || null,
    ...(inbox ? { recurrenceRule: f.recurrenceRule || null, domainId: f.domainId || null } : {}),
    ...(t.status === 'done' ? { actualMin } : {}), // D-61
  });
  const initial = useRef(JSON.stringify(body()));
  const save = useAction((b: ReturnType<typeof body>) => patch(`/tasks/${t.id}`, b), {
    toast: 'Tâche enregistrée.',
  });
  /** D-40: closing (click outside, ✕) saves the fields if they changed; Escape discards. */
  const close = () => {
    const b = body();
    if (JSON.stringify(b) !== initial.current) {
      if (!b.title.trim()) return toast('Le titre est obligatoire.', 'error');
      if (f.actual.trim() && actualMin === null)
        return toast('Temps réel illisible : écris par exemple 1h30, 4h ou 45min.', 'error');
      save.mutate(b);
    }
    onClose();
  };
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
    <Panel open onClose={close} onCancel={onClose} title={t.title} hint={SAVE_HINT}>
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
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <Field label="Durée">
          <DurationSelect value={f.durationMin} onChange={(v) => set('durationMin', v)} />
        </Field>
        <Field label="Deadline">
          <input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </div>
      {t.status === 'done' && (
        <Field
          label="Temps réellement passé"
          info="Si la tâche a pris plus (ou moins) que prévu : 1h30, 4h, 45min… Vide = comme prévu. Les rapports comptent ce temps-là et comparent estimation et réel."
        >
          <input
            value={f.actual}
            onChange={(e) => set('actual', e.target.value)}
            placeholder={`comme prévu (${fmtMin(t.durationMin)})`}
          />
        </Field>
      )}
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
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
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
        <SearchSelect
          value=""
          onChange={(v) => v && addDep.mutate(v)}
          ariaLabel="Ajouter un prérequis"
          placeholder="+ Doit être fait après…"
          options={(siblings.data ?? [])
            .filter((s) => s.id !== t.id && !t.dependsOn.includes(s.id) && s.status !== 'cancelled')
            .map((s) => ({ value: s.id, label: s.title }))}
        />
      </div>

      <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="label-caps">Déplacer</div>
        <SearchSelect
          value={t.projectId ?? ''}
          onChange={(v) => v !== (t.projectId ?? '') && move.mutate(v || null)}
          ariaLabel="Déplacer vers"
          emptyLabel="Inbox"
          options={(projects.data ?? []).map((p) => ({
            value: p.id,
            label: p.title,
            hint: STATUS_LABEL[p.status],
          }))}
        />
      </div>
      <Resources ownerType="task" ownerId={t.id} resources={t.resources} />
    </Panel>
  );
}

function ResourceLink({ r }: { r: Resource }) {
  return /^https?:\/\//.test(r.url) ? (
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
  );
}

/** DM-70: links to documentation, read only (project and objective pages: edited in « Modifier »). */
export function ResourceList({ resources }: { resources: Resource[] }) {
  return (
    <div className="flex flex-col">
      {resources.map((r) => (
        <div key={r.id} className="row-line flex min-w-0 text-[14px]" style={{ padding: '9px 0' }}>
          <ResourceLink r={r} />
        </div>
      ))}
    </div>
  );
}

/** DM-70: links to documentation, with add / remove (saved at once). */
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
      {resources.length > 0 && (
        <div className="flex flex-col">
          {resources.map((r) => (
            <div key={r.id} className="row-line flex items-center justify-between gap-2 text-[14px]">
              <ResourceLink r={r} />
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
        </div>
      )}
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
