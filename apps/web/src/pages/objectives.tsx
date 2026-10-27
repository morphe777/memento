// Objectifs (V-01), Objectif = chemin (V-02), Domaines / Domaine (V-15).
import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  pointerWithin,
  useDroppable,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { AiDescribe, DescriptionBlock, Markdown, PencilIcon } from '../components/markdown.tsx';
import { PathAiButton, PathQuickAdd } from '../components/path.tsx';
import { Breadcrumb } from '../components/shell.tsx';
import {
  LockIcon,
  QuickAdd,
  ResourceList,
  Resources,
  TaskDrawer,
  TaskList,
  useSortSensors,
} from '../components/tasks.tsx';
import {
  ConfirmDialog,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Panel,
  SAVE_HINT,
  SearchSelect,
  Section,
  StatusPill,
  Tabs,
} from '../components/ui.tsx';
import { del, get, patch, post } from '../lib/api.ts';
import { fmtDate, fmtMin, STATUS_LABEL } from '../lib/format.ts';
import { toast, useAction, useDomainLookup, useIsPhone, useMe, useSettings } from '../lib/hooks.ts';
import type {
  MetaObjective,
  Objective,
  ObjectivesMap,
  PathProject,
  Project,
  Resource,
  Task,
} from '../lib/types.ts';
import { NewProjectPanel } from './projects.tsx';

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
  // « + » of a map cell: the objective starts in that meta-objective, due at the end of that quarter.
  const [preset, setPreset] = useState<{ metaObjectiveId: string; deadline: string } | undefined>();
  const [editingMeta, setEditingMeta] = useState<MetaObjective | null>(null);
  const saveMetaDescription = useAction(
    ({ id, description }: { id: string; description: string }) =>
      patch(`/meta-objectives/${id}`, { description }),
    { toast: 'Description enregistrée.' },
  );
  const [showClosed, setShowClosed] = useState(false);
  const [view, setView] = useState<'map' | 'list'>('map');
  // D-69: « Réorganiser » sits with the page actions, map view only, never on iPhone (no drag there).
  const phone = useIsPhone();
  const [reorgMode, setReorg] = useState(false);
  const reorg = reorgMode && view === 'map' && !phone;
  const dl = useDomainLookup();
  const me = useMe();
  const year = me.data?.today.slice(0, 4);
  // Closed objectives: only those of the current year.
  const list = (objectives.data ?? []).filter(
    (o) => o.status === 'active' || o.status === 'paused' || (showClosed && o.deadline.slice(0, 4) === year),
  );
  const settings = useSettings();
  const groups = (metas.data ?? []).map((m) => ({
    meta: m as MetaObjective | null,
    items: list.filter((o) => o.metaObjectiveId === m.id),
  }));
  // D-69: « Sans méta-objectif » at the place chosen on the map (on top by default).
  groups.splice(Math.min(settings.data?.['map.no_meta_position'] ?? 0, groups.length), 0, {
    meta: null,
    items: list.filter((o) => !o.metaObjectiveId),
  });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Objectifs' }]} />
        <PageHeader
          eyebrow="Le phare · objectifs trimestriels et méta-objectifs"
          title="Objectifs"
          actions={
            <>
              {view === 'map' && !phone && (
                <button
                  type="button"
                  className={reorg ? 'btn btn-primary' : 'btn'}
                  onClick={() => setReorg((r) => !r)}
                  aria-pressed={reorg}
                >
                  {reorg ? 'Terminer' : 'Réorganiser'}
                </button>
              )}
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
      <div className="flex flex-wrap items-center gap-4">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: 'map', label: 'Carte' },
            { value: 'list', label: 'Liste' },
          ]}
        />
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />{' '}
          Afficher les objectifs clos cette année
        </label>
      </div>
      {objectives.isError && <ErrorBox error={objectives.error} />}
      {view === 'map' && (
        <ObjectivesMapView
          includeClosed={showClosed}
          reorg={reorg}
          drag={!phone}
          onEditMeta={setEditingMeta}
          onCreateIn={(p) => {
            setPreset(p);
            setCreating('objective');
          }}
        />
      )}
      {view === 'list' &&
        groups.map(({ meta, items }) =>
          items.length || meta ? (
            <section key={meta?.id ?? 'none'} className="bin flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="h2-bin">
                  {meta ? (
                    <Link to="/meta-objectifs/$id" params={{ id: meta.id }}>
                      {meta.title}
                    </Link>
                  ) : (
                    'Sans méta-objectif'
                  )}
                </h2>
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
                  ai={{ kind: 'meta_objective', id: meta.id }}
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
        onClose={() => {
          setCreating(null);
          setPreset(undefined);
        }}
        metas={metas.data ?? []}
        preset={preset}
      />
      <MetaPanel open={creating === 'meta'} onClose={() => setCreating(null)} />
      {editingMeta && <MetaPanel open meta={editingMeta} onClose={() => setEditingMeta(null)} />}
    </div>
  );
}

function ObjectivePanel({
  open,
  onClose,
  metas,
  objective,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  metas: MetaObjective[];
  objective?: Objective & { resources?: Resource[] };
  preset?: { metaObjectiveId: string; deadline: string };
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
    recurrence: '' as '' | 'quarterly' | 'yearly',
  };
  const [f, setF] = useState(empty);
  const initial = useRef('');
  useEffect(() => {
    if (!open) return;
    const start = objective
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
          recurrence: (objective.recurrence ?? '') as '' | 'quarterly' | 'yearly',
        }
      : {
          ...empty,
          deadline: me.data ? quarterEnd(quarterOfDate(me.data.today)) : '',
          ...preset,
          description: settings.data?.['templates.objective'] ?? '',
        };
    initial.current = JSON.stringify(start);
    setF(start);
  }, [open]);
  const navigate = useNavigate();
  const save = useAction(
    () => {
      const { description, ...rest } = f;
      const body = objective
        ? { ...rest, metaObjectiveId: f.metaObjectiveId || null, recurrence: f.recurrence || null }
        : { ...f, metaObjectiveId: f.metaObjectiveId || null, recurrence: f.recurrence || null };
      return objective ? patch(`/objectives/${objective.id}`, body) : post<Objective>('/objectives', body);
    },
    {
      // D-75: a new objective opens right away, to lay its path.
      onSuccess: (r) => {
        onClose();
        if (!objective && r) navigate({ to: '/objectifs/$id', params: { id: (r as Objective).id } });
      },
      toast: 'Objectif enregistré.',
    },
  );
  const [deleting, setDeleting] = useState(false);
  const remove = useAction(() => del(`/objectives/${objective!.id}`), {
    onSuccess: () => navigate({ to: '/objectifs' }),
    toast: 'Objectif supprimé.',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  /** D-40: an edit is saved when the drawer closes (outside click, ✕); Escape discards. A creation needs « Créer ». */
  const close = () => {
    if (objective && JSON.stringify(f) !== initial.current) {
      if (!f.title.trim() || !f.deadline) return toast('Titre et deadline sont obligatoires.', 'error');
      save.mutate(undefined);
    }
    onClose();
  };
  return (
    <Panel
      open={open}
      onClose={close}
      onCancel={onClose}
      hint={objective ? SAVE_HINT : undefined}
      title={objective ? 'Modifier l’objectif' : 'Nouvel objectif trimestriel'}
    >
      <Field label="Titre">
        <input
          autoFocus={!objective}
          value={f.title}
          onChange={(e) => set('title', e.target.value)}
          onKeyDown={(e) => {
            if (!objective && e.key === 'Enter' && f.title.trim() && f.deadline && !save.isPending)
              save.mutate(undefined);
          }}
        />
      </Field>
      {!objective && (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Field
              label="Trimestre"
              info="La deadline est le dernier jour du trimestre ; tu peux la préciser plus bas."
            >
              <select
                value={f.deadline ? quarterOfDate(f.deadline) : ''}
                onChange={(e) => set('deadline', quarterEnd(e.target.value))}
              >
                {quarterChoices(me.data?.today, f.deadline).map((q) => (
                  <option key={q} value={q}>
                    {quarterLabel(q)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Méta-objectif">
              <SearchSelect
                value={f.metaObjectiveId}
                onChange={(v) => set('metaObjectiveId', v)}
                emptyLabel="Aucun"
                ariaLabel="Méta-objectif"
                options={metas.map((m) => ({ value: m.id, label: m.title }))}
              />
            </Field>
          </div>
          <details>
            <summary className="cursor-pointer text-[14px]" style={{ color: 'var(--text-muted)' }}>
              Compléter (facultatif) : mesure, deadline précise, criticité, récurrence, description
            </summary>
            <div className="flex flex-col gap-3 pt-3">
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(2, minmax(0, 1fr))' }}
              >
                <Field label="Indicateur (SMART)">
                  <input
                    value={f.smartIndicator}
                    onChange={(e) => set('smartIndicator', e.target.value)}
                    placeholder="ex. POC publiés"
                  />
                </Field>
                <Field label="Cible">
                  <input
                    value={f.smartTarget}
                    onChange={(e) => set('smartTarget', e.target.value)}
                    placeholder="2"
                  />
                </Field>
                <Field label="Actuel">
                  <input
                    value={f.smartCurrent}
                    onChange={(e) => set('smartCurrent', e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <Field label="Deadline (dans le trimestre)">
                  <input
                    type="date"
                    value={f.deadline}
                    min={me.data?.today}
                    onChange={(e) => set('deadline', e.target.value)}
                  />
                </Field>
                <Field
                  label="Récurrence"
                  info="Objectif qui revient (bilan santé, révision du budget…) : une fois clos (atteint, partiel ou manqué, pas abandonné), Mémento le recrée pour le trimestre ou l'année suivante, avec la même deadline décalée."
                >
                  <select
                    value={f.recurrence}
                    onChange={(e) => set('recurrence', e.target.value as typeof f.recurrence)}
                  >
                    <option value="">Aucune</option>
                    <option value="quarterly">Chaque trimestre</option>
                    <option value="yearly">Chaque année</option>
                  </select>
                </Field>
              </div>
              <Field label="Criticité">
                <select value={f.criticality} onChange={(e) => set('criticality', Number(e.target.value))}>
                  <option value={3}>3 · critique</option>
                  <option value={2}>2 · moyenne</option>
                  <option value={1}>1 · faible</option>
                </select>
              </Field>
              <Field label="Description" hint="Markdown accepté · modèle repris de Configuration › Templates">
                <AiDescribe
                  request={{ kind: 'objective', title: f.title, parentId: f.metaObjectiveId || undefined }}
                  current={f.description}
                  onUse={(v) => set('description', v)}
                />
                <textarea
                  value={f.description}
                  onChange={(e) => set('description', e.target.value)}
                  className="mono"
                  style={{ minHeight: 260, fontSize: 14 }}
                />
              </Field>
            </div>
          </details>
        </>
      )}
      {objective && (
        <>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'minmax(0, 2fr) repeat(2, minmax(0, 1fr))' }}
          >
            <Field label="Indicateur (SMART)">
              <input
                value={f.smartIndicator}
                onChange={(e) => set('smartIndicator', e.target.value)}
                placeholder="ex. POC publiés"
              />
            </Field>
            <Field label="Cible">
              <input
                value={f.smartTarget}
                onChange={(e) => set('smartTarget', e.target.value)}
                placeholder="2"
              />
            </Field>
            <Field label="Actuel">
              <input
                value={f.smartCurrent}
                onChange={(e) => set('smartCurrent', e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Field label="Deadline (dans le trimestre)">
              <input
                type="date"
                value={f.deadline}
                min={me.data?.today}
                onChange={(e) => set('deadline', e.target.value)}
              />
            </Field>
            <Field
              label="Récurrence"
              info="Objectif qui revient (bilan santé, révision du budget…) : une fois clos (atteint, partiel ou manqué, pas abandonné), Mémento le recrée pour le trimestre ou l'année suivante, avec la même deadline décalée."
            >
              <select
                value={f.recurrence}
                onChange={(e) => set('recurrence', e.target.value as typeof f.recurrence)}
              >
                <option value="">Aucune</option>
                <option value="quarterly">Chaque trimestre</option>
                <option value="yearly">Chaque année</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Field label="Statut">
              <select value={f.status} onChange={(e) => set('status', e.target.value)}>
                {['active', 'paused', 'achieved', 'partial', 'failed', 'abandoned'].map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Criticité">
              <select value={f.criticality} onChange={(e) => set('criticality', Number(e.target.value))}>
                <option value={3}>3 · critique</option>
                <option value={2}>2 · moyenne</option>
                <option value={1}>1 · faible</option>
              </select>
            </Field>
          </div>
          <Field label="Méta-objectif">
            <SearchSelect
              value={f.metaObjectiveId}
              onChange={(v) => set('metaObjectiveId', v)}
              emptyLabel="Aucun"
              ariaLabel="Méta-objectif"
              options={metas.map((m) => ({ value: m.id, label: m.title }))}
            />
          </Field>
        </>
      )}
      {objective && (
        <Resources ownerType="objective" ownerId={objective.id} resources={objective.resources ?? []} />
      )}
      <div className="flex flex-wrap gap-2 items-center">
        {!objective && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!f.title.trim() || !f.deadline || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            Créer
          </button>
        )}
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
  const initial = useRef(JSON.stringify({ title, horizonDate, status }));
  const save = useAction(
    () =>
      meta
        ? patch(`/meta-objectives/${meta.id}`, { title, horizonDate: horizonDate || null, status })
        : post('/meta-objectives', { title, horizonDate: horizonDate || null, description }),
    { onSuccess: onClose, toast: meta ? 'Méta-objectif enregistré.' : 'Méta-objectif créé.' },
  );
  const close = () => {
    if (meta && JSON.stringify({ title, horizonDate, status }) !== initial.current) {
      if (!title.trim()) return toast('Le titre est obligatoire.', 'error');
      save.mutate(undefined);
    }
    onClose();
  };
  const navigate = useNavigate();
  const remove = useAction(() => del(`/meta-objectives/${meta!.id}`), {
    onSuccess: () => {
      onClose();
      navigate({ to: '/objectifs' });
    },
    toast: 'Méta-objectif supprimé.',
  });
  return (
    <Panel
      open={open}
      onClose={close}
      onCancel={onClose}
      hint={meta ? SAVE_HINT : undefined}
      title={meta ? 'Modifier le méta-objectif' : 'Nouveau méta-objectif (~1 an et +)'}
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
          <AiDescribe
            request={{ kind: 'meta_objective', title }}
            current={description}
            onUse={setDescription}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mono"
            style={{ minHeight: 220, fontSize: 14 }}
          />
        </Field>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        {!meta && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!title.trim() || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            Créer
          </button>
        )}
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

function PathRow({
  p,
  index,
  handle,
  open,
  onToggle,
}: {
  p: PathProject;
  index: number;
  handle: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const dl = useDomainLookup();
  return (
    <div
      className="row-line flex items-center gap-3"
      style={{
        padding: '12px 16px 12px 6px',
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
          <button
            type="button"
            className="icon-btn flex-none"
            style={{ width: 24, height: 24, minHeight: 0 }}
            aria-expanded={open}
            aria-label={open ? 'Replier les tâches' : 'Voir et ajouter les tâches'}
            title={open ? 'Replier les tâches' : 'Voir et ajouter les tâches'}
            onClick={onToggle}
          >
            <span
              aria-hidden
              style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : undefined }}
            >
              ▸
            </span>
          </button>
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
          {fmtMin(p.taskStats.totalMin)} · {p.taskStats.todo} tâche{p.taskStats.todo > 1 ? 's' : ''} à faire
          {p.blocked ? ' · attend le projet précédent' : ''}
        </span>
      </div>
    </div>
  );
}

/** D-75: the tasks of a path project, unfolded under its row: list (tick, reorder, open) and quick add. */
function PathTasks({ p, onOpen }: { p: PathProject; onOpen: (taskId: string) => void }) {
  const dl = useDomainLookup();
  const tasks = useQuery({
    queryKey: ['tasks', p.id],
    queryFn: () => get<Task[]>(`/tasks?projectId=${p.id}`),
  });
  return (
    <div style={{ marginLeft: 40, borderLeft: '2px solid var(--divider-2)', background: 'var(--surface)' }}>
      {tasks.data && (
        <TaskList
          tasks={tasks.data}
          projectId={p.id}
          color={() => dl.color(p.domainIds[0])}
          onOpen={onOpen}
        />
      )}
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)' }}>
        <QuickAdd projectId={p.id} placeholder={`Nouvelle tâche de « ${p.title} »…`} defaultDuration={60} />
      </div>
    </div>
  );
}

function SortablePath({
  p,
  index,
  onOpenTask,
}: {
  p: PathProject;
  index: number;
  onOpenTask: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: p.id });
  const [open, setOpen] = useState(false);
  return (
    <div
      ref={setNodeRef}
      className="row-wrap"
      style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative' }}
    >
      <PathRow
        p={p}
        index={index}
        open={open}
        onToggle={() => setOpen((x) => !x)}
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
      {open && <PathTasks p={p} onOpen={onOpenTask} />}
    </div>
  );
}

/** D-75: the current value of the measure, typed in place (Entrée or leaving the field saves, Échap cancels). */
function MeasureCurrent({ o }: { o: Objective }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const cancelled = useRef(false);
  const save = useAction((v: string) => patch(`/objectives/${o.id}`, { smartCurrent: v }), {
    toast: 'Mesure mise à jour.',
    onSuccess: () => setEditing(false),
  });
  if (!editing)
    return (
      <button
        type="button"
        className="border-0 bg-transparent p-0 cursor-pointer mono text-[20px] underline decoration-dotted"
        style={{ color: 'inherit', minHeight: 0, textUnderlineOffset: 4 }}
        title="Cliquer pour mettre à jour"
        onClick={() => {
          cancelled.current = false;
          setValue(o.smartCurrent);
          setEditing(true);
        }}
      >
        {o.smartCurrent || '—'}
      </button>
    );
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true;
          setEditing(false);
        }
        if (e.key === 'Enter') e.currentTarget.blur(); // the blur saves
      }}
      onBlur={() => {
        if (!cancelled.current && value !== o.smartCurrent && !save.isPending) save.mutate(value.trim());
        else setEditing(false);
      }}
      aria-label="Valeur actuelle"
      className="mono"
      style={{ width: 120, fontSize: 18 }}
    />
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
  const [taskId, setTaskId] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
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
        ai={{ kind: 'objective', id: o.data.id }}
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                l'ordre crée le prérequis · glisser pour réordonner
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  addInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  addInput.current?.focus({ preventScroll: true });
                }}
              >
                + Projet
              </button>
              <PathAiButton objectiveId={id} path={path.data} />
            </div>
          </div>
          {rows.length === 0 && (
            <Empty>
              Aucun projet sur ce chemin. Tape-les ci-dessous (Entrée entre chaque), ou demande un chemin à
              l'IA.
            </Empty>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {rows.map((p, i) => (
                <SortablePath key={p.id} p={p} index={i} onOpenTask={setTaskId} />
              ))}
            </SortableContext>
          </DndContext>
          <div style={{ padding: '12px 16px', background: 'var(--surface-2)' }}>
            <PathQuickAdd objectiveId={id} path={path.data} inputRef={addInput} />
          </div>
        </section>
        <aside className="flex flex-col gap-4 min-w-0" style={{ flex: '1 1 340px' }}>
          <Section title="Mesure">
            <div className="text-[14px]">{o.data.smartIndicator || 'Indicateur à préciser'}</div>
            <div className="mono text-[20px] flex items-baseline gap-2">
              <MeasureCurrent o={o.data} />
              <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>/ {o.data.smartTarget || '—'}</span>
            </div>
            <div className="label-caps">Avancement du chemin</div>
            <Progress pct={o.data.progressPct} />
          </Section>
          {o.data.resources.length > 0 && (
            <Section title="Ressources">
              <ResourceList resources={o.data.resources} />
            </Section>
          )}
        </aside>
      </div>
      <ObjectivePanel
        open={editing}
        onClose={() => setEditing(false)}
        metas={metas.data ?? []}
        objective={o.data}
      />
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} />
    </div>
  );
}

const STATUS_ORDER: Record<string, number> = { active: 0, ready: 1, paused: 2, idea: 3 };
const byStatus = (a: Project, b: Project) =>
  (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.title.localeCompare(b.title);

export function DomainsPage() {
  const dl = useDomainLookup();
  const projects = useQuery({
    queryKey: ['projects', 'domains-overview'],
    queryFn: () => get<Project[]>('/projects?status=active,ready,paused,idea'),
  });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Domaines' }]} />
        <PageHeader eyebrow="Par ordre de priorité" title="Domaines de vie" />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {dl.domains
          .filter((d) => !d.archived)
          .map((d) => {
            const ps = (projects.data ?? []).filter((p) => p.domainIds[0] === d.id);
            const n = (st: string) => ps.filter((p) => p.status === st).length;
            return (
              <Link
                key={d.id}
                to="/domaines/$id"
                params={{ id: d.id }}
                className="card flex flex-col gap-2.5 hover:no-underline"
                style={{ padding: '18px 20px', borderTop: `4px solid ${dl.colorOf(d)}` }}
              >
                <span className="flex items-baseline gap-2">
                  <span className="mono text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    #{d.priorityRank}
                  </span>
                  <span className="text-[18px] font-semibold">{d.name}</span>
                </span>
                {d.description ? (
                  <div
                    className="domain-card-md"
                    style={{
                      maxHeight: 96,
                      overflow: 'hidden',
                      maskImage: 'linear-gradient(#000 70%, transparent)',
                    }}
                  >
                    <Markdown text={d.description} plain />
                  </div>
                ) : (
                  <span className="text-[14px]" style={{ color: 'var(--text-ghost)' }}>
                    Pas encore de description.
                  </span>
                )}
                <span className="text-[13px] mt-auto" style={{ color: 'var(--text-faint)' }}>
                  {n('active')} actif{n('active') > 1 ? 's' : ''} · {n('ready')} prêt
                  {n('ready') > 1 ? 's' : ''} · {n('idea')} idée{n('idea') > 1 ? 's' : ''}
                </span>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
export function DomainPage({ id }: { id: string }) {
  const dl = useDomainLookup();
  const d = dl.get(id);
  const projects = useQuery({
    queryKey: ['projects', 'domain', id],
    queryFn: () => get<Project[]>(`/projects?domainId=${id}&status=idea,ready,active,paused`),
  });
  const saveDescription = useAction((description: string) => patch(`/domains/${id}`, { description }), {
    toast: 'Description enregistrée.',
  });
  if (!d) return <Loading />;
  const list = projects.data ?? [];
  // Always active first, then ready, paused, and ideas last.
  const own = list.filter((p) => p.domainIds[0] === id).sort(byStatus);
  const related = list.filter((p) => p.domainIds[0] !== id).sort(byStatus);
  const row = (p: Project, rel?: boolean) => (
    <Link
      key={p.id}
      to="/projets/$id"
      params={{ id: p.id }}
      className="row-line flex items-center gap-3 hover:no-underline"
      style={{
        padding: '10px 16px',
        opacity: rel || p.status === 'idea' ? 0.65 : 1,
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
      <DescriptionBlock
        text={d.description}
        ai={{ kind: 'domain', id: d.id }}
        lines={6}
        saving={saveDescription.isPending}
        emptyLabel="Pas encore de description : ce qui entre dans ce domaine, et ce qui n'y entre pas. L'IA s'en sert pour classer les projets."
        onSave={(text, done) => saveDescription.mutate(text, { onSuccess: done })}
      />
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

// ---------- Carte (meta-objectives × quarters, project paths) ----------

const quarterLabel = (q: string) => `T${q.slice(-1)} ${q.slice(0, 4)}`;

function PathStatus({ p }: { p: ObjectivesMap['lanes'][number]['objectives'][number]['path'][number] }) {
  const base = {
    width: 16,
    height: 16,
    borderRadius: 999,
    flex: 'none' as const,
    display: 'grid',
    placeItems: 'center',
    fontSize: 10,
    color: '#fff',
  };
  if (p.status === 'done')
    return (
      <span title="Terminé" style={{ ...base, background: 'var(--status-green)' }}>
        ✓
      </span>
    );
  if (p.status === 'active') return <span title="Actif" style={{ ...base, background: 'var(--primary)' }} />;
  if (p.status === 'paused')
    return (
      <span
        title="En pause"
        style={{ ...base, border: '2px solid var(--text-ghost)', color: 'var(--text-ghost)' }}
      >
        ॥
      </span>
    );
  return <span title="Idée" style={{ ...base, border: '1.5px dashed var(--text-ghost)' }} />;
}

function MapObjective({
  o,
  drag = false,
  onAddProject,
}: {
  o: ObjectivesMap['lanes'][number]['objectives'][number];
  drag?: boolean;
  /** D-75: an empty path offers « + projet » right on the card. */
  onAddProject?: (o: { id: string; title: string }) => void;
}) {
  const dl = useDomainLookup();
  // D-73: the card always moves (another quarter, another meta-objective, another place in its cell),
  // « Réorganiser » only sorts the lanes. A click stays a click (the drag starts after 4 px).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: o.id,
    disabled: !drag,
  });
  return (
    <div
      ref={setNodeRef}
      {...(drag ? { ...attributes, ...listeners } : {})}
      className="card flex flex-col gap-2"
      style={{
        padding: '12px 14px 12px 12px',
        borderLeft: `4px solid ${dl.color(o.domainId)}`,
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 30 : undefined,
        position: 'relative',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,.18)' : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <Link to="/objectifs/$id" params={{ id: o.id }} className="text-[15px] font-semibold leading-snug">
          {o.title}
        </Link>
        {o.recurrence && (
          <span title={o.recurrence === 'yearly' ? 'Revient chaque année' : 'Revient chaque trimestre'}>
            ↻
          </span>
        )}
        {o.status !== 'active' && <StatusPill>{STATUS_LABEL[o.status]}</StatusPill>}
      </div>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
        <span className="flex-1 min-w-0 truncate">
          {o.smartIndicator ? `${o.smartIndicator} : ${o.smartCurrent || '—'} → ${o.smartTarget || '—'}` : ''}
        </span>
        <span className="mono flex-none">{fmtDate(o.deadline)}</span>
      </div>
      <Progress pct={o.progressPct} />
      {o.path.length === 0 ? (
        onAddProject ? (
          <button
            type="button"
            className="btn btn-sm self-start"
            onClick={() => onAddProject({ id: o.id, title: o.title })}
          >
            + projet
          </button>
        ) : (
          <span className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
            Aucun projet sur ce chemin
          </span>
        )
      ) : (
        <ol className="m-0 p-0 list-none flex flex-col" style={{ borderTop: '1px solid var(--divider)' }}>
          {o.path.map((p, i) => (
            <li
              key={p.id}
              className="flex items-center gap-2 text-[13px]"
              style={{
                minHeight: 30,
                borderBottom: i < o.path.length - 1 ? '1px solid var(--divider)' : undefined,
              }}
            >
              <span className="mono text-[11px] flex-none" style={{ width: 14, color: 'var(--text-ghost)' }}>
                {i + 1}
              </span>
              <PathStatus p={p} />
              <span className="dot" style={{ background: dl.color(p.domainIds[0]), width: 6, height: 6 }} />
              <Link
                to="/projets/$id"
                params={{ id: p.id }}
                className="flex-1 min-w-0 truncate"
                style={{
                  color:
                    p.status === 'done'
                      ? 'var(--text-faint)'
                      : p.status === 'idea'
                        ? 'var(--text-muted)'
                        : 'var(--text)',
                  fontWeight: p.status === 'active' ? 600 : 400,
                }}
                title={p.title}
              >
                {p.title}
              </Link>
              {p.monthFlag && (
                <span title={`Projet du mois (${p.monthFlag})`} style={{ color: 'var(--experience)' }}>
                  ★
                </span>
              )}
              {p.blocked && (
                <span style={{ color: 'var(--text-ghost)' }}>
                  <LockIcon />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * D-65: upcoming occurrence of a recurring objective (not created yet): a dashed, muted card so that the
 * load recurrences will bring stays visible when planning ahead. Not draggable; links to the current one.
 */
function MapUpcoming({
  o,
  deadline,
}: {
  o: ObjectivesMap['lanes'][number]['objectives'][number];
  deadline: string;
}) {
  const dl = useDomainLookup();
  return (
    <Link
      to="/objectifs/$id"
      params={{ id: o.id }}
      className="flex flex-col gap-1 rounded-[14px] hover:no-underline"
      style={{
        padding: '10px 14px 10px 12px',
        border: '1.5px dashed var(--btn-border)',
        borderLeft: `4px solid ${dl.color(o.domainId)}`,
        opacity: 0.75,
      }}
      title="Occurrence à venir : créée quand l'actuelle sera close"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--text-2)' }}>
          {o.title}
        </span>
        <span aria-hidden style={{ color: 'var(--text-faint)' }}>
          ↻
        </span>
      </span>
      <span className="flex justify-between gap-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
        <span>À venir · {o.recurrence === 'yearly' ? 'chaque année' : 'chaque trimestre'}</span>
        <span className="mono">{fmtDate(deadline)}</span>
      </span>
    </Link>
  );
}

/** A (lane, quarter) cell of the map: drop target for an objective card, sortable inside (D-69). */
/** Last day of a quarter (« 2026-Q4 » → 2026-12-31): the deadline of an objective added from its cell. */
function quarterEnd(qt: string) {
  const [y, q] = [Number(qt.slice(0, 4)), Number(qt.slice(-1))];
  const last = new Date(Date.UTC(y, q * 3, 0)).getUTCDate();
  return `${y}-${String(q * 3).padStart(2, '0')}-${last}`;
}

/** « 2026-10-27 » → « 2026-Q4 ». */
function quarterOfDate(d: string) {
  return `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
}

/** D-75: quarters offered when creating an objective: the current one and the next four (+ the preset one). */
function quarterChoices(today: string | undefined, deadline: string) {
  if (!today) return deadline ? [quarterOfDate(deadline)] : [];
  let [y, q] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) / 3];
  q = Math.ceil(q);
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    out.push(`${y}-Q${q}`);
    if (++q > 4) [y, q] = [y + 1, 1];
  }
  const cur = deadline && quarterOfDate(deadline);
  if (cur && !out.includes(cur)) out.push(cur);
  return out;
}

function QuarterCell({
  id,
  ids,
  onAdd,
  children,
}: {
  id: string;
  ids: string[];
  onAdd?: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="flex flex-col gap-3 rounded-[14px]"
      style={{
        background: 'var(--bin)',
        padding: 8,
        minHeight: 80,
        outline: isOver ? '2px dashed var(--text-ghost)' : undefined,
      }}
    >
      {onAdd && (
        <button
          type="button"
          className="icon-btn self-start"
          style={{ width: 26, height: 26, minHeight: 0, marginBottom: -4 }}
          aria-label="Ajouter un objectif sur ce trimestre"
          title="Ajouter un objectif sur ce trimestre (deadline : fin du trimestre)"
          onClick={onAdd}
        >
          +
        </button>
      )}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

function ObjectivesMapView({
  includeClosed,
  reorg,
  drag,
  onEditMeta,
  onCreateIn,
}: {
  includeClosed: boolean;
  reorg: boolean;
  drag: boolean;
  onEditMeta: (m: MetaObjective) => void;
  onCreateIn: (p: { metaObjectiveId: string; deadline: string }) => void;
}) {
  const q = useQuery({
    queryKey: ['objectives-map', includeClosed],
    queryFn: () => get<ObjectivesMap>(`/objectives/map${includeClosed ? '?includeClosed=true' : ''}`),
  });
  const sensors = useSortSensors();
  const place = useAction(
    ({ id, ...body }: { id: string; metaObjectiveId: string | null; quarter: string; ids: string[] }) =>
      post(`/objectives/${id}/place`, body),
  );
  const reorderMetas = useAction((ids: string[]) => post('/meta-objectives/reorder', { ids }));
  const [addingTo, setAddingTo] = useState<{ id: string; title: string } | null>(null);
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const { quarters, lanes, currentQuarter } = q.data;
  const metaKey = (id: string | null | undefined) => id ?? 'none';
  const cellIds = (meta: string, qt: string) =>
    (lanes.find((l) => metaKey(l.meta?.id) === meta)?.objectives ?? [])
      .filter((o) => o.quarter === qt)
      .map((o) => o.id);
  const laneIds = lanes.map((l) => `lane:${metaKey(l.meta?.id)}`);
  /** Lanes only collide with lanes, cards with cards and cells (the card under the pointer wins). */
  const collision: CollisionDetection = (args) => {
    const lane = String(args.active.id).startsWith('lane:');
    const droppableContainers = args.droppableContainers.filter(
      (c) => String(c.id).startsWith('lane:') === lane,
    );
    const within = pointerWithin({ ...args, droppableContainers });
    if (within.length)
      return [...within].sort(
        (a, b) => Number(String(a.id).includes('|')) - Number(String(b.id).includes('|')),
      );
    return closestCenter({ ...args, droppableContainers });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || active === over) return;
    if (active.startsWith('lane:')) {
      const from = laneIds.indexOf(active);
      const to = laneIds.indexOf(over);
      if (from >= 0 && to >= 0) reorderMetas.mutate(arrayMove(laneIds, from, to).map((x) => x.slice(5)));
      return;
    }
    const o = lanes.flatMap((l) => l.objectives).find((x) => x.id === active);
    if (!o) return;
    // Target cell: the cell itself (dropped in its empty part: at the end) or the card it was dropped on.
    let meta: string;
    let qt: string;
    let overCard: string | null = null;
    if (over.includes('|')) [meta, qt] = over.split('|');
    else {
      const target = lanes.flatMap((l) => l.objectives.map((x) => ({ l, x }))).find((t) => t.x.id === over);
      if (!target) return;
      meta = metaKey(target.l.meta?.id);
      qt = target.x.quarter;
      overCard = over;
    }
    const sameCell = meta === metaKey(o.metaObjectiveId) && qt === o.quarter;
    let ids = cellIds(meta, qt);
    if (sameCell) {
      if (!overCard) return;
      ids = arrayMove(ids, ids.indexOf(active), ids.indexOf(overCard));
    } else {
      const at = overCard ? ids.indexOf(overCard) : ids.length;
      ids = [...ids.slice(0, at), active, ...ids.slice(at)];
    }
    place.mutate({ id: active, metaObjectiveId: meta === 'none' ? null : meta, quarter: qt, ids });
  };
  if (!lanes.length) return <Empty>Aucun objectif pour l'instant.</Empty>;
  /** Objectives of a quarter, recurring ones to come included (D-65): the load at a glance. */
  const loadLabel = (qt: string) => {
    const all = lanes.flatMap((l) => l.objectives);
    const real = all.filter((o) => o.quarter === qt).length;
    const upcoming = all.filter((o) => o.upcoming.some((u) => u.quarter === qt)).length;
    const n = real + upcoming;
    if (!n) return 'aucun objectif';
    return `${n} objectif${n > 1 ? 's' : ''}${upcoming ? ` dont ${upcoming} à venir` : ''}`;
  };
  const cols = `220px repeat(${Math.max(1, quarters.length)}, minmax(280px, 1fr))`;
  const legend: [ReactNode, string][] = [
    [<PathStatus key="d" p={{ status: 'done' } as never} />, 'terminé'],
    [<PathStatus key="a" p={{ status: 'active' } as never} />, 'actif'],
    [<PathStatus key="p" p={{ status: 'paused' } as never} />, 'en pause'],
    [<PathStatus key="i" p={{ status: 'idea' } as never} />, 'idée'],
    [
      <span key="s" style={{ color: 'var(--experience)' }}>
        ★
      </span>,
      'projet du mois',
    ],
    [<LockIcon key="l" />, 'attend le projet précédent'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-[12px]" style={{ color: 'var(--text-faint)' }}>
        {reorg ? (
          <span>
            Trie les lignes (« Sans méta-objectif » comprise) par leur poignée ⠿. Les cartes, elles, se
            glissent hors de ce mode vers un autre trimestre ou un autre méta-objectif.
          </span>
        ) : (
          legend.map(([icon, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              {icon}
              {label}
            </span>
          ))
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}>
        <SortableContext items={laneIds} strategy={verticalListSortingStrategy}>
          <div className="overflow-x-auto">
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: cols, minWidth: 220 + Math.max(1, quarters.length) * 292 }}
            >
              <span />
              {quarters.map((qt) => (
                <div
                  key={qt}
                  className="label-caps px-1"
                  style={{ fontSize: 12, opacity: qt < currentQuarter ? 0.6 : 1 }}
                >
                  {quarterLabel(qt)}
                  {qt === currentQuarter ? ' · en cours' : qt < currentQuarter ? ' · passé' : ''}
                  <span className="block normal-case font-normal" style={{ letterSpacing: 0 }}>
                    {loadLabel(qt)}
                  </span>
                </div>
              ))}
              {lanes.map((l) => (
                <Fragment key={l.meta?.id ?? 'none'}>
                  <LaneHeader id={`lane:${metaKey(l.meta?.id)}`} reorg={reorg}>
                    <div className="flex items-start justify-between gap-1">
                      {l.meta ? (
                        <Link
                          to="/meta-objectifs/$id"
                          params={{ id: l.meta.id }}
                          className="text-[16px] font-bold leading-snug"
                        >
                          {l.meta.title}
                        </Link>
                      ) : (
                        <span className="text-[16px] font-bold leading-snug">Sans méta-objectif</span>
                      )}
                      {l.meta && (
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ width: 28, height: 28 }}
                          aria-label={`Modifier ${l.meta.title}`}
                          onClick={() => onEditMeta(l.meta!)}
                        >
                          <PencilIcon />
                        </button>
                      )}
                    </div>
                    {l.meta?.horizonDate && (
                      <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                        horizon {fmtDate(l.meta.horizonDate)}
                      </span>
                    )}
                    {l.meta && l.meta.status !== 'active' && (
                      <StatusPill>{STATUS_LABEL[l.meta.status]}</StatusPill>
                    )}
                  </LaneHeader>
                  {quarters.map((qt) => (
                    <QuarterCell
                      key={qt}
                      id={`${metaKey(l.meta?.id)}|${qt}`}
                      ids={cellIds(metaKey(l.meta?.id), qt)}
                      onAdd={
                        qt < currentQuarter || reorg
                          ? undefined
                          : () => onCreateIn({ metaObjectiveId: l.meta?.id ?? '', deadline: quarterEnd(qt) })
                      }
                    >
                      {l.objectives
                        .filter((o) => o.quarter === qt)
                        .map((o) => (
                          <MapObjective key={o.id} o={o} drag={drag && !reorg} onAddProject={setAddingTo} />
                        ))}
                      {l.objectives.flatMap((o) =>
                        o.upcoming
                          .filter((u) => u.quarter === qt)
                          .map((u) => <MapUpcoming key={`${o.id}|${qt}`} o={o} deadline={u.deadline} />),
                      )}
                    </QuarterCell>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        </SortableContext>
      </DndContext>
      {addingTo && <NewProjectPanel open onClose={() => setAddingTo(null)} objective={addingTo} />}
    </div>
  );
}

/** D-69, D-73: header of a lane; « Réorganiser » only shows its handle ⠿ to sort the meta-objectives. */
function LaneHeader({ id, reorg, children }: { id: string; reorg: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !reorg,
  });
  return (
    <div
      ref={setNodeRef}
      className="bin flex gap-2"
      style={{
        padding: '14px 14px 16px',
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 30 : undefined,
        position: 'relative',
        boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,.18)' : undefined,
      }}
    >
      {reorg && (
        <button
          type="button"
          className="icon-btn flex-none cursor-grab"
          style={{ width: 28, height: 28, touchAction: 'none' }}
          aria-label="Déplacer le méta-objectif"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      )}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** Méta-objectif page: description under the title (the heart of the long-term goal), its objectives. */
export function MetaObjectivePage({ id }: { id: string }) {
  const meta = useQuery({
    queryKey: ['meta-objective', id],
    queryFn: () => get<MetaObjective>(`/meta-objectives/${id}`),
  });
  const map = useQuery({
    queryKey: ['objectives-map', true],
    queryFn: () => get<ObjectivesMap>('/objectives/map?includeClosed=true'),
  });
  const [editing, setEditing] = useState(false);
  const [addingTo, setAddingTo] = useState<{ id: string; title: string } | null>(null);
  const saveDescription = useAction(
    (description: string) => patch(`/meta-objectives/${id}`, { description }),
    { toast: 'Description enregistrée.' },
  );
  if (meta.isError) return <ErrorBox error={meta.error} />;
  if (!meta.data) return <Loading />;
  const m = meta.data;
  const objectives = map.data?.lanes.find((l) => l.meta?.id === id)?.objectives ?? [];
  const open = objectives.filter((o) => o.status === 'active' || o.status === 'paused');
  const avg = open.length ? Math.round(open.reduce((a, o) => a + o.progressPct, 0) / open.length) : 0;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Objectifs', to: '/objectifs' }, { label: m.title }]} />
        <PageHeader
          eyebrow={`Méta-objectif${m.horizonDate ? ` · horizon ${fmtDate(m.horizonDate)}` : ''} · ${STATUS_LABEL[m.status]}`}
          title={m.title}
          actions={
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <PencilIcon /> Modifier
            </button>
          }
        />
      </div>
      <DescriptionBlock
        text={m.description}
        ai={{ kind: 'meta_objective', id: m.id }}
        lines={16}
        saving={saveDescription.isPending}
        emptyLabel="Pas encore de description : pourquoi ce cap compte, à quoi ressemble la réussite, l'horizon."
        onSave={(text, done) => saveDescription.mutate(text, { onSuccess: done })}
      />
      <section className="bin flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="h2-bin">Objectifs</h2>
          <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {open.length} ouvert{open.length > 1 ? 's' : ''} · avancement moyen {avg} %
          </span>
        </div>
        {objectives.length === 0 && <Empty>Aucun objectif rattaché. Rattache-en depuis leur fiche.</Empty>}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {objectives.map((o) => (
            <div key={o.id} className="flex flex-col gap-1">
              <span className="label-caps px-1" style={{ fontSize: 11 }}>
                {quarterLabel(o.quarter)}
              </span>
              <MapObjective o={o} onAddProject={setAddingTo} />
            </div>
          ))}
        </div>
      </section>
      {editing && <MetaPanel open meta={m} onClose={() => setEditing(false)} />}
      {addingTo && <NewProjectPanel open onClose={() => setAddingTo(null)} objective={addingTo} />}
    </div>
  );
}
