// "Planifier la semaine" (V-16, V-17) — mockup planifier-la-semaine.dc.html. Everything is computed by the API
// (GET /week-plans/{week}); the page only sends the selection back.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AiProposeButton } from '../components/ai.tsx';
import { Breadcrumb } from '../components/shell.tsx';
import {
  DomainBars,
  Duration,
  ErrorBox,
  ExperienceBadge,
  Field,
  Loading,
  PageHeader,
  Panel,
  SAVE_HINT,
  Tabs,
  useDomainRows,
} from '../components/ui.tsx';
import { get, patch, post, put } from '../lib/api.ts';
import { fmtMin, shiftIsoWeek, weekNumber } from '../lib/format.ts';
import { useAction, useDomainLookup, useMe, useSettings } from '../lib/hooks.ts';
import type { PageTask, PlanningPage } from '../lib/types.ts';
import { MonthPlanPage } from './plan-month.tsx';
import { PlanViewPage } from './plan-view.tsx';
import { Chevron } from './week.tsx';

/** Default week to plan: the current one Monday–Thursday, the next one from Friday (display choice only). */
export function defaultPlanningWeek(currentWeek: string, today: string) {
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  return day === 5 || day === 6 || day === 0 ? shiftIsoWeek(currentWeek, 1) : currentWeek;
}

export function PlanPage({
  semaine,
  vue,
  mois,
}: {
  semaine?: string;
  vue?: 'mois' | 'trimestre';
  mois?: string;
}) {
  const navigate = useNavigate();
  const tabs = (
    <div>
      <Tabs
        value={vue ?? 'semaine'}
        onChange={(v) => navigate({ to: '/planifier', search: v === 'semaine' ? {} : { vue: v } })}
        options={[
          { value: 'semaine', label: 'Semaine' },
          { value: 'mois', label: 'Mois' },
          { value: 'trimestre', label: 'Plan (trimestres)' },
        ]}
      />
    </div>
  );
  if (vue === 'mois') return <MonthPlanPage mois={mois} tabs={tabs} />;
  // memento-vue-plan V-20: the Vue Plan replaces the former quarter page (and the « Carte » of Objectifs).
  if (vue === 'trimestre') return <PlanViewPage tabs={tabs} />;
  return <WeekPlanPage semaine={semaine} tabs={tabs} />;
}

function WeekPlanPage({ semaine, tabs }: { semaine?: string; tabs: React.ReactNode }) {
  const me = useMe();
  const week = semaine ?? (me.data ? defaultPlanningWeek(me.data.currentWeek, me.data.today) : undefined);
  const q = useQuery({
    queryKey: ['plan', week],
    queryFn: () => get<PlanningPage>(`/week-plans/${week}`),
    enabled: !!week,
  });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data || !week) return <Loading />;
  return <Plan page={q.data} tabs={tabs} />;
}

function Plan({ page, tabs }: { page: PlanningPage; tabs: React.ReactNode }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const dl = useDomainLookup();
  const w = page.isoWeek;
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const setItems = useAction((items: { taskId: string; kind: 'week' | 'bonus' }[]) =>
    put<PlanningPage>(`/week-plans/${w}/items`, { items }),
  );
  const proposeAction = useAction(() => post(`/week-plans/${w}/propose`), {
    toast: 'Proposition du moteur prête.',
  });

  const toggle = (taskId: string, kind: 'week' | 'bonus') => {
    const current = page.items.map((i) => ({ taskId: i.taskId, kind: i.kind }));
    const existing = current.find((i) => i.taskId === taskId);
    const next =
      existing?.kind === kind
        ? current.filter((i) => i.taskId !== taskId)
        : [...current.filter((i) => i.taskId !== taskId), { taskId, kind }];
    setItems.mutate(next);
  };
  const over = page.budget.overMin > 0;
  const mixRows = useDomainRows(page.mix);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {tabs}
        <Breadcrumb
          items={[{ label: 'Planifier', to: '/planifier' }, { label: `Semaine ${weekNumber(w)}` }]}
        />
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-sm btn-ghost px-1 flex-none"
                aria-label="Semaine précédente"
                onClick={() => navigate({ to: '/planifier', search: { semaine: shiftIsoWeek(w, -1) } })}
              >
                ‹
              </button>
              <span className="min-w-0">
                Planification · semaine {weekNumber(w)} · {page.label}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost px-1 flex-none"
                aria-label="Semaine suivante"
                onClick={() => navigate({ to: '/planifier', search: { semaine: shiftIsoWeek(w, 1) } })}
              >
                ›
              </button>
            </span>
          }
          title="Planifier la semaine"
          actions={
            <>
              {(!page.plan?.proposedAt || settings.data?.['ui.show_recalculate']) && (
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 44 }}
                  onClick={() => proposeAction.mutate(undefined)}
                  disabled={proposeAction.isPending}
                  title="Recalcule la proposition avec les données du moment (tâches ajoutées ou faites, budget, priorités). Tes choix sont conservés."
                >
                  {page.plan?.proposedAt ? 'Recalculer' : 'Proposer'}
                </button>
              )}
              <AiProposeButton scope="week" period={w} weekItems={page.items} />
            </>
          }
        />
      </div>

      <div className="flex flex-wrap gap-6 items-start">
        <div className="min-w-0 flex flex-col gap-6" style={{ flex: '999 1 640px' }}>
          {page.groups.map((g) => (
            <section key={g.key} className="bin flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-2.5" style={{ padding: '0 2px 4px' }}>
                <h2 className="h2-bin">{g.name}</h2>
                <span
                  className="text-[12px] font-semibold rounded-full"
                  style={{ color: 'var(--text-2)', background: 'var(--surface)', padding: '2px 9px' }}
                >
                  {g.countLabel}
                </span>
                {g.hint && (
                  <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    {g.hint}
                  </span>
                )}
              </div>
              {g.cards.length === 0 && (
                <div className="text-[14px] px-1" style={{ color: 'var(--text-faint)' }}>
                  {g.key === 'inbox'
                    ? 'Inbox vide.'
                    : g.key === 'month'
                      ? 'Aucun projet du mois : choisis-les dans Planifier › Mois.'
                      : 'Rien d’autre à proposer.'}
                </div>
              )}
              {g.cards.map((c) => (
                <ProjectCard
                  key={c.projectId ?? 'inbox'}
                  card={c}
                  color={dl.color(c.domainId)}
                  domainName={c.projectId ? dl.name(c.domainId) : ''}
                  onToggle={toggle}
                  busy={setItems.isPending}
                />
              ))}
              {g.key === 'consider' && page.more.length > 0 && (
                <button type="button" className="btn btn-sm self-start" onClick={() => setMoreOpen(true)}>
                  + Tâche d'un autre projet
                </button>
              )}
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-4 min-w-0" style={{ flex: '1 1 340px' }}>
          <section className="card flex flex-col gap-2.5" style={{ padding: '18px 20px' }}>
            <div className="flex justify-between items-baseline">
              <h2 className="h2">Budget</h2>
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                hors expériences
              </span>
            </div>
            <div className="mono" style={{ fontSize: 28 }}>
              {page.budget.plannedMin ? fmtMin(page.budget.plannedMin) : '0 h'}{' '}
              <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>
                / {fmtMin(page.budget.budgetMin)}
              </span>
            </div>
            <div className="track" style={{ height: 10, background: 'var(--track)' }}>
              <div
                style={{
                  height: 10,
                  width: `${Math.min(100, Math.round((page.budget.plannedMin / Math.max(1, page.budget.budgetMin)) * 100))}%`,
                  background: over ? 'var(--warn)' : 'var(--text)',
                  borderRadius: 999,
                }}
              />
            </div>
            <div
              className="text-[13px] font-medium"
              style={{ color: over ? 'var(--late-text)' : 'var(--ok)' }}
            >
              {over
                ? `+${fmtMin(page.budget.overMin)} au-delà du budget`
                : `Reste ${fmtMin(page.budget.remainingMin)}`}
            </div>
            <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {page.counts.week} tâche(s) · {page.counts.experiences} expérience(s) · {page.counts.bonus}{' '}
              bonus
            </div>
            <button
              type="button"
              className="text-left text-[12px] border-0 bg-transparent p-0 cursor-pointer underline"
              style={{ color: 'var(--text-faint)' }}
              onClick={() => setBudgetOpen(true)}
            >
              {page.plan?.budgetReason
                ? `Budget ajusté : ${page.plan.budgetReason}`
                : 'Ajuster le budget de cette semaine'}
            </button>
          </section>

          <section className="card flex flex-col gap-2.5" style={{ padding: '18px 20px' }}>
            <h2 className="h2">Alertes</h2>
            {page.alerts.map((a) => (
              <div key={a.code + a.text} className="flex gap-2.5 items-start text-[14px]">
                <span
                  className="dot"
                  style={{
                    marginTop: 6,
                    background: a.level === 'ok' ? 'var(--status-green)' : 'var(--warn)',
                  }}
                />
                <span style={{ color: 'var(--text-2)' }}>{a.text}</span>
              </div>
            ))}
          </section>

          <section className="card flex flex-col gap-2.5" style={{ padding: '18px 20px' }}>
            <h2 className="h2">Répartition prévue</h2>
            <DomainBars rows={mixRows} />
            <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              Par ordre de priorité · expériences incluses
            </div>
          </section>
        </aside>
      </div>
      {budgetOpen && <BudgetPanel open onClose={() => setBudgetOpen(false)} page={page} />}
      {moreOpen && (
        <MorePanel
          page={page}
          onClose={() => setMoreOpen(false)}
          onToggle={toggle}
          busy={setItems.isPending}
        />
      )}
    </div>
  );
}

function ProjectCard({
  card,
  color,
  domainName,
  onToggle,
  busy,
}: {
  card: PlanningPage['groups'][number]['cards'][number];
  color: string;
  domainName: string;
  onToggle: (taskId: string, kind: 'week' | 'bonus') => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hidden = card.hidden.length;
  const nb = `${hidden} ${hidden > 1 ? 'autres tâches' : 'autre tâche'}`;
  const inbox = !card.projectId;
  const dueHidden = card.hiddenDueCount;
  return (
    <div
      className="overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}
    >
      {!inbox && (
        <div
          className="flex flex-wrap items-center gap-2.5"
          style={{ padding: '14px 18px', borderBottom: '1px solid var(--divider-2)' }}
        >
          <span className="dot" style={{ width: 10, height: 10, background: color }} />
          {card.projectId ? (
            <Link to="/projets/$id" params={{ id: card.projectId }} className="text-[16px] font-semibold">
              {card.title}
            </Link>
          ) : (
            <Link to="/inbox" className="text-[16px] font-semibold">
              Inbox
            </Link>
          )}
          {domainName && (
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              {domainName}
            </span>
          )}
          {card.objectiveId && (
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              · Objectif :{' '}
              <Link to="/objectifs/$id" params={{ id: card.objectiveId }} style={{ color: 'var(--text-2)' }}>
                {card.objectiveTitle}
              </Link>
            </span>
          )}
          {/* DM-106: information only, a prerequisite never blocks the week. */}
          {card.waitingOn.length > 0 && (
            <span className="text-[12px] w-full" style={{ color: 'var(--text-faint)' }}>
              Attend {card.waitingOn.map((w) => `« ${w} »`).join(', ')}
            </span>
          )}
        </div>
      )}
      {card.tasks.map((t) => (
        <PlanTaskRow key={t.taskId} t={t} projectId={card.projectId} onToggle={onToggle} busy={busy} />
      ))}
      {hidden > 0 && (
        <>
          {open && inbox && (
            <div style={{ background: 'var(--surface-2)' }}>
              {card.hiddenTasks.map((t) => (
                <PlanTaskRow key={t.taskId} t={t} projectId={null} onToggle={onToggle} busy={busy} />
              ))}
            </div>
          )}
          {open && !inbox && (
            <div style={{ background: 'var(--surface-2)' }}>
              {card.hidden.map((h) => (
                <div
                  key={h.taskId}
                  className="row-line flex items-center gap-3"
                  style={{
                    padding: '8px 18px',
                    color: 'var(--text-faint)',
                  }}
                >
                  <span className="flex-1 min-w-0 text-[14px]">{h.title}</span>
                  <span className="mono flex-none text-[12px]">
                    {h.durationMin ? fmtMin(h.durationMin) : '?'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-2 w-full border-0 text-left cursor-pointer"
            style={{
              minHeight: 40,
              padding: '0 18px',
              background: 'var(--surface)',
              fontSize: 13,
              color: dueHidden && !open ? 'var(--late-text)' : 'var(--text-faint)',
              fontWeight: dueHidden && !open ? 600 : undefined,
            }}
          >
            <Chevron open={open} size={12} />
            {open ? `Masquer les ${nb}` : `+ ${nb} ${inbox ? "dans l'Inbox" : 'dans le projet'}`}
            {dueHidden > 0 && !open && (
              <span className="flex items-center gap-1.5 ml-auto">
                <WarnIcon />
                dont {dueHidden} avec une deadline cette semaine : à prendre en compte
              </span>
            )}
          </button>
        </>
      )}
    </div>
  );
}

function PlanTaskRow({
  t,
  projectId,
  onToggle,
  busy,
}: {
  t: PageTask;
  projectId: string | null;
  onToggle: (id: string, k: 'week' | 'bonus') => void;
  busy: boolean;
}) {
  const week = t.selection === 'week';
  const bonus = t.selection === 'bonus';
  return (
    <div
      className="row-line flex flex-wrap items-center gap-3"
      style={{
        padding: '10px 18px',
        background: week ? 'var(--row-week)' : bonus ? 'var(--row-bonus)' : 'var(--surface)',
        opacity: t.locked ? 0.45 : 1,
      }}
    >
      <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: '1 1 260px' }}>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={projectId ? '/projets/$id' : '/inbox'}
            params={projectId ? { id: projectId } : undefined}
            search={{ tache: t.taskId } as never}
            className="text-[15px] font-medium"
          >
            {t.title}
          </Link>
          {t.isExperience && <ExperienceBadge />}
        </div>
        <span
          className="text-[12px]"
          style={{ color: t.mandatory ? 'var(--late-text)' : 'var(--text-faint)' }}
        >
          {t.why}
        </span>
      </div>
      <Duration min={t.durationMin} />
      <button
        type="button"
        onClick={() => onToggle(t.taskId, 'week')}
        disabled={t.locked || busy}
        aria-pressed={week}
        className="btn btn-sm flex-none"
        style={{
          minWidth: 104,
          fontWeight: 600,
          background: week ? 'var(--primary)' : 'var(--surface)',
          color: week ? 'var(--primary-text)' : 'var(--text)',
          borderColor: week ? 'var(--primary)' : 'var(--btn-border)',
        }}
      >
        {week ? '✓ Semaine' : '+ Semaine'}
      </button>
      <button
        type="button"
        onClick={() => onToggle(t.taskId, 'bonus')}
        disabled={t.locked || busy}
        aria-pressed={bonus}
        className="btn btn-sm flex-none"
        style={{
          background: bonus ? 'var(--bin)' : 'var(--surface)',
          color: 'var(--text-2)',
          borderColor: bonus ? 'var(--text-ghost)' : 'var(--border)',
        }}
      >
        {bonus ? '✓ Bonus' : 'Bonus'}
      </button>
    </div>
  );
}

const fold = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * D-79: any task of another active or ready project (not a month project, not in « À considérer aussi »). A
 * chosen task then shows under « À considérer aussi »; its project stays in the panel until it closes.
 */
function MorePanel({
  page,
  onClose,
  onToggle,
  busy,
}: {
  page: PlanningPage;
  onClose: () => void;
  onToggle: (taskId: string, kind: 'week' | 'bonus') => void;
  busy: boolean;
}) {
  const dl = useDomainLookup();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const considered = page.groups.find((g) => g.key === 'consider')?.cards ?? [];
  const cards = [...page.more, ...considered.filter((c) => c.projectId && picked.includes(c.projectId))].sort(
    (a, b) => a.title.localeCompare(b.title),
  );
  const needle = fold(q.trim());
  const shown = needle
    ? cards
        .map((c) =>
          fold(c.title).includes(needle)
            ? c
            : { ...c, tasks: c.tasks.filter((t) => fold(t.title).includes(needle)) },
        )
        .filter((c) => c.tasks.length)
    : cards;
  return (
    <Panel open onClose={onClose} title="Tâche d'un autre projet">
      <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Projets actifs ou prêts hors projets du mois, par exemple un projet que tu démarres en fin de mois.
        Une tâche choisie rejoint « À considérer aussi ».
      </p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Chercher un projet ou une tâche"
        aria-label="Chercher un projet ou une tâche"
      />
      {shown.length === 0 && (
        <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
          Aucun projet ne correspond.
        </div>
      )}
      {shown.map((c) => (
        <ProjectCard
          key={c.projectId}
          card={c}
          color={dl.color(c.domainId)}
          domainName={dl.name(c.domainId)}
          onToggle={(taskId, kind) => {
            if (c.projectId && !picked.includes(c.projectId)) setPicked([...picked, c.projectId]);
            onToggle(taskId, kind);
          }}
          busy={busy}
        />
      ))}
    </Panel>
  );
}

function BudgetPanel({ open, onClose, page }: { open: boolean; onClose: () => void; page: PlanningPage }) {
  const [hours, setHours] = useState(String((page.budget.budgetMin / 60).toString()));
  const [reason, setReason] = useState(page.plan?.budgetReason ?? '');
  const save = useAction(
    (v: { budgetMin: number | null; budgetReason?: string | null }) =>
      patch(`/week-plans/${page.isoWeek}`, v),
    { onSuccess: onClose, toast: 'Budget de la semaine mis à jour.' },
  );
  const startHours = String(page.budget.budgetMin / 60);
  const startReason = page.plan?.budgetReason ?? '';
  /** D-40: closing saves when something changed; Escape discards. */
  const close = () => {
    if (hours !== startHours || reason !== startReason)
      save.mutate({ budgetMin: Math.round(Number(hours) * 60), budgetReason: reason || null });
    else onClose();
  };
  return (
    <Panel
      open={open}
      onClose={close}
      onCancel={onClose}
      hint={SAVE_HINT}
      title={`Budget · semaine ${weekNumber(page.isoWeek)}`}
    >
      <Field
        label="Heures disponibles cette semaine"
        info="Surcharge ponctuelle de cette semaine seulement. Le budget par défaut se règle dans Configuration › Général."
      >
        <input type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
      </Field>
      <Field
        label="Contexte"
        info="Pourquoi cette semaine est différente : fatigue, maladie, jour posé, sommeil, événement… Le texte est journalisé, figé dans le rapport de la semaine et lisible par l'IA (API / MCP) pour croiser plus tard avec tes données de santé."
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ex. grosse fatigue, mal dormi toute la semaine ; jour posé vendredi"
          style={{ minHeight: 140 }}
        />
      </Field>
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={() => save.mutate({ budgetMin: null })}>
          Revenir au budget par défaut
        </button>
      </div>
    </Panel>
  );
}

function WarnIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M8 1.8 15 14H1Z" strokeLinejoin="round" />
      <path d="M8 6.2v3.6" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.4" fill="currentColor" />
    </svg>
  );
}
