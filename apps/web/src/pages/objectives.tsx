// Objectifs (V-01), Objectif = chemin (V-02), Domaines / Domaine (V-15).
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { DescriptionBlock, PencilIcon } from '../components/markdown.tsx';
import { Breadcrumb } from '../components/shell.tsx';
import { LockIcon, Resources, useSortSensors } from '../components/tasks.tsx';
import {
  ConfirmDialog,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Panel,
  Section,
  StatusPill,
} from '../components/ui.tsx';
import { del, get, patch, post } from '../lib/api.ts';
import { fmtDate, fmtMin, STATUS_LABEL } from '../lib/format.ts';
import { useAction, useDomainLookup, useMe, useSettings } from '../lib/hooks.ts';
import type { MetaObjective, Objective, PathProject, Project, Resource } from '../lib/types.ts';

function Progress({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 track" style={{ height: 8 }}>
        <div style={{ height: 8, width: `${pct}%`, background: 'var(--text)', borderRadius: 999 }} />
      </div>
      <span
        className="mono text-[12px]"
        style={{ width: 40, textAlign: 'right', color: 'var(--text-muted)' }}
      >
        {pct} %
      </span>
    </div>
  );
}

export function ObjectivesPage() {
  const objectives = useQuery({ queryKey: ['objectives'], queryFn: () => get<Objective[]>('/objectives') });
  const metas = useQuery({
    queryKey: ['meta-objectives'],
    queryFn: () => get<MetaObjective[]>('/meta-objectives'),
  });
  const projects = useQuery({
    queryKey: ['projects', 'all-active'],
    queryFn: () => get<Project[]>('/projects?status=active,paused,done'),
  });
  const [creating, setCreating] = useState<'objective' | 'meta' | null>(null);
  const [editingMeta, setEditingMeta] = useState<MetaObjective | null>(null);
  const saveMetaDescription = useAction(
    ({ id, description }: { id: string; description: string }) =>
      patch(`/meta-objectives/${id}`, { description }),
    { toast: 'Description enregistrée.' },
  );
  const [showClosed, setShowClosed] = useState(false);
  const dl = useDomainLookup();
  const list = (objectives.data ?? []).filter(
    (o) => showClosed || o.status === 'active' || o.status === 'paused',
  );
  const groups = [
    ...(metas.data ?? []).map((m) => ({
      meta: m as MetaObjective | null,
      items: list.filter((o) => o.metaObjectiveId === m.id),
    })),
    { meta: null, items: list.filter((o) => !o.metaObjectiveId) },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Objectifs' }]} />
        <PageHeader
          eyebrow="Le phare · objectifs trimestriels et méta-objectifs"
          title="Objectifs"
          actions={
            <>
              <button type="button" className="btn" onClick={() => setCreating('meta')}>
                + Méta-objectif
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setCreating('objective')}>
                + Objectif
              </button>
            </>
          }
        />
      </div>
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{' '}
        Afficher les objectifs clos
      </label>
      {objectives.isError && <ErrorBox error={objectives.error} />}
      {groups.map(({ meta, items }) =>
        items.length || meta ? (
          <section key={meta?.id ?? 'none'} className="bin flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="h2-bin">{meta ? meta.title : 'Sans méta-objectif'}</h2>
              {meta?.horizonDate && (
                <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  horizon {fmtDate(meta.horizonDate)}
                </span>
              )}
              {meta && <StatusPill>{STATUS_LABEL[meta.status]}</StatusPill>}
              {meta && (
                <button
                  type="button"
                  className="icon-btn ml-auto"
                  aria-label={`Modifier le méta-objectif ${meta.title}`}
                  title="Modifier le méta-objectif"
                  onClick={() => setEditingMeta(meta)}
                >
                  <PencilIcon />
                </button>
              )}
            </div>
            {meta && (
              <DescriptionBlock
                text={meta.description}
                lines={3}
                emptyLabel="Pas encore de description : pourquoi ce cap compte pour toi."
                onSave={(description, done) =>
                  saveMetaDescription.mutate({ id: meta.id, description }, { onSuccess: done })
                }
              />
            )}
            {items.length === 0 && (
              <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
                Aucun objectif trimestriel rattaché.
              </div>
            )}
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
            >
              {items.map((o) => {
                const ps = (projects.data ?? []).filter((p) => p.objectiveId === o.id);
                const doms = [...new Set(ps.flatMap((p) => p.domainIds.slice(0, 1)))];
                return (
                  <Link
                    key={o.id}
                    to="/objectifs/$id"
                    params={{ id: o.id }}
                    className="card flex flex-col gap-2.5 hover:no-underline"
                    style={{ padding: '16px 18px' }}
                  >
                    <div className="flex justify-between items-start gap-3">
                      <span className="text-[16px] font-semibold hover:underline">{o.title}</span>
                      <span className="mono text-[12px] flex-none" style={{ color: 'var(--text-faint)' }}>
                        {o.quarter}
                      </span>
                    </div>
                    <div className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                      {o.smartIndicator
                        ? `${o.smartIndicator} → ${o.smartTarget}`
                        : 'Indicateur SMART à préciser'}{' '}
                      · deadline {fmtDate(o.deadline)}
                    </div>
                    <Progress pct={o.progressPct} />
                    <div
                      className="flex items-center gap-2 text-[12px]"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {doms.map((d) => (
                        <span
                          key={d}
                          className="dot"
                          style={{ background: dl.color(d) }}
                          title={dl.name(d)}
                        />
                      ))}
                      {ps.length} projet{ps.length > 1 ? 's' : ''} · criticité {o.criticality}/3 ·{' '}
                      {STATUS_LABEL[o.status]}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
      <ObjectivePanel
        open={creating === 'objective'}
        onClose={() => setCreating(null)}
        metas={metas.data ?? []}
      />
      <MetaPanel open={creating === 'meta'} onClose={() => setCreating(null)} />
      <MetaPanel
        key={editingMeta?.id}
        open={!!editingMeta}
        meta={editingMeta ?? undefined}
        onClose={() => setEditingMeta(null)}
      />
    </div>
  );
}

function ObjectivePanel({
  open,
  onClose,
  metas,
  objective,
}: {
  open: boolean;
  onClose: () => void;
  metas: MetaObjective[];
  objective?: Objective;
}) {
  const settings = useSettings();
  const me = useMe();
  const empty = {
    title: '',
    metaObjectiveId: '',
    smartIndicator: '',
    smartTarget: '',
    smartCurrent: '',
    deadline: '',
    criticality: 2,
    status: 'active',
    description: '',
  };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (!open) return;
    setF(
      objective
        ? {
            title: objective.title,
            metaObjectiveId: objective.metaObjectiveId ?? '',
            smartIndicator: objective.smartIndicator,
            smartTarget: objective.smartTarget,
            smartCurrent: objective.smartCurrent,
            deadline: objective.deadline,
            criticality: objective.criticality,
            status: objective.status,
            description: objective.description,
          }
        : { ...empty, description: settings.data?.['templates.objective'] ?? '' },
    );
  }, [open]);
  const save = useAction(
    () => {
      const { description, ...rest } = f;
      const body = objective
        ? { ...rest, metaObjectiveId: f.metaObjectiveId || null }
        : { ...f, metaObjectiveId: f.metaObjectiveId || null };
      return objective ? patch(`/objectives/${objective.id}`, body) : post('/objectives', body);
    },
    { onSuccess: onClose, toast: 'Objectif enregistré.' },
  );
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const remove = useAction(() => del(`/objectives/${objective!.id}`), {
    onSuccess: () => navigate({ to: '/objectifs' }),
    toast: 'Objectif supprimé.',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Panel
      open={open}
      onClose={onClose}
      title={objective ? 'Modifier l’objectif' : 'Nouvel objectif trimestriel'}
      side={false}
      width={640}
    >
      <Field label="Titre">
        <input value={f.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <div className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <Field label="Indicateur (SMART)">
          <input
            value={f.smartIndicator}
            onChange={(e) => set('smartIndicator', e.target.value)}
            placeholder="ex. POC publiés"
          />
        </Field>
        <Field label="Cible">
          <input value={f.smartTarget} onChange={(e) => set('smartTarget', e.target.value)} placeholder="2" />
        </Field>
        <Field label="Actuel">
          <input
            value={f.smartCurrent}
            onChange={(e) => set('smartCurrent', e.target.value)}
            placeholder="0"
          />
        </Field>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Field label="Deadline (dans le trimestre)">
          <input
            type="date"
            value={f.deadline}
            min={me.data?.today}
            onChange={(e) => set('deadline', e.target.value)}
          />
        </Field>
        <Field label="Criticité">
          <select value={f.criticality} onChange={(e) => set('criticality', Number(e.target.value))}>
            <option value={1}>1 · faible</option>
            <option value={2}>2 · moyenne</option>
            <option value={3}>3 · critique</option>
          </select>
        </Field>
        <Field label="Statut">
          <select value={f.status} onChange={(e) => set('status', e.target.value)}>
            {['active', 'paused', 'achieved', 'partial', 'failed', 'abandoned'].map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Méta-objectif">
        <select value={f.metaObjectiveId} onChange={(e) => set('metaObjectiveId', e.target.value)}>
          <option value="">Aucun</option>
          {metas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </Field>
      {!objective && (
        <Field label="Description" hint="Markdown accepté · modèle repris de Configuration › Templates">
          <textarea
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
            className="mono"
            style={{ minHeight: 260, fontSize: 14 }}
          />
        </Field>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!f.title.trim() || !f.deadline || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          Enregistrer
        </button>
        {objective && (
          <button
            type="button"
            className="btn btn-ghost btn-danger ml-auto"
            style={{ borderColor: 'transparent' }}
            onClick={() => setDeleting(true)}
          >
            Supprimer l'objectif
          </button>
        )}
      </div>
      {objective && (
        <ConfirmDialog
          open={deleting}
          title="Supprimer l'objectif ?"
          busy={remove.isPending}
          onClose={() => setDeleting(false)}
          onConfirm={() => remove.mutate(undefined)}
        >
          <p className="m-0">
            « {objective.title} » sera supprimé définitivement. Ses projets sont conservés et passent « hors
            objectif ». Les rapports déjà générés ne changent pas.
          </p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}

function MetaPanel({ open, onClose, meta }: { open: boolean; onClose: () => void; meta?: MetaObjective }) {
  const settings = useSettings();
  const [title, setTitle] = useState(meta?.title ?? '');
  const [horizonDate, setHorizon] = useState(meta?.horizonDate ?? '');
  const [status, setStatus] = useState<string>(meta?.status ?? 'active');
  const [description, setDescription] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (open && !meta) setDescription(settings.data?.['templates.meta_objective'] ?? '');
  }, [open]);
  const save = useAction(
    () =>
      meta
        ? patch(`/meta-objectives/${meta.id}`, { title, horizonDate: horizonDate || null, status })
        : post('/meta-objectives', { title, horizonDate: horizonDate || null, description }),
    { onSuccess: onClose, toast: meta ? 'Méta-objectif enregistré.' : 'Méta-objectif créé.' },
  );
  const remove = useAction(() => del(`/meta-objectives/${meta!.id}`), {
    onSuccess: onClose,
    toast: 'Méta-objectif supprimé.',
  });
  return (
    <Panel
      open={open}
      onClose={onClose}
      title={meta ? 'Modifier le méta-objectif' : 'Nouveau méta-objectif (~1 an et +)'}
      side={false}
      width={600}
    >
      <Field label="Titre">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Field label="Horizon" info="Date visée, en général un an ou plus. Facultatif.">
          <input type="date" value={horizonDate} onChange={(e) => setHorizon(e.target.value)} />
        </Field>
        {meta && (
          <Field label="Statut">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {['active', 'paused', 'achieved', 'abandoned'].map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {!meta && (
        <Field label="Description" hint="Markdown accepté · modèle repris de Configuration › Templates">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mono"
            style={{ minHeight: 220, fontSize: 14 }}
          />
        </Field>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!title.trim() || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          {meta ? 'Enregistrer' : 'Créer'}
        </button>
        {meta && (
          <button
            type="button"
            className="btn btn-ghost btn-danger ml-auto"
            style={{ borderColor: 'transparent' }}
            onClick={() => setDeleting(true)}
          >
            Supprimer
          </button>
        )}
      </div>
      {meta && (
        <ConfirmDialog
          open={deleting}
          title="Supprimer le méta-objectif ?"
          busy={remove.isPending}
          onClose={() => setDeleting(false)}
          onConfirm={() => remove.mutate(undefined)}
        >
          <p className="m-0">
            « {meta.title} » sera supprimé définitivement. Ses objectifs sont conservés, sans méta-objectif.
          </p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}

function PathRow({ p, index, handle }: { p: PathProject; index: number; handle: React.ReactNode }) {
  const dl = useDomainLookup();
  return (
    <div
      className="flex items-center gap-3"
      style={{
        padding: '12px 16px 12px 6px',
        borderBottom: '1px solid var(--divider)',
        background: 'var(--surface)',
        opacity: p.status === 'done' || p.status === 'abandoned' ? 0.55 : 1,
      }}
    >
      {handle}
      <span
        className="mono text-[13px] flex-none grid place-items-center rounded-full"
        style={{ width: 26, height: 26, background: 'var(--bin)' }}
      >
        {index + 1}
      </span>
      <span className="dot" style={{ background: dl.color(p.domainIds[0]) }} />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <Link
            to="/projets/$id"
            params={{ id: p.id }}
            className="text-[15px] font-semibold"
            style={{ textDecoration: p.status === 'done' ? 'line-through' : undefined }}
          >
            {p.title}
          </Link>
          {p.blocked && (
            <span style={{ color: 'var(--text-faint)' }}>
              <LockIcon />
            </span>
          )}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {STATUS_LABEL[p.status]}
          {p.isFree ? ' · libre' : ''}
          {p.dueDate ? ` · fin ${fmtDate(p.dueDate)}` : ''} · {fmtMin(p.taskStats.doneMin)} /{' '}
          {fmtMin(p.taskStats.totalMin)}
          {p.blocked ? ' · attend le projet précédent' : ''}
        </span>
      </div>
    </div>
  );
}

function SortablePath({ p, index }: { p: PathProject; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: p.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative' }}
    >
      <PathRow
        p={p}
        index={index}
        handle={
          <button
            type="button"
            aria-label="Déplacer"
            className="flex-none border-0 bg-transparent cursor-grab"
            style={{ width: 28, minHeight: 32, color: 'var(--text-ghost)', touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </button>
        }
      />
    </div>
  );
}

export function ObjectivePage({ id }: { id: string }) {
  const o = useQuery({
    queryKey: ['objective', id],
    queryFn: () => get<Objective & { resources: Resource[] }>(`/objectives/${id}`),
  });
  const path = useQuery({
    queryKey: ['objective-path', id],
    queryFn: () => get<PathProject[]>(`/objectives/${id}/path`),
  });
  const metas = useQuery({
    queryKey: ['meta-objectives'],
    queryFn: () => get<MetaObjective[]>('/meta-objectives'),
  });
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => setOrder((path.data ?? []).map((p) => p.id)), [path.data]);
  const sensors = useSortSensors();
  const reorder = useAction((ids: string[]) => post('/projects/reorder', { objectiveId: id, ids }));
  const saveDescription = useAction((description: string) => patch(`/objectives/${id}`, { description }), {
    toast: 'Description enregistrée.',
  });
  if (o.isError) return <ErrorBox error={o.error} />;
  if (!o.data) return <Loading />;
  const meta = metas.data?.find((m) => m.id === o.data.metaObjectiveId);
  const byId = new Map((path.data ?? []).map((p) => [p.id, p]));
  const rows = order.map((x) => byId.get(x)).filter((x): x is PathProject => !!x);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
    setOrder(next);
    reorder.mutate(next);
  };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Objectifs', to: '/objectifs' },
            ...(meta ? [{ label: meta.title, to: '/objectifs' }] : []),
            { label: o.data.title },
          ]}
        />
        <PageHeader
          eyebrow={`${o.data.quarter} · deadline ${fmtDate(o.data.deadline)} · criticité ${o.data.criticality}/3 · ${STATUS_LABEL[o.data.status]}`}
          title={o.data.title}
          actions={
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <PencilIcon /> Modifier
            </button>
          }
        />
      </div>
      <DescriptionBlock
        text={o.data.description}
        lines={16}
        saving={saveDescription.isPending}
        emptyLabel="Pas encore de description : pourquoi cet objectif, ce que « réussi » veut dire, le contexte."
        onSave={(text, done) => saveDescription.mutate(text, { onSuccess: done })}
      />
      <div className="flex flex-wrap gap-6 items-start">
        <section className="card overflow-hidden min-w-0" style={{ flex: '999 1 560px' }}>
          <div
            className="flex justify-between items-baseline gap-3 flex-wrap"
            style={{ padding: '16px 20px', borderBottom: '1px solid var(--divider-2)' }}
          >
            <h2 className="h2">Chemin · projets dans l'ordre</h2>
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              l'ordre crée le prérequis · glisser pour réordonner
            </span>
          </div>
          {rows.length === 0 && (
            <Empty>Aucun projet sur ce chemin. Rattache un projet à cet objectif depuis sa fiche.</Empty>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {rows.map((p, i) => (
                <SortablePath key={p.id} p={p} index={i} />
              ))}
            </SortableContext>
          </DndContext>
        </section>
        <aside className="flex flex-col gap-4 min-w-0" style={{ flex: '1 1 340px' }}>
          <Section title="Mesure">
            <div className="text-[14px]">{o.data.smartIndicator || 'Indicateur à préciser'}</div>
            <div className="mono text-[20px]">
              {o.data.smartCurrent || '—'}{' '}
              <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>/ {o.data.smartTarget || '—'}</span>
            </div>
            <div className="label-caps">Avancement du chemin</div>
            <Progress pct={o.data.progressPct} />
          </Section>
          <Section>
            <Resources ownerType="objective" ownerId={id} resources={o.data.resources} />
          </Section>
        </aside>
      </div>
      <ObjectivePanel
        open={editing}
        onClose={() => setEditing(false)}
        metas={metas.data ?? []}
        objective={o.data}
      />
    </div>
  );
}

export function DomainsPage() {
  const dl = useDomainLookup();
  const projects = useQuery({
    queryKey: ['projects', 'active'],
    queryFn: () => get<Project[]>('/projects?status=active,paused'),
  });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Domaines' }]} />
        <PageHeader eyebrow="Par ordre de priorité" title="Domaines de vie" />
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {dl.domains
          .filter((d) => !d.archived)
          .map((d) => {
            const ps = (projects.data ?? []).filter((p) => p.domainIds.includes(d.id));
            const main = ps.filter((p) => p.domainIds[0] === d.id).length;
            return (
              <Link
                key={d.id}
                to="/domaines/$id"
                params={{ id: d.id }}
                className="card flex flex-col gap-2 hover:no-underline"
                style={{ padding: '16px 18px', borderTop: `3px solid ${dl.colorOf(d)}` }}
              >
                <span className="flex items-center gap-2">
                  <span className="mono text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    #{d.priorityRank}
                  </span>
                  <span className="text-[17px] font-semibold">{d.name}</span>
                </span>
                <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                  {main} projet(s) principal · {ps.length - main} connexe(s)
                </span>
              </Link>
            );
          })}
      </div>
    </div>
  );
}

/** V-15: all projects touching the domain; related ones (other primary) dimmed with their primary colour edge. */
export function DomainPage({ id }: { id: string }) {
  const dl = useDomainLookup();
  const d = dl.get(id);
  const projects = useQuery({
    queryKey: ['projects', 'domain', id],
    queryFn: () => get<Project[]>(`/projects?domainId=${id}&status=idea,active,paused`),
  });
  if (!d) return <Loading />;
  const list = projects.data ?? [];
  const own = list.filter((p) => p.domainIds[0] === id);
  const related = list.filter((p) => p.domainIds[0] !== id);
  const row = (p: Project, rel?: boolean) => (
    <Link
      to="/projets/$id"
      params={{ id: p.id }}
      className="flex items-center gap-3 hover:no-underline"
      style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--divider)',
        opacity: rel ? 0.6 : 1,
        borderLeft: rel ? `3px solid ${dl.color(p.domainIds[0])}` : '3px solid transparent',
      }}
    >
      <span className="flex-1 min-w-0 text-[15px] font-medium truncate hover:underline">{p.title}</span>
      {rel && (
        <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          principal : {dl.name(p.domainIds[0])}
        </span>
      )}
      <StatusPill tone={p.status === 'active' ? 'ok' : 'neutral'}>{STATUS_LABEL[p.status]}</StatusPill>
    </Link>
  );
  return (
    <div
      className="flex flex-col gap-6"
      style={{ borderTop: `3px solid ${dl.colorOf(d)}`, paddingTop: 12, marginTop: -12 }}
    >
      <div>
        <Breadcrumb items={[{ label: 'Domaines', to: '/domaines' }, { label: d.name }]} />
        <PageHeader eyebrow={`Priorité n°${d.priorityRank} · poids ${d.weight}`} title={d.name} />
      </div>
      <section className="card overflow-hidden">
        <div className="h2" style={{ padding: '14px 16px', borderBottom: '1px solid var(--divider-2)' }}>
          Projets {d.name} · {own.length}
        </div>
        {own.map((p) => row(p))}
        {own.length === 0 && <Empty>Aucun projet.</Empty>}
      </section>
      <section className="card overflow-hidden">
        <div className="h2" style={{ padding: '14px 16px', borderBottom: '1px solid var(--divider-2)' }}>
          Projets connexes · {related.length}
        </div>
        {related.map((p) => row(p, true))}
        {related.length === 0 && <Empty>Aucun projet connexe.</Empty>}
      </section>
    </div>
  );
}
