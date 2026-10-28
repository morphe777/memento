// "Ma semaine" (V-06, V-13, V-18) — mockups ma-semaine.dc.html and ma-semaine-iphone.dc.html.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Breadcrumb } from '../components/shell.tsx';
import { ActualTime } from '../components/tasks.tsx';
import {
  BonusBadge,
  DelayBar,
  DomainBars,
  Duration,
  Empty,
  ErrorBox,
  ExperienceBadge,
  Kpi,
  Loading,
  PageHeader,
  Panel,
  TaskCheck,
  useDomainRows,
} from '../components/ui.tsx';
import { get, post } from '../lib/api.ts';
import { fmtDateShort, fmtMin, shiftIsoWeek, weekNumber } from '../lib/format.ts';
import { useAction, useDomainLookup, useIsPhone, useMe } from '../lib/hooks.ts';
import type { Execution } from '../lib/types.ts';

type Row = Execution['tasks'][number];

export function WeekPage({ semaine }: { semaine?: string }) {
  const me = useMe();
  const week = semaine ?? me.data?.currentWeek;
  const q = useQuery({
    queryKey: ['execution', week],
    queryFn: () => get<Execution>(`/weeks/${week}/execution`),
    enabled: !!week,
  });
  const phone = useIsPhone();
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  return phone ? <WeekPhone ex={q.data} /> : <WeekDesktop ex={q.data} />;
}

function useToggle() {
  return useAction(({ id, done }: { id: string; done: boolean }) =>
    post(`/tasks/${id}/${done ? 'uncomplete' : 'complete'}`),
  );
}

/** Week label with ‹ › to look at the previous / next week (the next one shows what is already planned). */
function WeekNav({ ex }: { ex: Execution }) {
  const navigate = useNavigate();
  const me = useMe();
  const current = me.data?.currentWeek;
  const go = (w: string) => navigate({ to: '/semaine', search: w === current ? {} : { semaine: w } });
  return (
    <span className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        className="btn btn-sm btn-ghost px-1"
        aria-label="Semaine précédente"
        onClick={() => go(shiftIsoWeek(ex.isoWeek, -1))}
      >
        ‹
      </button>
      Semaine {weekNumber(ex.isoWeek)} · {ex.label}
      <button
        type="button"
        className="btn btn-sm btn-ghost px-1"
        aria-label="Semaine suivante"
        onClick={() => go(shiftIsoWeek(ex.isoWeek, 1))}
      >
        ›
      </button>
      {current && ex.isoWeek !== current && (
        <button type="button" className="btn btn-sm" onClick={() => go(current)}>
          {ex.isoWeek > current ? '← Cette semaine' : 'Cette semaine →'}
        </button>
      )}
    </span>
  );
}

function eyebrow(ex: Execution) {
  return <WeekNav ex={ex} />;
}

type Sort = 'domain' | 'deadline';

/** Compact view by default: done tasks and the detail line under each task are hidden until asked for. */
function useWeekView() {
  const [showDone, setShowDone] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [sort, setSort] = useState<Sort>('domain'); // user request 28/10/2026: by domain by default
  return { showDone, setShowDone, showDetail, setShowDetail, sort, setSort };
}

/** Visible tasks in the chosen order; done tasks stay at the bottom, ties keep the plan order. */
function useSortedTasks(ex: Execution, view: ReturnType<typeof useWeekView>) {
  const dl = useDomainLookup();
  const rank = new Map(dl.domains.map((d, i) => [d.id, i]));
  const key = (t: Row): [number, string] =>
    view.sort === 'domain'
      ? [t.domainId ? (rank.get(t.domainId) ?? 998) : 999, '']
      : [t.deadline ? 0 : 1, t.deadline ?? ''];
  const tasks = view.showDone ? ex.tasks : ex.tasks.filter((t) => !t.done);
  return tasks
    .map((t, i) => ({ t, i, k: key(t) }))
    .sort(
      (a, b) =>
        Number(a.t.done) - Number(b.t.done) || a.k[0] - b.k[0] || a.k[1].localeCompare(b.k[1]) || a.i - b.i,
    )
    .map((x) => x.t);
}

function ViewToggles({ view }: { view: ReturnType<typeof useWeekView> }) {
  return (
    <span className="flex items-center gap-4 flex-wrap text-[13px]" style={{ color: 'var(--text-muted)' }}>
      <button
        type="button"
        className="border-0 bg-transparent p-0 cursor-pointer underline underline-offset-2"
        style={{ color: 'inherit', font: 'inherit' }}
        title="Changer le tri"
        onClick={() => view.setSort(view.sort === 'domain' ? 'deadline' : 'domain')}
      >
        {view.sort === 'domain' ? 'Tri par domaine' : 'Tri par deadline'}
      </button>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" checked={view.showDone} onChange={(e) => view.setShowDone(e.target.checked)} />
        Tâches terminées
      </label>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={view.showDetail}
          onChange={(e) => view.setShowDetail(e.target.checked)}
        />
        Détails
      </label>
    </span>
  );
}

function AllDone({ ex }: { ex: Execution }) {
  const done = ex.tasks.length - ex.remaining;
  return (
    <Empty>
      Tout est fait ({done} tâche{done > 1 ? 's' : ''} terminée{done > 1 ? 's' : ''}).
    </Empty>
  );
}

function WeekDesktop({ ex }: { ex: Execution }) {
  const dl = useDomainLookup();
  const toggle = useToggle();
  const [showBonus, setShowBonus] = useState(false); // V-13: always folded by default, state not remembered
  const [replanOpen, setReplanOpen] = useState(false);
  const view = useWeekView();
  const tasks = useSortedTasks(ex, view);
  const mixRows = useDomainRows(ex.domainMix);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Ma semaine' }]} />
        <PageHeader eyebrow={eyebrow(ex)} title="Ma semaine" />
      </div>

      <div className="flex flex-wrap gap-6 items-start">
        <section className="card overflow-hidden min-w-0" style={{ flex: '999 1 640px' }}>
          <div
            className="flex justify-between items-baseline gap-3 flex-wrap"
            style={{ padding: '16px 20px', borderBottom: '1px solid var(--divider-2)' }}
          >
            <h2 className="h2">
              À faire · {ex.remaining} tâche{ex.remaining > 1 ? 's' : ''}
            </h2>
            <ViewToggles view={view} />
          </div>
          {!ex.plan || ex.tasks.length === 0 ? (
            <Empty>
              Pas encore de plan pour cette semaine.{' '}
              <Link to="/planifier" search={{ semaine: ex.isoWeek }} className="underline">
                Planifier la semaine
              </Link>
            </Empty>
          ) : tasks.length === 0 ? (
            <AllDone ex={ex} />
          ) : (
            tasks.map((t) => (
              <WeekRow
                key={t.taskId}
                t={t}
                onToggle={() => toggle.mutate({ id: t.taskId, done: t.done })}
                color={dl.color(t.domainId)}
                domainName={dl.name(t.domainId)}
                detail={view.showDetail}
              />
            ))
          )}
          <button
            type="button"
            onClick={() => setShowBonus((v) => !v)}
            aria-expanded={showBonus}
            className="w-full flex items-center gap-2.5 border-0 text-left cursor-pointer"
            style={{
              padding: '14px 20px',
              background: 'var(--surface-2)',
              borderTop: '1px solid var(--divider)',
              fontSize: 14,
              color: 'var(--text-faint)',
            }}
          >
            <Chevron open={showBonus} />
            <span>Bonus · {ex.bonusOpen.length}</span>
            <span className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
              seulement si j'ai du temps ou de l'énergie en plus
            </span>
          </button>
          {showBonus && (
            <div style={{ background: 'var(--surface-2)' }}>
              {ex.bonusOpen.map((b) => (
                <div
                  key={b.taskId}
                  className="flex gap-3.5 items-center"
                  style={{ padding: '12px 20px', borderTop: '1px solid var(--divider)' }}
                >
                  <span className="dot" style={{ background: dl.color(b.domainId) }} />
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[15px]" style={{ color: 'var(--text-2)' }}>
                      {b.title}
                    </span>
                    {view.showDetail && (
                      <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                        {dl.name(b.domainId)} · <ProjectLink r={b} />
                      </span>
                    )}
                  </div>
                  <span className="mono text-[12px] flex-none" style={{ color: 'var(--text-muted)' }}>
                    {fmtMin(b.durationMin)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => toggle.mutate({ id: b.taskId, done: false })}
                  >
                    Fait
                  </button>
                </div>
              ))}
              {ex.bonusOpen.length === 0 && <Empty>Aucun bonus en attente.</Empty>}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4 min-w-0" style={{ flex: '1 1 340px' }}>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Kpi
              label="Fait"
              minWidth={0}
              foot={
                <div className="track" style={{ height: 6, background: 'var(--track)' }}>
                  <div
                    style={{
                      height: 6,
                      width: `${Math.min(100, Math.round((ex.doneMin / Math.max(1, ex.budget.budgetMin)) * 100))}%`,
                      background: 'var(--text)',
                      borderRadius: 999,
                    }}
                  />
                </div>
              }
            >
              {fmtMin(ex.doneMin)}
            </Kpi>
            <Kpi
              label="Expériences"
              minWidth={0}
              foot={
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  {ex.experiences.windowWeeks} dernières semaines
                </div>
              }
            >
              {ex.experiences.done}{' '}
              <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>/ {ex.experiences.target}</span>
            </Kpi>
          </div>
          <section className="card flex flex-col gap-4" style={{ padding: '18px 20px' }}>
            <div className="flex justify-between items-baseline">
              <h2 className="h2">Projets du mois</h2>
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                centre = à l'heure
              </span>
            </div>
            {ex.monthProjects.length === 0 && (
              <div className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                Aucun projet coché « projet du mois ».
              </div>
            )}
            {ex.monthProjects.map((p) => (
              <DelayBar
                key={p.projectId}
                title={p.title}
                color={dl.color(p.domainId)}
                deltaMin={p.deltaMin}
                to={{ id: p.projectId }}
              />
            ))}
            {ex.monthProjects.length > 0 && (
              <button type="button" className="btn self-start" onClick={() => setReplanOpen(true)}>
                Replanifier
              </button>
            )}
          </section>
          <section className="card flex flex-col gap-2.5" style={{ padding: '18px 20px' }}>
            <h2 className="h2">Domaines cette semaine</h2>
            <DomainBars rows={mixRows} scaleMin={ex.budget.budgetMin} />
          </section>
        </aside>
      </div>
      <ReplanPanel open={replanOpen} onClose={() => setReplanOpen(false)} projects={ex.monthProjects} />
    </div>
  );
}

function ProjectLink({ r }: { r: Pick<Row, 'projectId' | 'projectTitle'> }) {
  return r.projectId ? (
    <Link to="/projets/$id" params={{ id: r.projectId }}>
      {r.projectTitle}
    </Link>
  ) : (
    <Link to="/inbox">Inbox</Link>
  );
}

function WeekRow({
  t,
  onToggle,
  color,
  domainName,
  detail,
}: {
  t: Row;
  onToggle: () => void;
  color: string;
  domainName: string;
  detail: boolean;
}) {
  return (
    <div
      className={`row-line flex gap-3.5 ${detail ? 'items-start' : 'items-center'}`}
      style={{ padding: detail ? '14px 20px' : '10px 20px', opacity: t.done ? 0.65 : 1 }}
    >
      <TaskCheck done={t.done} color={color} onToggle={onToggle} label={t.title} />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[16px] font-semibold"
            style={{ textDecoration: t.done ? 'line-through' : 'none' }}
          >
            {t.title}
          </span>
          {t.isExperience && <ExperienceBadge />}
          {t.kind === 'bonus' && <BonusBadge />}
        </div>
        {detail && (
          <>
            <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              <span className="dot" style={{ background: color }} />
              <span className="font-medium" style={{ color: 'var(--text-2)' }}>
                {domainName}
              </span>
              <span>·</span>
              <ProjectLink r={t} />
            </div>
            {t.why && !t.done && (
              <div className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                {t.why}
              </div>
            )}
          </>
        )}
        {t.done && <ActualTime taskId={t.taskId} durationMin={t.durationMin} actualMin={t.actualMin} />}
      </div>
      <UrgencyTag t={t} />
      <Duration min={t.durationMin} />
    </div>
  );
}

const URGENCY_LABEL = { late: 'En retard', today: "Aujourd'hui" } as const;

/** D-76: discreet tag next to the duration — warning when due within 2 days, stop when due today or late. */
function UrgencyTag({ t, small }: { t: Row; small?: boolean }) {
  if (!t.urgency || !t.deadline) return null;
  const stop = t.urgency !== 'soon';
  const label =
    t.urgency === 'soon' ? (t.daysLeft === 1 ? 'Demain' : `J-${t.daysLeft}`) : URGENCY_LABEL[t.urgency];
  return (
    <span
      className="flex-none inline-flex items-center gap-1 whitespace-nowrap"
      title={`Deadline ${fmtDateShort(t.deadline)}`}
      style={{
        fontSize: small ? 11 : 12,
        fontWeight: 500,
        padding: small ? '2px 7px' : '3px 8px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        color: stop ? 'var(--late-text)' : 'var(--text-muted)',
      }}
    >
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12">
        {stop ? (
          <>
            <path d="M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4z" fill="var(--status-red)" opacity="0.85" />
            <rect x="3.2" y="5.3" width="5.6" height="1.4" rx="0.5" fill="var(--surface)" />
          </>
        ) : (
          <>
            <path d="M6 1 11.3 10.5H.7z" fill="var(--warn)" opacity="0.85" strokeLinejoin="round" />
            <rect x="5.35" y="4.2" width="1.3" height="3.4" rx="0.5" fill="var(--surface)" />
            <rect x="5.35" y="8.3" width="1.3" height="1.3" rx="0.6" fill="var(--surface)" />
          </>
        )}
      </svg>
      {label}
    </span>
  );
}

export function Chevron({ open, size = 14 }: { open: boolean; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 14 14"
      style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform 0.15s', flex: 'none' }}
    >
      <path
        d="M5 3l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplanPanel({
  open,
  onClose,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projects: Execution['monthProjects'];
}) {
  const dl = useDomainLookup();
  const replan = useAction((id: string) => post(`/projects/${id}/replan`, {}), {
    toast: 'Projet replanifié : la barre revient au centre.',
  });
  return (
    <Panel open={open} onClose={onClose} title="Replanifier" side={false} width={520}>
      <p className="m-0 text-[14px]" style={{ color: 'var(--text-muted)' }}>
        J'accepte le retard : le plan du projet est recalé sur le réel, la barre revient au centre. Les
        rapports passés gardent la trace.
      </p>
      {projects.map((p) => (
        <div key={p.projectId} className="card flex items-center gap-3 p-3">
          <div className="flex-1 min-w-0">
            <DelayBar title={p.title} color={dl.color(p.domainId)} deltaMin={p.deltaMin} showLegend={false} />
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={Math.abs(p.deltaMin) < 15 || replan.isPending}
            onClick={() => replan.mutate(p.projectId)}
          >
            Replanifier
          </button>
        </div>
      ))}
    </Panel>
  );
}

/** iPhone tiles are narrow: "5h30" instead of "5 h 30" (display only). */
const compact = (m: number) => fmtMin(m).replace(/ h ?/, 'h');

function WeekPhone({ ex }: { ex: Execution }) {
  const dl = useDomainLookup();
  const toggle = useToggle();
  const [showBonus, setShowBonus] = useState(false);
  const view = useWeekView();
  const tasks = useSortedTasks(ex, view);
  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div className="flex flex-col gap-1" style={{ padding: '16px 8px 0' }}>
        <div className="eyebrow" style={{ fontSize: 12 }}>
          {eyebrow(ex)}
        </div>
        <h1 className="m-0 font-bold" style={{ fontSize: 28 }}>
          Ma semaine
        </h1>
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', padding: '0 8px' }}
      >
        {[
          ['Fait', compact(ex.doneMin)],
          ['Expé.', `${ex.experiences.done} / ${ex.experiences.target}`],
        ].map(([l, v]) => (
          <div key={l} className="card flex flex-col gap-0.5" style={{ borderRadius: 10, padding: 10 }}>
            <span className="label-caps" style={{ fontSize: 11, letterSpacing: '0.04em' }}>
              {l}
            </span>
            <span className="mono whitespace-nowrap" style={{ fontSize: 16 }}>
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="card overflow-hidden flex flex-col">
        <div
          className="flex flex-col gap-2"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--divider-2)' }}
        >
          <span className="text-[15px] font-semibold">
            À faire · {ex.remaining} tâche{ex.remaining > 1 ? 's' : ''}
          </span>
          <ViewToggles view={view} />
        </div>
        {(!ex.plan || ex.tasks.length === 0) && <Empty>Pas encore de plan pour cette semaine.</Empty>}
        {ex.tasks.length > 0 && tasks.length === 0 && <AllDone ex={ex} />}
        {tasks.map((t) => {
          const color = dl.color(t.domainId);
          return (
            <div
              key={t.taskId}
              className="row-line flex gap-3 items-start"
              style={{
                padding: '12px 16px',
                opacity: t.done ? 0.65 : 1,
              }}
            >
              <TaskCheck
                done={t.done}
                color={color}
                label={t.title}
                onToggle={() => toggle.mutate({ id: t.taskId, done: t.done })}
              />
              <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
                <span
                  className="text-[15px] font-semibold"
                  style={{ textDecoration: t.done ? 'line-through' : 'none' }}
                >
                  {t.title}
                </span>
                {view.showDetail && (
                  <span
                    className="text-[12px] flex flex-wrap gap-1.5 items-center"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {dl.name(t.domainId)} · {t.isExperience ? 'Expérience' : t.why}
                    {t.kind === 'bonus' && <BonusBadge />}
                  </span>
                )}
                {t.done && (
                  <ActualTime taskId={t.taskId} durationMin={t.durationMin} actualMin={t.actualMin} />
                )}
              </div>
              <UrgencyTag t={t} small />
              <Duration min={t.durationMin} small />
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setShowBonus((v) => !v)}
          aria-expanded={showBonus}
          className="flex items-center gap-2 border-0 text-left cursor-pointer"
          style={{
            padding: '14px 16px',
            minHeight: 48,
            background: 'var(--surface-2)',
            fontSize: 14,
            color: 'var(--text-faint)',
          }}
        >
          <Chevron open={showBonus} />
          Bonus · {ex.bonusOpen.length}
        </button>
        {showBonus &&
          ex.bonusOpen.map((b) => (
            <div
              key={b.taskId}
              className="flex gap-3 items-center"
              style={{
                padding: '10px 16px',
                borderTop: '1px solid var(--divider)',
                background: 'var(--surface-2)',
              }}
            >
              <span className="dot" style={{ background: dl.color(b.domainId) }} />
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-[14px]" style={{ color: 'var(--text-2)' }}>
                  {b.title}
                </span>
                {view.showDetail && (
                  <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    {dl.name(b.domainId)} · {fmtMin(b.durationMin)}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => toggle.mutate({ id: b.taskId, done: false })}
              >
                Fait
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
