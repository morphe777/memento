// Tâches : vues Tableau et Kanban (decision D-33), on all live tasks or inside a project.
// Columns come from the API (`bucket`); dropping a card calls the matching API action.
import { DndContext, type DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Breadcrumb } from '../components/shell.tsx';
import { LockIcon, TaskDrawer, useSortSensors } from '../components/tasks.tsx';
import {
  DomainFilter,
  Duration,
  Empty,
  ErrorBox,
  ExperienceBadge,
  InfoTip,
  Loading,
  PageHeader,
  SearchSelect,
  Tabs,
  useTableSort,
} from '../components/ui.tsx';
import { get, post, put } from '../lib/api.ts';
import { fmtDateShort } from '../lib/format.ts';
import { toast, useAction, useDomainLookup } from '../lib/hooks.ts';
import type { BoardTask } from '../lib/types.ts';
import { Chevron } from './week.tsx';

export type TaskView = 'table' | 'kanban';
type Bucket = BoardTask['bucket'];

const COLUMNS: { bucket: Bucket; label: string; info: string }[] = [
  {
    bucket: 'waiting',
    label: 'En attente',
    info: 'Tâches bloquées par la tâche précédente du projet (projet séquentiel) ou par un prérequis. Elles passent seules en « À faire » quand ce qui les bloque est fait ou choisi pour la semaine.',
  },
  {
    bucket: 'todo',
    label: 'À faire',
    info: 'Tâches disponibles des projets actifs ou en pause, et de l’Inbox. Glisser vers « Cette semaine » pour les ajouter au plan de la semaine en cours.',
  },
  {
    bucket: 'week',
    label: 'Cette semaine',
    info: 'Tâches du plan de la semaine en cours (Semaine ou Bonus). Glisser vers « À faire » pour les retirer du plan.',
  },
  {
    bucket: 'done',
    label: 'Fait',
    info: 'Tâches faites depuis lundi. Glisser une carte ici la marque faite ; la sortir la rouvre.',
  },
];
/** Cards shown per Kanban column before « + N autres ». */
const BOARD_VISIBLE = 6;
const BUCKET_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.bucket, c.label])) as Record<Bucket, string>;

export function useBoardTasks(projectId?: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['tasks', 'board', projectId ?? 'all'],
    queryFn: () => get<BoardTask[]>(`/tasks/board${projectId ? `?projectId=${projectId}` : ''}`),
  });
}

export function TasksPage({ vue, tache }: { vue?: TaskView; tache?: string }) {
  const navigate = useNavigate();
  const view: TaskView = vue ?? 'kanban';
  const q = useBoardTasks();
  const [domains, setDomains] = useState<string[]>([]);
  const [projectId, setProjectId] = useState('');
  const all = q.data ?? [];
  const projects = [
    ...new Map(all.filter((t) => t.projectId).map((t) => [t.projectId!, t.projectTitle!])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const tasks = all.filter(
    (t) =>
      (!domains.length || (!!t.colorDomainId && domains.includes(t.colorDomainId))) &&
      (!projectId || (projectId === 'inbox' ? !t.projectId : t.projectId === projectId)),
  );
  const open = (id: string) => navigate({ to: '/taches', search: { vue, tache: id } });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Tâches' }]} />
        <PageHeader eyebrow="Projets actifs et en pause · Inbox · faites depuis lundi" title="Tâches" />
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <Tabs
          value={view}
          onChange={(v) => navigate({ to: '/taches', search: { vue: v } })}
          options={[
            { value: 'kanban', label: 'Kanban' },
            { value: 'table', label: 'Tableau' },
          ]}
        />

        <div style={{ width: 280 }}>
          <SearchSelect
            value={projectId}
            onChange={setProjectId}
            ariaLabel="Projet"
            emptyLabel="Tous les projets"
            options={[
              { value: 'inbox', label: 'Inbox' },
              ...projects.map(([id, title]) => ({ value: id, label: title })),
            ]}
          />
        </div>
      </div>
      <DomainFilter value={domains} onChange={setDomains} />
      {q.isError && <ErrorBox error={q.error} />}
      {q.isLoading && <Loading />}
      {q.data && view === 'kanban' && <TaskBoard tasks={tasks} onOpen={open} showProject />}
      {q.data && view === 'table' && <TaskTable tasks={tasks} onOpen={open} showProject />}
      <TaskDrawer taskId={tache ?? null} onClose={() => navigate({ to: '/taches', search: { vue } })} />
    </div>
  );
}

// ---------- Kanban ----------

export function TaskBoard({
  tasks,
  onOpen,
  showProject,
}: {
  tasks: BoardTask[];
  onOpen: (id: string) => void;
  showProject?: boolean;
}) {
  const sensors = useSortSensors();
  const move = useAction(async ({ t, to }: { t: BoardTask; to: Bucket }) => {
    if (to === 'done') return post(`/tasks/${t.id}/complete`);
    if (t.bucket === 'done') {
      await post(`/tasks/${t.id}/uncomplete`);
      if (to === 'week') return put(`/tasks/${t.id}/current-week`, { inWeek: true });
      return;
    }
    if (to === 'week') return put(`/tasks/${t.id}/current-week`, { inWeek: true });
    if (t.bucket === 'week') return put(`/tasks/${t.id}/current-week`, { inWeek: false });
  });
  const onDragEnd = (e: DragEndEvent) => {
    const t = tasks.find((x) => x.id === e.active.id);
    const to = e.over?.id as Bucket | undefined;
    if (!t || !to || to === t.bucket) return;
    if (to === 'waiting') {
      toast(
        '« En attente » se règle tout seul : la tâche s’y range quand elle attend une autre tâche.',
        'error',
      );
      return;
    }
    if (t.bucket === 'waiting' && to === 'todo') return;
    move.mutate({ t, to });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid-2x2">
        {COLUMNS.map((c) => (
          <BoardColumn
            key={c.bucket}
            column={c}
            tasks={tasks.filter((t) => t.bucket === c.bucket)}
            onOpen={onOpen}
            showProject={showProject}
          />
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  column,
  tasks,
  onOpen,
  showProject,
}: {
  column: (typeof COLUMNS)[number];
  tasks: BoardTask[];
  onOpen: (id: string) => void;
  showProject?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.bucket });
  const [showAll, setShowAll] = useState(false);
  const minutes = tasks.reduce((a, t) => a + (t.durationMin ?? 0), 0);
  return (
    <section
      ref={setNodeRef}
      className="bin flex flex-col gap-2.5"
      style={{ outline: isOver ? '2px dashed var(--text-ghost)' : undefined, minHeight: 160 }}
    >
      <div className="flex items-center gap-2">
        <h2 className="h2">{column.label}</h2>
        <span
          className="text-[12px] font-semibold rounded-full"
          style={{ background: 'var(--surface)', padding: '2px 9px' }}
        >
          {tasks.length}
        </span>
        <InfoTip align={column.bucket === 'done' || column.bucket === 'todo' ? 'right' : 'left'}>
          {column.info}
        </InfoTip>
        {minutes > 0 && (
          <span className="mono text-[12px] ml-auto" style={{ color: 'var(--text-faint)' }}>
            {Math.round((minutes / 60) * 10) / 10} h
          </span>
        )}
      </div>
      {(showAll ? tasks : tasks.slice(0, BOARD_VISIBLE)).map((t) => (
        <BoardCard key={t.id} t={t} onOpen={onOpen} showProject={showProject} />
      ))}
      {tasks.length > BOARD_VISIBLE && (
        <button
          type="button"
          className="flex items-center gap-2 border-0 bg-transparent text-left cursor-pointer text-[13px]"
          style={{ color: 'var(--text-muted)', minHeight: 32, padding: '0 4px' }}
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          <Chevron open={showAll} size={12} />
          {showAll ? 'Réduire' : `+ ${tasks.length - BOARD_VISIBLE} autres`}
        </button>
      )}
    </section>
  );
}

function BoardCard({
  t,
  onOpen,
  showProject,
}: {
  t: BoardTask;
  onOpen: (id: string) => void;
  showProject?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: t.id });
  const dl = useDomainLookup();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="card flex flex-col gap-1.5 cursor-grab"
      style={{
        padding: '10px 12px',
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        touchAction: 'none',
        zIndex: transform ? 10 : undefined,
        position: 'relative',
        opacity: t.bucket === 'done' ? 0.6 : 1,
      }}
    >
      <div className="flex items-start gap-2">
        <span className="dot" style={{ background: dl.color(t.colorDomainId), marginTop: 7 }} />
        <button
          type="button"
          className="flex-1 min-w-0 text-left border-0 bg-transparent p-0 text-[14px] font-medium cursor-pointer hover:underline"
          style={{ textDecoration: t.bucket === 'done' ? 'line-through' : undefined }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(t.id)}
        >
          {t.title}
        </button>
        <Duration min={t.durationMin} small />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
        {showProject &&
          (t.projectId ? (
            <Link
              to="/projets/$id"
              params={{ id: t.projectId }}
              className="truncate"
              style={{ maxWidth: '100%' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {t.projectTitle}
            </Link>
          ) : (
            <span>Inbox</span>
          ))}
        {t.isExperience && <ExperienceBadge />}
        {t.locked && <LockIcon />}
        {t.dueDate && <span style={{ color: 'var(--late-text)' }}>Deadline {fmtDateShort(t.dueDate)}</span>}
        {t.postponeCount > 0 && <span>Reportée {t.postponeCount}×</span>}
      </div>
    </div>
  );
}

// ---------- Tableau ----------

type SortKey = 'title' | 'project' | 'domain' | 'duration' | 'dueDate' | 'bucket' | 'postpone';
const BUCKET_ORDER: Record<Bucket, number> = { week: 0, todo: 1, waiting: 2, done: 3 };

export function TaskTable({
  tasks,
  onOpen,
  showProject,
}: {
  tasks: BoardTask[];
  onOpen: (id: string) => void;
  showProject?: boolean;
}) {
  const dl = useDomainLookup();
  const rank = (id: string | null) => dl.get(id ?? undefined)?.priorityRank ?? 99;
  const cmp: Record<SortKey, (a: BoardTask, b: BoardTask) => number> = {
    title: (a, b) => a.title.localeCompare(b.title),
    project: (a, b) => (a.projectTitle ?? '').localeCompare(b.projectTitle ?? ''),
    domain: (a, b) => rank(a.colorDomainId) - rank(b.colorDomainId),
    duration: (a, b) => (a.durationMin ?? 0) - (b.durationMin ?? 0),
    dueDate: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    bucket: (a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket],
    postpone: (a, b) => a.postponeCount - b.postponeCount,
  };
  const { sorted, th } = useTableSort(tasks, cmp, 'bucket', (a, b) => a.title.localeCompare(b.title));
  if (!tasks.length) return <Empty>Aucune tâche.</Empty>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {th('title', 'Tâche')}
            {showProject && th('project', 'Projet')}
            {th('domain', 'Domaine')}
            {th('bucket', 'État')}
            {th('dueDate', 'Deadline')}
            {th('postpone', 'Reports', 'right')}
            {th('duration', 'Durée', 'right')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr className="row-line" key={t.id} style={{ opacity: t.bucket === 'done' ? 0.55 : 1 }}>
              <td className="py-2.5 px-3">
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-left border-0 bg-transparent p-0 font-medium cursor-pointer hover:underline"
                    onClick={() => onOpen(t.id)}
                  >
                    {t.title}
                  </button>
                  {t.isExperience && <ExperienceBadge />}
                  {t.locked && (
                    <span style={{ color: 'var(--text-faint)' }}>
                      <LockIcon />
                    </span>
                  )}
                </span>
              </td>
              {showProject && (
                <td className="py-2.5 px-3">
                  {t.projectId ? (
                    <Link to="/projets/$id" params={{ id: t.projectId }}>
                      {t.projectTitle}
                    </Link>
                  ) : (
                    <Link to="/inbox">Inbox</Link>
                  )}
                </td>
              )}
              <td className="py-2.5 px-3 whitespace-nowrap">
                <span className="flex items-center gap-2">
                  <span className="dot" style={{ background: dl.color(t.colorDomainId) }} />
                  {dl.name(t.colorDomainId)}
                </span>
              </td>
              <td className="py-2.5 px-3 whitespace-nowrap">{BUCKET_LABEL[t.bucket]}</td>
              <td className="py-2.5 px-3 mono text-[13px] whitespace-nowrap">
                {t.dueDate ? fmtDateShort(t.dueDate) : '—'}
              </td>
              <td className="py-2.5 px-3 mono text-[13px] text-right">{t.postponeCount || '—'}</td>
              <td className="py-2.5 px-3 text-right">
                <Duration min={t.durationMin} small />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
