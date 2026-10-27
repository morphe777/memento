// Projets (V-04, V-05, V-10), Projet (V-03), Idées (DM-90). No mockup: built from the mockups' components.
import { DndContext, type DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { BreakdownButton } from '../components/breakdown.tsx';
import { DescriptionBlock, PencilIcon } from '../components/markdown.tsx';
import { Breadcrumb } from '../components/shell.tsx';
import {
  GroupPicker,
  QuickAdd,
  ResourceList,
  Resources,
  TaskDrawer,
  TaskList,
  useSortSensors,
} from '../components/tasks.tsx';
import {
  ConfirmDialog,
  DomainFilter,
  Empty,
  ErrorBox,
  Field,
  InfoTip,
  Loading,
  PageHeader,
  Panel,
  SAVE_HINT,
  SearchSelect,
  Section,
  StatusPill,
  Tabs,
  useTableSort,
} from '../components/ui.tsx';
import { ApiError, del, get, patch, post, put } from '../lib/api.ts';
import { fmtDate, fmtMin, STATUS_LABEL } from '../lib/format.ts';
import { toast, useAction, useDomainLookup, useGroups, useMe, useSettings } from '../lib/hooks.ts';
import type { InboxPage as InboxPageData, Objective, Project, ProjectDetail, Task } from '../lib/types.ts';
import { TaskBoard, TaskTable, type TaskView, useBoardTasks } from './tasks.tsx';
import { Chevron } from './week.tsx';

type View = 'tree' | 'list' | 'kanban';

function ProjectLine({ p, muted, accent }: { p: Project; muted?: boolean; accent?: string }) {
  const dl = useDomainLookup();
  return (
    <Link
      to="/projets/$id"
      params={{ id: p.id }}
      className="row-line flex items-center gap-3 hover:no-underline"
      style={{
        padding: '10px 16px',
        opacity: muted ? 0.6 : 1,
        borderLeft: accent ? `3px solid ${accent}` : undefined,
      }}
    >
      <span className="dot" style={{ background: dl.color(p.domainIds[0]) }} />
      <span className="flex-1 min-w-0 text-[15px] font-medium truncate hover:underline">
        {p.title}
        {p.groupIds.length > 1 && (
          <svg
            role="img"
            aria-label="Projet dans plusieurs groupes"
            width="13"
            height="13"
            viewBox="0 0 16 16"
            className="inline-block ml-2 align-[-1px]"
            style={{ color: 'var(--text-ghost)' }}
          >
            <path
              d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      {p.monthFlag && <StatusPill>Projet du mois</StatusPill>}
      <StatusPill tone={p.status === 'active' ? 'ok' : 'neutral'}>{STATUS_LABEL[p.status]}</StatusPill>
      <span
        className="mono text-[12px] flex-none"
        style={{ color: 'var(--text-faint)', width: 90, textAlign: 'right' }}
      >
        {fmtMin(p.taskStats.doneMin)} / {fmtMin(p.taskStats.totalMin)}
      </span>
    </Link>
  );
}

/** Month choices of the « projets du mois » filter: 6 months back, 3 ahead. */
function monthChoices(today: string | undefined) {
  if (!today) return [];
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + 3 - i, 15));
    return {
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    };
  });
}

export function ProjectsPage({ groupe, vue, filtre }: { groupe?: string; vue?: View; filtre?: string }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const me = useMe();
  const view: View =
    filtre === 'a-completer' ? 'list' : (vue ?? settings.data?.['ui.projects_default_view'] ?? 'tree');
  const [domainFilter, setDomainFilter] = useState<string[]>([]);
  // Arriving on a group (sidebar link): show all its projects, whatever the domain filter was.
  useEffect(() => {
    if (groupe) setDomainFilter([]);
  }, [groupe]);
  const byDomain = (p: Project) => !domainFilter.length || p.domainIds.some((d) => domainFilter.includes(d));
  const [status, setStatus] = useState('active,ready,paused');
  // Finished projects (done / abandoned) stay out of every view unless this box is checked.
  const [showClosed, setShowClosed] = useState(false);
  const statusQuery = (status || 'idea,ready,active,paused') + (showClosed ? ',done,abandoned' : '');
  const incomplete = useQuery({
    queryKey: ['projects', 'ready'],
    queryFn: () => get<Project[]>('/projects?status=ready'),
    select: (ps) => ps.filter((p) => p.gaps.length > 0),
  });
  const [month, setMonth] = useState('');
  const q = useQuery({
    queryKey: ['projects', statusQuery, month],
    queryFn: () => get<Project[]>(`/projects?status=${statusQuery}${month ? `&month=${month}` : ''}`),
    enabled: view !== 'kanban',
  });
  const all = useQuery({
    queryKey: ['projects', 'kanban'],
    queryFn: () => get<Project[]>('/projects'),
    enabled: view === 'kanban',
  });
  const groups = useGroups();
  const dl = useDomainLookup();
  const [creating, setCreating] = useState(false);
  const group = groups.data?.find((g) => g.id === groupe);
  const list =
    filtre === 'a-completer'
      ? (incomplete.data ?? [])
      : (q.data ?? []).filter((p) => (!groupe || p.groupIds.includes(groupe)) && byDomain(p));
  const nIncomplete = incomplete.data?.length ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb
          items={
            group
              ? [
                  { label: 'Projets', to: '/projets' },
                  { label: dl.name(group.domainId) },
                  { label: group.name },
                ]
              : [{ label: 'Projets' }]
          }
        />
        <PageHeader
          eyebrow={group ? `Groupe · ${dl.name(group.domainId)}` : 'Domaine › Groupe › Projet'}
          title={filtre === 'a-completer' ? 'Projets prêts à compléter' : group ? group.name : 'Projets'}
          actions={
            <>
              {nIncomplete > 0 && filtre !== 'a-completer' && (
                <Link
                  to="/projets"
                  search={{ filtre: 'a-completer' }}
                  className="text-[13px] font-semibold flex items-center gap-1.5"
                  style={{ color: 'var(--status-red)' }}
                >
                  {nIncomplete} projet{nIncomplete > 1 ? 's' : ''} prêt{nIncomplete > 1 ? 's' : ''} à
                  compléter avant d'en faire un projet du mois →
                </Link>
              )}
              {filtre === 'a-completer' && (
                <Link to="/projets" className="btn">
                  Tous les projets
                </Link>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                + Projet / idée
              </button>
            </>
          }
        />
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <Tabs
          value={view}
          onChange={(v) => navigate({ to: '/projets', search: { groupe, vue: v } })}
          options={[
            { value: 'tree', label: 'Arborescence' },
            { value: 'list', label: 'Liste' },
            { value: 'kanban', label: 'Kanban' },
          ]}
        />
        {view !== 'kanban' && filtre !== 'a-completer' && (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
              <option value="active,ready,paused">Actifs, prêts et en pause</option>
              <option value="active">Actifs (projets du mois)</option>
              <option value="ready">Prêts</option>
              <option value="paused">En pause</option>
              <option value="idea">Idées</option>
              <option value="">Tous (en cours)</option>
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Projets du mois">
              <option value="">Tous les mois</option>
              {monthChoices(me.data?.today).map((m) => (
                <option key={m.value} value={m.value}>
                  Projets du mois : {m.label}
                </option>
              ))}
            </select>
          </>
        )}
        {filtre !== 'a-completer' && (
          <label className="flex items-center gap-2 text-[14px] cursor-pointer">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Afficher les terminés / abandonnés
          </label>
        )}
      </div>
      {filtre !== 'a-completer' && <DomainFilter value={domainFilter} onChange={setDomainFilter} />}
      {q.isError && <ErrorBox error={q.error} />}
      {view === 'tree' && <ProjectTree projects={list} />}
      {view === 'list' && <ProjectTable projects={list} />}
      {view === 'kanban' && (
        <Kanban
          showClosed={showClosed}
          projects={(all.data ?? []).filter((p) => (!groupe || p.groupIds.includes(groupe)) && byDomain(p))}
        />
      )}
      <NewProjectPanel open={creating} onClose={() => setCreating(false)} defaultGroup={groupe} />
    </div>
  );
}

/** V-10: Domain › Group › Project, readable at a glance; a project in 2 groups appears in both. */
function ProjectTree({ projects }: { projects: Project[] }) {
  const dl = useDomainLookup();
  const groups = useGroups();
  return (
    <div className="flex flex-col gap-5">
      {dl.domains.map((d) => {
        const gs = (groups.data ?? [])
          .filter((g) => g.domainId === d.id)
          .map((g) => ({ g, ps: projects.filter((p) => p.groupIds.includes(g.id)) }))
          .filter((x) => x.ps.length);
        if (!gs.length) return null;
        return (
          <section key={d.id} className="bin flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span className="dot" style={{ width: 10, height: 10, background: dl.colorOf(d) }} />
              <Link to="/domaines/$id" params={{ id: d.id }} className="h2-bin">
                {d.name}
              </Link>
            </div>
            {gs.map(({ g, ps }) => (
              <div key={g.id} className="card overflow-hidden">
                <div
                  className="flex items-center justify-between"
                  style={{
                    padding: '9px 16px',
                    borderBottom: '1px solid var(--divider-2)',
                    background: 'var(--surface-2)',
                  }}
                >
                  <Link
                    to="/projets"
                    search={{ groupe: g.id }}
                    className="text-[12px] font-semibold uppercase"
                    style={{ letterSpacing: '0.08em', color: 'var(--text-muted)' }}
                  >
                    {g.name}
                  </Link>
                  <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    {ps.length} projet{ps.length > 1 ? 's' : ''}
                  </span>
                </div>
                {ps.map((p) => (
                  <ProjectLine key={p.id} p={p} />
                ))}
              </div>
            ))}
          </section>
        );
      })}
      {projects.length === 0 && <Empty>Aucun projet avec ces filtres.</Empty>}
    </div>
  );
}

const PROJECT_STATUS_ORDER: Record<string, number> = {
  active: 0,
  ready: 1,
  paused: 2,
  idea: 3,
  done: 4,
  abandoned: 5,
};

type ProjectSort = 'title' | 'domain' | 'status' | 'dueDate' | 'progress';

function ProjectTable({ projects }: { projects: Project[] }) {
  const dl = useDomainLookup();
  const cmp: Record<ProjectSort, (a: Project, b: Project) => number> = {
    title: (a, b) => a.title.localeCompare(b.title),
    domain: (a, b) =>
      (dl.get(a.domainIds[0])?.priorityRank ?? 99) - (dl.get(b.domainIds[0])?.priorityRank ?? 99),
    status: (a, b) => (PROJECT_STATUS_ORDER[a.status] ?? 9) - (PROJECT_STATUS_ORDER[b.status] ?? 9),
    dueDate: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    progress: (a, b) =>
      a.taskStats.doneMin / (a.taskStats.totalMin || 1) - b.taskStats.doneMin / (b.taskStats.totalMin || 1),
  };
  const { sorted, th } = useTableSort(projects, cmp, 'title', (a, b) => a.title.localeCompare(b.title));
  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {th('title', 'Projet')}
            {th('domain', 'Domaine')}
            {th('status', 'Statut')}
            {th('dueDate', 'Échéance')}
            {th('progress', 'Fait / total', 'right')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr className="row-line" key={p.id}>
              <td className="py-2.5 px-3">
                <Link to="/projets/$id" params={{ id: p.id }} className="font-medium">
                  {p.title}
                </Link>
              </td>
              <td className="py-2.5 px-3">
                <span className="flex items-center gap-2">
                  <span className="dot" style={{ background: dl.color(p.domainIds[0]) }} />
                  {dl.name(p.domainIds[0])}
                </span>
              </td>
              <td className="py-2.5 px-3">{STATUS_LABEL[p.status]}</td>
              <td className="py-2.5 px-3 mono text-[13px]">{p.dueDate ? fmtDate(p.dueDate) : '—'}</td>
              <td className="py-2.5 px-3 mono text-[13px] text-right">
                {fmtMin(p.taskStats.doneMin)} / {fmtMin(p.taskStats.totalMin)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <Empty>Aucun projet.</Empty>}
    </div>
  );
}

export const RECURRENCE_LABEL: Record<string, string> = {
  monthly: 'chaque mois',
  quarterly: 'chaque trimestre',
  yearly: 'chaque année',
};

const KANBAN = [
  { status: 'idea', label: 'Idées' },
  { status: 'ready', label: 'Prêts' },
  { status: 'active', label: 'Actifs (du mois)' },
  { status: 'paused', label: 'En pause' },
  { status: 'done', label: 'Terminés' },
] as const;

/** Kanban by project status (D-19, D-42). Moving a card calls the matching API action. */
function Kanban({ projects, showClosed }: { projects: Project[]; showClosed: boolean }) {
  const sensors = useSortSensors();
  const me = useMe();
  const [completing, setCompleting] = useState<Project | null>(null);
  const move = useAction(async ({ p, to }: { p: Project; to: string }) => {
    if (to === 'ready' && p.status === 'idea') return post(`/projects/${p.id}/promote`);
    if (to === 'active') {
      if (p.status === 'paused') await patch(`/projects/${p.id}`, { status: 'ready' });
      return post(`/projects/${p.id}/month`, { month: me.data?.today.slice(0, 7) });
    }
    if (to === 'ready' && p.status === 'active') return post(`/projects/${p.id}/month`, { month: null });
    return patch(`/projects/${p.id}`, { status: to });
  });
  const onDragEnd = (e: DragEndEvent) => {
    const p = projects.find((x) => x.id === e.active.id);
    const to = e.over?.id as string | undefined;
    if (!p || !to || to === p.status) return;
    if (to === 'done') setCompleting(p);
    else move.mutate({ p, to });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {KANBAN.map((c) => (
          <KanbanColumn
            key={c.status}
            id={c.status}
            label={c.label}
            projects={projects.filter((p) => p.status === c.status)}
            hidden={c.status === 'done' && !showClosed}
          />
        ))}
      </div>
      <CompletePanel project={completing} onClose={() => setCompleting(null)} />
    </DndContext>
  );
}

/** Cards shown per Kanban column before « + N autres ». */
const KANBAN_VISIBLE = 6;

/** `hidden`: the column stays a drop target (to complete a project) but does not list its cards. */
function KanbanColumn({
  id,
  label,
  projects: all,
  hidden,
}: {
  id: string;
  label: string;
  projects: Project[];
  hidden?: boolean;
}) {
  const projects = hidden ? [] : all;
  const { setNodeRef, isOver } = useDroppable({ id });
  const [showAll, setShowAll] = useState(false);
  return (
    <section
      ref={setNodeRef}
      className="bin flex flex-col gap-2.5"
      style={{ outline: isOver ? '2px dashed var(--text-ghost)' : undefined, minHeight: 160 }}
    >
      <div className="flex items-baseline gap-2.5">
        <h2 className="h2">{label}</h2>
        <span
          className="text-[12px] font-semibold rounded-full"
          style={{ background: 'var(--surface)', padding: '2px 9px' }}
        >
          {hidden ? '—' : projects.length}
        </span>
      </div>
      {hidden && (
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-faint)' }}>
          Masqués. Coche « Afficher les terminés / abandonnés ». Dépose ici pour terminer un projet.
        </p>
      )}
      {(showAll ? projects : projects.slice(0, KANBAN_VISIBLE)).map((p) => (
        <KanbanCard key={p.id} p={p} />
      ))}
      {projects.length > KANBAN_VISIBLE && (
        <button
          type="button"
          className="flex items-center gap-2 border-0 bg-transparent text-left cursor-pointer text-[13px]"
          style={{ color: 'var(--text-muted)', minHeight: 32, padding: '0 4px' }}
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          <Chevron open={showAll} size={12} />
          {showAll ? 'Réduire' : `+ ${projects.length - KANBAN_VISIBLE} autres`}
        </button>
      )}
    </section>
  );
}

function KanbanCard({ p }: { p: Project }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: p.id });
  const dl = useDomainLookup();
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="card flex flex-col gap-1 cursor-grab"
      style={{
        padding: '10px 12px',
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        touchAction: 'none',
        zIndex: transform ? 10 : undefined,
        position: 'relative',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="dot" style={{ background: dl.color(p.domainIds[0]) }} />
        <Link
          to="/projets/$id"
          params={{ id: p.id }}
          className="text-[14px] font-medium"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {p.title}
        </Link>
      </div>
      <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
        {p.taskStats.todo} à faire · {fmtMin(p.taskStats.totalMin - p.taskStats.doneMin)} restantes
      </span>
    </div>
  );
}

function CompletePanel({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const complete = useAction((success: boolean) => post(`/projects/${project!.id}/complete`, { success }), {
    onSuccess: onClose,
    toast: 'Projet terminé.',
  });
  return (
    <Panel open={!!project} onClose={onClose} title="Terminer le projet" side={false} width={460}>
      <p className="m-0 text-[15px]">
        Critère de succès atteint ?<br />
        <span className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
          « {project?.successCriterion || 'non renseigné'} »
        </span>
      </p>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn" onClick={() => complete.mutate(false)}>
          Non
        </button>
        <button type="button" className="btn btn-primary" onClick={() => complete.mutate(true)}>
          Oui
        </button>
      </div>
    </Panel>
  );
}

export function NewProjectPanel({
  open,
  onClose,
  defaultGroup,
}: {
  open: boolean;
  onClose: () => void;
  defaultGroup?: string;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>(defaultGroup ? [defaultGroup] : []);
  const create = useAction(() => post<Project>('/projects', { title, groupIds }), {
    onSuccess: (p) => {
      onClose();
      setTitle('');
      navigate({ to: '/projets/$id', params: { id: p.id } });
    },
  });
  return (
    <Panel open={open} onClose={onClose} title="Nouvelle idée / nouveau projet">
      <p className="m-0 text-[14px]" style={{ color: 'var(--text-muted)' }}>
        Tout commence en idée : un titre et un groupe suffisent. Tu la promeus en projet quand elle est prête
        (critère de succès, dates, tâches).
      </p>
      <Field label="Titre">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ex. Installer des panneaux photovoltaïques"
        />
      </Field>
      <div className="field">
        <span>Groupe(s) — les domaines s'en déduisent</span>
        <GroupPicker value={groupIds} onChange={setGroupIds} />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!title.trim() || !groupIds.length || create.isPending}
          onClick={() => create.mutate(undefined)}
        >
          Créer l'idée
        </button>
      </div>
    </Panel>
  );
}

export function ProjectPage({ id, tache, vue }: { id: string; tache?: string; vue?: TaskView }) {
  const navigate = useNavigate();
  const board = useBoardTasks(id, !!vue);
  const q = useQuery({ queryKey: ['project', id], queryFn: () => get<ProjectDetail>(`/projects/${id}`) });
  const tasks = useQuery({ queryKey: ['tasks', id], queryFn: () => get<Task[]>(`/tasks?projectId=${id}`) });
  const dl = useDomainLookup();
  const [editing, setEditing] = useState(false);
  const saveDescription = useAction((description: string) => patch(`/projects/${id}`, { description }), {
    toast: 'Description enregistrée.',
  });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const p = q.data;
  const color = dl.color(p.domainIds[0]);
  const mainGroup = p.groups.find((g) => g.domainId === p.primaryDomainId) ?? p.groups[0];
  const openTask = (tid: string) =>
    navigate({ to: '/projets/$id', params: { id }, search: { tache: tid, vue } });
  return (
    <div
      className="flex flex-col gap-5"
      style={{ borderTop: `3px solid ${color}`, paddingTop: 12, marginTop: -12 }}
    >
      <div>
        <Breadcrumb
          items={[
            { label: 'Projets', to: '/projets' },
            {
              label: dl.name(p.primaryDomainId),
              to: '/domaines/$id',
              params: { id: p.primaryDomainId ?? '' },
            },
            ...(mainGroup
              ? [{ label: mainGroup.name, to: '/projets', search: { groupe: mainGroup.id } }]
              : []),
            { label: p.title },
          ]}
        />
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              <span className="dot" style={{ background: color }} />
              {p.domainIds.map((d) => dl.name(d)).join(' · ')} · {STATUS_LABEL[p.status]}
              {p.success !== null && p.status === 'done' && (p.success ? ' · réussi' : ' · échec')}
            </span>
          }
          title={p.title}
          actions={<ProjectActions p={p} />}
        />
      </div>
      <DescriptionBlock
        text={p.description}
        ai={{ kind: 'project', id: p.id }}
        lines={6}
        saving={saveDescription.isPending}
        onSave={(text, done) => saveDescription.mutate(text, { onSuccess: done })}
      />
      <div className="flex flex-wrap gap-6 items-start">
        <section className="card overflow-hidden min-w-0" style={{ flex: '999 1 560px' }}>
          <div
            className="flex justify-between items-center gap-3 flex-wrap"
            style={{ padding: '14px 20px', borderBottom: '1px solid var(--divider-2)' }}
          >
            <h2 className="h2">{vue ? 'Tâches' : "Tâches · dans l'ordre d'exécution"}</h2>
            <Tabs
              value={vue ?? 'list'}
              onChange={(v) =>
                navigate({
                  to: '/projets/$id',
                  params: { id },
                  search: { vue: v === 'list' ? undefined : v },
                })
              }
              options={[
                { value: 'list', label: 'Liste' },
                { value: 'table', label: 'Tableau' },
                { value: 'kanban', label: 'Kanban' },
              ]}
            />
          </div>
          {!vue && (
            <div
              className="text-[13px]"
              style={{
                color: 'var(--text-faint)',
                padding: '8px 20px',
                borderBottom: '1px solid var(--divider)',
              }}
            >
              {p.sequenceMode === 'sequential'
                ? 'Séquentiel : glisser pour réordonner'
                : 'Parallèle : toutes disponibles'}
            </div>
          )}
          {!vue && tasks.data && (
            <TaskList tasks={tasks.data} projectId={p.id} color={() => color} onOpen={openTask} />
          )}
          {vue && board.data && (
            <div style={{ padding: vue === 'kanban' ? 12 : 0 }}>
              {vue === 'kanban' ? (
                <TaskBoard tasks={board.data} onOpen={openTask} />
              ) : (
                <TaskTable tasks={board.data} onOpen={openTask} />
              )}
            </div>
          )}
          <div style={{ padding: '12px 16px', background: 'var(--surface-2)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-0">
                <QuickAdd projectId={p.id} placeholder="Nouvelle tâche…" defaultDuration={60} />
              </div>
              <BreakdownButton projectId={p.id} description={p.description} />
            </div>
          </div>
        </section>
        <aside className="flex flex-col gap-4 min-w-0" style={{ flex: '1 1 300px', maxWidth: 420 }}>
          <ProjectInfo p={p} onEdit={() => setEditing(true)} />
          {p.resources.length > 0 && (
            <Section title="Ressources">
              <ResourceList resources={p.resources} />
            </Section>
          )}
        </aside>
      </div>
      {editing && <ProjectEditPanel p={p} open onClose={() => setEditing(false)} />}
      <TaskDrawer
        taskId={tache ?? null}
        onClose={() => navigate({ to: '/projets/$id', params: { id }, search: { vue } })}
      />
    </div>
  );
}

const IMPORTANCE_LABEL = { low: 'Basse', normal: 'Normale', high: 'Haute' } as const;

/** Monochrome 16 px line icons of the project facts: the setup reads at a glance (user request 25/10/2026). */
function FactIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    dates: (
      <>
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.6" />
        <path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" />
      </>
    ),
    objective: (
      <>
        <circle cx="8" cy="8" r="5.8" />
        <circle cx="8" cy="8" r="3.2" />
        <circle cx="8" cy="8" r="0.9" fill="currentColor" />
      </>
    ),
    high: <path d="M4 10.5 8 6.5l4 4M4 6.5l4-4 4 4" />,
    normal: <path d="M4 6.5h8M4 9.5h8" />,
    low: <path d="M4 5.5l4 4 4-4M4 9.5l4 4 4-4" />,
    sequential: (
      <>
        <circle cx="3" cy="8" r="1.6" />
        <circle cx="8" cy="8" r="1.6" />
        <circle cx="13" cy="8" r="1.6" />
        <path d="M4.6 8h1.8M9.6 8h1.8" />
      </>
    ),
    parallel: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
    recurrence: <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.6h-2.6" />,
  };
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
      style={{ color: 'var(--text-faint)', marginTop: 2 }}
    >
      {paths[name]}
    </svg>
  );
}

/** Read-only facts of the project (edit through « Modifier »). */
function ProjectInfo({ p, onEdit }: { p: ProjectDetail; onEdit: () => void }) {
  const dl = useDomainLookup();
  const me = useMe();
  const today = me.data?.today;
  const daysLeft =
    p.dueDate && today ? Math.round((Date.parse(p.dueDate) - Date.parse(today)) / 86_400_000) : null;
  const pct = p.taskStats.totalMin ? Math.round((p.taskStats.doneMin / p.taskStats.totalMin) * 100) : 0;
  const row = (label: string, value: React.ReactNode, icon?: string) => (
    <div className="row-line flex flex-col gap-0.5" style={{ padding: '10px 0' }}>
      <span className="label-caps" style={{ fontSize: 11 }}>
        {label}
      </span>
      <span className="text-[14px] flex items-start gap-2 min-w-0" style={{ color: 'var(--text-2)' }}>
        {icon && <FactIcon name={icon} />}
        <span className="min-w-0">{value}</span>
      </span>
    </div>
  );
  const ready = p.readiness.every((r) => r.ok);
  return (
    <section className="card relative" style={{ padding: '6px 48px 8px 18px' }}>
      <button
        type="button"
        className="icon-btn absolute"
        style={{ top: 8, right: 8 }}
        aria-label="Modifier le projet"
        title="Modifier le projet"
        onClick={onEdit}
      >
        <PencilIcon />
      </button>
      {(p.status === 'idea' || p.status === 'ready' || p.status === 'paused') && (
        <div className="row-line flex flex-col gap-1.5" style={{ padding: '12px 0' }}>
          <span className="label-caps flex items-center gap-1.5" style={{ fontSize: 11 }}>
            Projet complet ?
            <InfoTip>
              Ce qu'un projet doit avoir pour être complet. Une idée peut passer « prêt » sans l'être : elle
              est alors signalée « à compléter ». Seul un projet complet peut devenir projet du mois (actif).
              Les dates sont facultatives : le mois sert de limite.
            </InfoTip>
          </span>
          {p.readiness.map((r) => (
            <span
              key={r.code}
              className="flex items-center gap-2 text-[14px]"
              style={{ color: r.ok ? 'var(--text-faint)' : 'var(--text)' }}
            >
              <span
                aria-hidden
                className="grid place-items-center rounded-full flex-none text-[11px]"
                style={{
                  width: 18,
                  height: 18,
                  background: r.ok ? 'var(--status-green)' : 'transparent',
                  border: r.ok ? 0 : '1.5px solid var(--late-bar)',
                  color: '#fff',
                }}
              >
                {r.ok ? '✓' : ''}
              </span>
              <span className="sr-only">{r.ok ? 'Fait :' : 'Manque :'}</span>
              {r.label}
            </span>
          ))}
          <span className="text-[12px]" style={{ color: ready ? 'var(--ok)' : 'var(--text-faint)' }}>
            {ready
              ? 'Complet : il peut devenir projet du mois.'
              : 'Complète via « Modifier » et la liste des tâches.'}
          </span>
        </div>
      )}
      {row(
        'Avancement',
        <span className="flex flex-col gap-1.5">
          <span>
            <span className="mono text-[13px]">
              {fmtMin(p.taskStats.doneMin)} / {fmtMin(p.taskStats.totalMin)}
            </span>{' '}
            · {p.taskStats.done} faite
            {p.taskStats.done > 1 ? 's' : ''}, {p.taskStats.todo} à faire
          </span>
          <span className="track block" style={{ height: 6 }}>
            <span
              className="block h-full"
              style={{ width: `${pct}%`, background: dl.color(p.domainIds[0]) }}
            />
          </span>
        </span>,
      )}
      {row(
        'Critère de succès',
        p.successCriterion || <span style={{ color: 'var(--text-faint)' }}>À définir</span>,
      )}
      {row(
        'Dates',
        p.startDate || p.dueDate ? (
          <span>
            {p.startDate ? fmtDate(p.startDate) : '…'} → {p.dueDate ? fmtDate(p.dueDate) : '…'}
            {daysLeft !== null && p.status === 'active' && (
              <span style={{ color: daysLeft < 0 ? 'var(--late-text)' : 'var(--text-faint)' }}>
                {' '}
                · {daysLeft < 0 ? `${-daysLeft} j de retard` : `${daysLeft} j restants`}
              </span>
            )}
            {p.replannedAt && (
              <span className="block text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Replanifié le {fmtDate(p.replannedAt)}
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>Non planifié</span>
        ),
        'dates',
      )}
      {row(
        'Objectif',
        p.objectiveId ? (
          <Link to="/objectifs/$id" params={{ id: p.objectiveId }}>
            {p.objectiveTitle}
          </Link>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>Hors objectif</span>
        ),
        'objective',
      )}
      {row(
        'Groupes',
        <span className="flex flex-wrap gap-1.5 pt-0.5">
          {p.groups.map((g) => (
            <Link
              key={g.id}
              to="/projets"
              search={{ groupe: g.id }}
              className="flex items-center gap-1.5 rounded-full text-[12px]"
              style={{ border: '1px solid var(--border)', padding: '2px 9px' }}
            >
              <span className="dot" style={{ background: dl.color(g.domainId), width: 6, height: 6 }} />
              {g.name}
            </Link>
          ))}
        </span>,
      )}
      {p.recurrence &&
        row(
          'Récurrence',
          <span>{RECURRENCE_LABEL[p.recurrence]} · recréé à la fin du projet</span>,
          'recurrence',
        )}
      {row('Importance', IMPORTANCE_LABEL[p.importance], p.importance)}
      {row(
        'Organisation',
        <span>
          {p.sequenceMode === 'sequential' ? 'Séquentiel' : 'Parallèle'}
          {p.isFree ? ' · libre dans le chemin' : ''}
          {p.monthFlag ? ` · projet du mois (${p.monthFlag})` : ''}
        </span>,
        p.sequenceMode,
      )}
    </section>
  );
}

function ProjectActions({ p }: { p: ProjectDetail }) {
  const me = useMe();
  const [completing, setCompleting] = useState(false);
  const [gaps, setGaps] = useState<{ code: string; label: string }[] | null>(null);
  const promote = useAction(() => post(`/projects/${p.id}/promote`), { toast: 'Idée promue : projet prêt.' });
  const month = useAction((m: string | null) => post(`/projects/${p.id}/month`, { month: m }), {
    toast: 'Projets du mois mis à jour.',
  });
  const status = useAction((s: string) => patch(`/projects/${p.id}`, { status: s }));
  const makeMonth = () =>
    month.mutate(me.data?.today.slice(0, 7) ?? null, {
      onError: (e) => {
        if (e instanceof ApiError && Array.isArray(e.details)) setGaps(e.details as never);
      },
    });
  return (
    <>
      {p.status === 'idea' && (
        <button type="button" className="btn btn-primary" onClick={() => promote.mutate(undefined)}>
          Promouvoir en projet prêt
        </button>
      )}
      {p.status === 'ready' && (
        <button type="button" className="btn btn-primary" onClick={makeMonth}>
          {p.monthFlag ? `Prévu pour ${p.monthFlag} · le faire ce mois-ci` : 'Projet du mois'}
        </button>
      )}
      {p.status === 'active' && (
        <button type="button" className="btn" onClick={() => month.mutate(null)}>
          Retirer du mois
        </button>
      )}
      {(p.status === 'active' || p.status === 'ready') && (
        <button type="button" className="btn" onClick={() => status.mutate('paused')}>
          Mettre en pause
        </button>
      )}
      {p.status === 'paused' && (
        <button type="button" className="btn btn-primary" onClick={() => status.mutate('ready')}>
          Reprendre
        </button>
      )}
      {['active', 'ready', 'paused'].includes(p.status) && (
        <button
          type="button"
          className={p.status === 'active' ? 'btn btn-primary' : 'btn'}
          onClick={() => setCompleting(true)}
        >
          Terminer
        </button>
      )}
      {p.status !== 'abandoned' && p.status !== 'done' && (
        <button type="button" className="btn btn-ghost" onClick={() => status.mutate('abandoned')}>
          Abandonner
        </button>
      )}
      {p.status === 'abandoned' && (
        <button type="button" className="btn" onClick={() => status.mutate('idea')}>
          Remettre en idée
        </button>
      )}
      {p.status === 'done' && (
        <button type="button" className="btn" onClick={() => status.mutate('ready')}>
          Rouvrir
        </button>
      )}
      <CompletePanel project={completing ? p : null} onClose={() => setCompleting(false)} />
      <Panel
        open={!!gaps}
        onClose={() => setGaps(null)}
        title="Pas encore prêt pour le mois"
        side={false}
        width={480}
      >
        <p className="m-0 text-[14px]" style={{ color: 'var(--text-muted)' }}>
          Il manque :
        </p>
        <ul className="m-0 pl-5 flex flex-col gap-1 text-[15px]">
          {gaps?.map((g) => (
            <li key={g.code}>{g.label}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

/** A titled group of fields in an edit panel (same look as the task drawer sections). */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="label-caps">{title}</div>
      {children}
    </div>
  );
}

/** « Modifier le projet »: every editable field in one dialog (description is edited in place under the title). */
function ProjectEditPanel({ p, open, onClose }: { p: ProjectDetail; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const dl = useDomainLookup();
  const groups = useGroups();
  const objectives = useQuery({ queryKey: ['objectives'], queryFn: () => get<Objective[]>('/objectives') });
  const [f, setF] = useState({
    title: p.title,
    successCriterion: p.successCriterion,
    startDate: p.startDate ?? '',
    dueDate: p.dueDate ?? '',
    objectiveId: p.objectiveId ?? '',
    sequenceMode: p.sequenceMode,
    isFree: p.isFree,
    importance: p.importance,
    recurrence: p.recurrence ?? '',
  });
  const [groupIds, setGroupIds] = useState(p.groupIds);
  const [primary, setPrimary] = useState(p.primaryDomainId ?? '');
  const [deleting, setDeleting] = useState(false);
  const domains = [
    ...new Set(
      groupIds.map((g) => groups.data?.find((x) => x.id === g)?.domainId).filter((x): x is string => !!x),
    ),
  ];
  const snapshot = () => JSON.stringify({ f, groupIds, primary });
  const initial = useRef(snapshot());
  const save = useAction(
    async () => {
      const groupsChanged =
        groupIds.join() !== p.groupIds.join() || (primary || null) !== (p.primaryDomainId ?? null);
      if (groupsChanged)
        await put(`/projects/${p.id}/groups`, {
          groupIds,
          primaryDomainId: domains.includes(primary) ? primary : null,
        });
      return patch(`/projects/${p.id}`, {
        title: f.title,
        successCriterion: f.successCriterion,
        startDate: f.startDate || null,
        dueDate: f.dueDate || null,
        objectiveId: f.objectiveId || null,
        sequenceMode: f.sequenceMode,
        isFree: f.isFree,
        importance: f.importance,
        recurrence: (f.recurrence || null) as Project['recurrence'],
      });
    },
    { toast: 'Projet enregistré.' },
  );
  /** D-40: click outside / ✕ saves (if changed and valid), Escape discards. */
  const close = () => {
    if (snapshot() !== initial.current) {
      if (!f.title.trim()) return toast('Le titre est obligatoire.', 'error');
      if (!groupIds.length) return toast('Au moins un groupe.', 'error');
      save.mutate(undefined);
    }
    onClose();
  };
  const remove = useAction(() => del(`/projects/${p.id}`), {
    onSuccess: () => navigate({ to: '/projets' }),
    toast: 'Projet supprimé.',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const two = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' };
  const three = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))' };
  return (
    <Panel open={open} onClose={close} onCancel={onClose} title="Modifier le projet" hint={SAVE_HINT}>
      <Field label="Titre">
        <input value={f.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field
        label="Critère de succès (oui / non)"
        info="Phrase vérifiable par oui ou non à la fin du projet. Obligatoire pour promouvoir une idée."
      >
        <input
          value={f.successCriterion}
          onChange={(e) => set('successCriterion', e.target.value)}
          placeholder="ex. Contrat d'installation signé"
        />
      </Field>

      <FormSection title="Calendrier">
        <div className="grid gap-3" style={three}>
          <Field label="Début">
            <input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field
            label="Fin"
            info="Facultative : le mois sert de limite au projet du mois. Si les deux dates sont posées, la fin doit suivre le début."
          >
            <input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
          <Field
            label="Récurrence"
            info="Projet qui revient (compta du mois, entretien annuel…) : une fois terminé, Mémento le recrée avec ses tâches (toutes à faire) et le prévoit pour la période suivante. Pour arrêter, retire la récurrence sur la nouvelle occurrence."
          >
            <select
              value={f.recurrence}
              onChange={(e) => set('recurrence', e.target.value as typeof f.recurrence)}
            >
              <option value="">Aucune</option>
              <option value="monthly">Chaque mois</option>
              <option value="quarterly">Chaque trimestre</option>
              <option value="yearly">Chaque année</option>
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Rattachement et priorité">
        <div className="grid gap-3" style={two}>
          <Field label="Objectif">
            <SearchSelect
              value={f.objectiveId}
              onChange={(v) => set('objectiveId', v)}
              emptyLabel="Hors objectif"
              ariaLabel="Objectif"
              options={(objectives.data ?? []).map((o) => ({ value: o.id, label: o.title, hint: o.quarter }))}
            />
          </Field>
          <Field
            label="Importance"
            info="Priorité propre au projet, indépendante du domaine : Haute ×1,5, Normale ×1, Basse ×0,5 sur la valeur du score. Un projet Santé « basse » peut ainsi passer après un projet Famille « haute »."
          >
            <select
              value={f.importance}
              onChange={(e) => set('importance', e.target.value as typeof f.importance)}
            >
              <option value="high">Haute</option>
              <option value="normal">Normale</option>
              <option value="low">Basse</option>
            </select>
          </Field>
        </div>
        <div className="field">
          <span className="flex items-center gap-1.5">
            Groupes
            <InfoTip>Au moins un groupe. Les domaines du projet viennent de ses groupes.</InfoTip>
          </span>
          <GroupPicker value={groupIds} onChange={setGroupIds} />
        </div>
        {domains.length > 1 && (
          <Field
            label="Domaine principal"
            info="Le domaine principal donne sa couleur au projet et pèse le plus dans son score : son poids compte en entier, celui des autres domaines pour moitié. C'est aussi lui qui reçoit les heures du projet dans Ma semaine et Planifier (les rapports comptent tous les domaines servis)."
          >
            <select
              value={domains.includes(primary) ? primary : domains[0]}
              onChange={(e) => setPrimary(e.target.value)}
            >
              {domains.map((d) => (
                <option key={d} value={d}>
                  {dl.name(d)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </FormSection>

      <FormSection title="Organisation">
        <Field
          label="Enchaînement des tâches"
          info="Séquentiel : une tâche attend la précédente. Parallèle : toutes les tâches sont disponibles."
        >
          <select
            value={f.sequenceMode}
            onChange={(e) => set('sequenceMode', e.target.value as typeof f.sequenceMode)}
          >
            <option value="sequential">Séquentiel</option>
            <option value="parallel">Parallèle</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={f.isFree} onChange={(e) => set('isFree', e.target.checked)} />
          Libre dans le chemin de l'objectif (n'attend pas les projets placés avant lui)
        </label>
      </FormSection>

      <Resources ownerType="project" ownerId={p.id} resources={p.resources} />
      <div
        className="flex flex-wrap gap-2 items-center pt-3"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-danger ml-auto"
          style={{ borderColor: 'transparent' }}
          onClick={() => setDeleting(true)}
        >
          Supprimer le projet
        </button>
      </div>
      <ConfirmDialog
        open={deleting}
        title="Supprimer le projet ?"
        busy={remove.isPending}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate(undefined)}
      >
        <p className="m-0">
          « {p.title} » et ses {p.taskStats.todo + p.taskStats.done} tâche(s) seront supprimés définitivement.
          Les rapports déjà générés ne changent pas.
        </p>
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Pour garder une trace, préfère « Abandonner ».
        </p>
      </ConfirmDialog>
    </Panel>
  );
}

type IdeaSort = 'title' | 'domain' | 'group' | 'createdAt';

export function IdeasPage() {
  const [domains, setDomains] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['ideas'], queryFn: () => get<Project[]>('/ideas') });
  const dl = useDomainLookup();
  const promote = useAction((id: string) => post(`/projects/${id}/promote`), {
    toast: 'Idée promue : projet prêt.',
  });
  const drop = useAction((id: string) => patch(`/projects/${id}`, { status: 'abandoned' }), {
    toast: 'Idée abandonnée.',
  });
  const groupName = (p: Project) => p.groups.map((g) => g.name).join(' · ');
  const cmp: Record<IdeaSort, (a: Project, b: Project) => number> = {
    title: (a, b) => a.title.localeCompare(b.title),
    domain: (a, b) =>
      (dl.get(a.domainIds[0])?.priorityRank ?? 99) - (dl.get(b.domainIds[0])?.priorityRank ?? 99),
    group: (a, b) => groupName(a).localeCompare(groupName(b)),
    createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
  };
  const { sorted: rows, th } = useTableSort(
    (q.data ?? []).filter((p) => !domains.length || p.domainIds.some((d) => domains.includes(d))),
    cmp,
    'createdAt',
    (a, b) => a.title.localeCompare(b.title),
  );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Idées' }]} />
        <PageHeader
          eyebrow="Vider la tête · les plus anciennes en premier"
          title="Idées"
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              + Idée
            </button>
          }
        />
      </div>
      <DomainFilter value={domains} onChange={setDomains} />
      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {th('title', 'Idée')}
              {th('domain', 'Domaine')}
              {th('group', 'Groupe')}
              {th('createdAt', 'Depuis')}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr className="row-line" key={p.id}>
                <td className="py-2.5 px-3">
                  <Link to="/projets/$id" params={{ id: p.id }} className="font-medium">
                    {p.title}
                  </Link>
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <span className="dot" style={{ background: dl.color(p.domainIds[0]) }} />
                    {dl.name(p.domainIds[0])}
                  </span>
                </td>
                <td className="py-2.5 px-3" style={{ color: 'var(--text-muted)' }}>
                  {groupName(p)}
                </td>
                <td className="py-2.5 px-3 mono text-[13px] whitespace-nowrap">
                  {fmtDate(p.createdAt.slice(0, 10))}
                </td>
                <td className="py-2 px-3 text-right whitespace-nowrap">
                  <button type="button" className="btn btn-sm" onClick={() => promote.mutate(p.id)}>
                    Promouvoir
                  </button>{' '}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => drop.mutate(p.id)}>
                    Abandonner
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data && rows.length === 0 && <Empty>Aucune idée.</Empty>}
      </div>
      <NewProjectPanel open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export function InboxPage({ tache }: { tache?: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['tasks', 'inbox', 'page'], queryFn: () => get<InboxPageData>('/inbox') });
  const [showDone, setShowDone] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const dl = useDomainLookup();
  const open = (id: string) => navigate({ to: '/inbox', search: { tache: id } });
  const color = (t: Task) => dl.color(t.domainId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Inbox' }]} />
        <PageHeader
          eyebrow="Tâches hors projet · deadlines · récurrences"
          title="Inbox"
          actions={
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />{' '}
              Afficher les tâches réalisées ce mois-ci
            </label>
          }
        />
      </div>
      <section className="card overflow-hidden">
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--divider-2)',
            background: 'var(--surface-2)',
          }}
        >
          <QuickAdd projectId={null} placeholder="Capturer une tâche (Entrée)…" withSchedule />
        </div>
        {q.isLoading && <Loading />}
        {q.data && (
          <TaskList
            tasks={showDone ? [...q.data.open, ...q.data.doneThisMonth] : q.data.open}
            projectId={null}
            showDone={showDone}
            color={color}
            onOpen={open}
          />
        )}
      </section>
      {q.data && q.data.later.length > 0 && (
        <section className="card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLater((v) => !v)}
            aria-expanded={showLater}
            className="w-full flex items-center gap-2.5 border-0 text-left cursor-pointer"
            style={{ padding: '14px 18px', background: 'var(--surface)' }}
          >
            <Chevron open={showLater} />
            <span className="h2">Récurrentes plus tard · {q.data.later.length}</span>
            <InfoTip>
              Tâches récurrentes dont la deadline est à plus de {q.data.horizonDays} jours. Elles reviennent
              dans la liste principale à l'approche de leur deadline. Réglable dans Configuration › Général.
            </InfoTip>
          </button>
          {showLater && <TaskList tasks={q.data.later} projectId={null} color={color} onOpen={open} />}
        </section>
      )}
      <TaskDrawer taskId={tache ?? null} onClose={() => navigate({ to: '/inbox', search: {} })} />
    </div>
  );
}

export function useDeleteGroup() {
  return useAction((id: string) => del(`/groups/${id}`), { toast: 'Groupe supprimé.' });
}
export { toast };
