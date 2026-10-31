// Planifier › Mois (D-43): choose the month projects against the time available. Everything is computed by the
// API (GET /month-plans/{month}); the page only sends the choices back (POST /projects/{id}/month).
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AiProposeButton } from '../components/ai.tsx';
import { Empty, ErrorBox, InfoTip, Loading, PageHeader, Panel, Section } from '../components/ui.tsx';
import { ApiError, get, post } from '../lib/api.ts';
import { fmtDate, fmtMin } from '../lib/format.ts';
import { useAction, useDomainLookup, useMe } from '../lib/hooks.ts';
import type { MonthPlanningPage } from '../lib/types.ts';

type Row = MonthPlanningPage['chosen'][number];

const monthLabel = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function MonthPlanPage({ mois, tabs }: { mois?: string; tabs: React.ReactNode }) {
  const me = useMe();
  const month = mois ?? me.data?.today.slice(0, 7);
  const q = useQuery({
    queryKey: ['month-plan', month],
    queryFn: () => get<MonthPlanningPage>(`/month-plans/${month}`),
    enabled: !!month,
  });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  return <MonthPlan page={q.data} tabs={tabs} />;
}

function MonthPlan({ page, tabs }: { page: MonthPlanningPage; tabs: React.ReactNode }) {
  const navigate = useNavigate();
  const [gaps, setGaps] = useState<{ title: string; items: { code: string; label: string }[] } | null>(null);
  const choose = useAction((v: { row: Row; month: string | null }) =>
    post(`/projects/${v.row.id}/month`, { month: v.month }),
  );
  const toggle = (row: Row, on: boolean) =>
    choose.mutate(
      { row, month: on ? page.month : null },
      {
        onError: (e) => {
          if (e instanceof ApiError && Array.isArray(e.details))
            setGaps({ title: row.title, items: e.details as never });
        },
      },
    );
  const b = page.budget;
  const pct = (m: number) => `${Math.min(100, Math.round((m / Math.max(1, b.availableMin)) * 100))}%`;
  const go = (m: string) => navigate({ to: '/planifier', search: { vue: 'mois', mois: m } });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {tabs}
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-sm btn-ghost px-1"
                aria-label="Mois précédent"
                onClick={() => go(page.navigation.previous)}
              >
                ‹
              </button>
              {monthLabel(page.month)} · {page.quarter.replace('-', ' ')}
              <button
                type="button"
                className="btn btn-sm btn-ghost px-1"
                aria-label="Mois suivant"
                onClick={() => go(page.navigation.next)}
              >
                ›
              </button>
            </span>
          }
          title="Planifier le mois"
          actions={<AiProposeButton scope="month" period={page.month} disabled={page.isPast} />}
        />
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0" style={{ flex: '999 1 600px' }}>
          <section className="bin flex flex-col gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="h2-bin">Projets du mois</h2>
              <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {fmtMin(b.plannedMin)} de travail restant
              </span>
            </div>
            <div className="card overflow-hidden">
              {page.chosen.length === 0 && <Empty>Aucun projet choisi pour ce mois.</Empty>}
              {page.chosen.map((r) => (
                <ProjectRow key={r.id} r={r} chosen disabled={page.isPast} onToggle={toggle} />
              ))}
            </div>
          </section>
          <Backlog page={page} onToggle={toggle} />
        </div>
        <aside className="flex flex-col gap-4 min-w-0" style={{ flex: '1 1 340px' }}>
          <Section
            title="Temps du mois"
            info="Capacité = budget de chaque semaine (ajusté dans Planifier › Semaine, sinon le budget par défaut), au prorata des jours de la semaine dans le mois. Les tâches Inbox avec une deadline ce mois-ci sont réservées d'office."
          >
            <div className="mono text-[26px]">
              {fmtMin(b.neededMin)}{' '}
              <span style={{ color: 'var(--text-faint)', fontSize: 15 }}>/ {fmtMin(b.availableMin)}</span>
            </div>
            <div className="track" style={{ height: 10 }}>
              <div
                style={{
                  height: 10,
                  width: pct(b.neededMin),
                  background: b.overMin ? 'var(--status-red)' : 'var(--primary)',
                }}
              />
            </div>
            <div
              className="text-[14px] font-medium"
              style={{ color: b.overMin ? 'var(--status-red)' : 'var(--ok)' }}
            >
              {b.overMin
                ? `${fmtMin(b.overMin)} de trop : retire un projet ou étale-le`
                : `Reste ${fmtMin(b.availableMin - b.neededMin)}`}
            </div>
            <div className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              <span>Capacité du mois : {fmtMin(b.capacityMin)}</span>
              {b.spentMin > 0 && <span>Déjà fait ce mois-ci : {fmtMin(b.spentMin)}</span>}
              <span>Projets du mois : {fmtMin(b.plannedMin)}</span>
              {b.inboxReserveMin > 0 && <span>Inbox à deadline : {fmtMin(b.inboxReserveMin)}</span>}
            </div>
            <div className="flex flex-col pt-2" style={{ borderTop: '1px solid var(--divider)' }}>
              {page.weeks.map((w) => (
                <div key={w.isoWeek} className="flex justify-between text-[13px]" style={{ minHeight: 26 }}>
                  <Link to="/planifier" search={{ semaine: w.isoWeek }} style={{ color: 'var(--text-2)' }}>
                    Semaine {Number(w.isoWeek.slice(-2))}
                    {w.days < 7 ? ` (${w.days} j)` : ''}
                  </Link>
                  <span className="mono" style={{ color: 'var(--text-muted)' }} title={w.reason ?? undefined}>
                    {fmtMin(w.shareMin)}
                    {w.reason ? ' *' : ''}
                  </span>
                </div>
              ))}
            </div>
          </Section>
          <Section
            title="Objectifs du trimestre"
            info="Les objectifs actifs du trimestre. Coché automatiquement dès qu'un projet du mois le fait avancer ; un objectif non coché n'avancera pas ce mois-ci."
          >
            {page.objectives.length === 0 && (
              <span className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
                Aucun objectif sur ce trimestre.
              </span>
            )}
            {page.objectives.map((o) => (
              <div key={o.id} className="flex gap-2.5 items-start">
                <CheckDot ok={o.covered} />
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex justify-between gap-2 text-[14px]">
                    <Link to="/objectifs/$id" params={{ id: o.id }} className="font-medium">
                      {o.title}
                    </Link>
                    <span className="mono text-[12px] flex-none" style={{ color: 'var(--text-faint)' }}>
                      {fmtDate(o.deadline)}
                    </span>
                  </div>
                  <span
                    className="text-[12px]"
                    style={{ color: o.monthProjects ? 'var(--text-muted)' : 'var(--late-text)' }}
                  >
                    {o.monthProjects
                      ? `${o.monthProjects} projet${o.monthProjects > 1 ? 's' : ''} ce mois-ci`
                      : 'Aucun projet ce mois-ci'}
                    {o.readyProjects ? ` · ${o.readyProjects} prêt${o.readyProjects > 1 ? 's' : ''}` : ''} ·{' '}
                    {o.progressPct} %
                  </span>
                </div>
              </div>
            ))}
          </Section>
          <Section title="Alertes">
            <ul className="m-0 p-0 list-none flex flex-col gap-2">
              {page.alerts.map((a) => (
                <li key={a.code + a.text} className="flex gap-2.5 text-[14px]">
                  <span
                    className="dot"
                    style={{
                      marginTop: 6,
                      background: a.level === 'ok' ? 'var(--status-green)' : 'var(--status-orange)',
                    }}
                  />
                  {a.text}
                </li>
              ))}
            </ul>
          </Section>
        </aside>
      </div>
      <Panel
        open={!!gaps}
        onClose={() => setGaps(null)}
        title={`« ${gaps?.title} » n'est pas complet`}
        side={false}
        width={480}
      >
        <p className="m-0 text-[14px]" style={{ color: 'var(--text-muted)' }}>
          Il manque :
        </p>
        <ul className="m-0 pl-5 flex flex-col gap-1 text-[15px]">
          {gaps?.items.map((g) => (
            <li key={g.code}>{g.label}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

type Sort = 'domain' | 'deadline';

/**
 * D-103: the ready projects in two boxes — those of the quarter (in a quarter objective, or due within the
 * quarter) and the others — sorted by domain or by deadline, like Ma semaine.
 */
function Backlog({ page, onToggle }: { page: MonthPlanningPage; onToggle: (r: Row, on: boolean) => void }) {
  const dl = useDomainLookup();
  const [sort, setSort] = useState<Sort>(() => {
    try {
      return localStorage.getItem('memento.month.sort') === 'deadline' ? 'deadline' : 'domain';
    } catch {
      return 'domain';
    }
  });
  const choose = (v: Sort) => {
    setSort(v);
    try {
      localStorage.setItem('memento.month.sort', v);
    } catch {
      // private mode: not remembered
    }
  };
  const rank = new Map(dl.domains.map((d, i) => [d.id, i]));
  const sorted = page.candidates
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      sort === 'domain'
        ? (rank.get(a.r.domainId ?? '') ?? 999) - (rank.get(b.r.domainId ?? '') ?? 999) || a.i - b.i
        : Number(!a.r.deadline) - Number(!b.r.deadline) ||
          (a.r.deadline ?? '').localeCompare(b.r.deadline ?? '') ||
          a.i - b.i,
    )
    .map((x) => x.r);
  const ofQuarter = (r: Row) =>
    r.inQuarterObjective || (!!r.deadline && quarterOfDate(r.deadline) === page.quarter);
  const boxes = [
    {
      key: 'quarter',
      title: 'Projets du trimestre',
      info: `Projets prêts rattachés à un objectif de ${page.quarter.replace('-', ' ')}, ou dont la deadline tombe dans ce trimestre.`,
      rows: sorted.filter(ofQuarter),
      empty: 'Aucun projet prêt pour ce trimestre.',
    },
    {
      key: 'other',
      title: 'Autres projets prêts',
      info: "Le reste du backlog : projets prêts sans objectif du trimestre. Un projet incomplet ne peut pas être choisi : complète-le d'abord.",
      rows: sorted.filter((r) => !ofQuarter(r)),
      empty: 'Aucun autre projet prêt.',
    },
  ];
  return (
    <>
      {boxes.map((b) => (
        <section key={b.key} className="bin flex flex-col gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="h2-bin">{b.title}</h2>
            <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {b.rows.length}
            </span>
            <InfoTip>{b.info}</InfoTip>
            <span className="flex-1" />
            {b.key === 'quarter' && (
              <button
                type="button"
                className="border-0 bg-transparent p-0 cursor-pointer underline underline-offset-2 text-[13px]"
                style={{ color: 'var(--text-muted)' }}
                title="Changer le tri (les deux listes)"
                onClick={() => choose(sort === 'domain' ? 'deadline' : 'domain')}
              >
                {sort === 'domain' ? 'Tri par domaine' : 'Tri par deadline'}
              </button>
            )}
          </div>
          <div className="card overflow-hidden">
            {b.rows.length === 0 && <Empty>{b.empty}</Empty>}
            {b.rows.map((r) => (
              <ProjectRow key={r.id} r={r} chosen={false} disabled={page.isPast} onToggle={onToggle} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const quarterOfDate = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

function ProjectRow({
  r,
  chosen,
  disabled,
  onToggle,
}: {
  r: Row;
  chosen: boolean;
  disabled: boolean;
  onToggle: (r: Row, on: boolean) => void;
}) {
  const dl = useDomainLookup();
  const incomplete = r.gaps.length > 0;
  const done = r.status === 'done';
  return (
    <div
      className="row-line flex flex-wrap items-center gap-3"
      style={{
        padding: '12px 16px',
        background: chosen ? 'var(--row-week)' : 'var(--surface)',
        opacity: done ? 0.6 : 1,
      }}
    >
      <span className="dot" style={{ background: dl.color(r.domainId) }} />
      <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: '1 1 220px' }}>
        <Link to="/projets/$id" params={{ id: r.id }} className="text-[15px] font-semibold">
          {r.title}
        </Link>
        <span className="text-[12px] flex flex-wrap gap-x-2" style={{ color: 'var(--text-faint)' }}>
          <span>{dl.name(r.domainId)}</span>
          {r.objectiveTitle && (
            <span style={{ color: r.inQuarterObjective ? 'var(--text-2)' : undefined }}>
              · Objectif : {r.objectiveTitle}
            </span>
          )}
          {r.deadline && !chosen && <span>· deadline {fmtDate(r.deadline)}</span>}
          {r.carriedOver && <span style={{ color: 'var(--late-text)' }}>· non terminé le mois dernier</span>}
          {incomplete && !chosen && (
            <Link to="/projets/$id" params={{ id: r.id }} style={{ color: 'var(--status-red)' }}>
              · à compléter ({r.gaps.length})
            </Link>
          )}
          {done && <span>· terminé</span>}
        </span>
      </div>
      <span className="mono text-[13px] flex-none" style={{ color: 'var(--text-muted)' }}>
        {fmtMin(r.remainingMin)}
        {r.doneMin > 0 && <span style={{ color: 'var(--text-ghost)' }}> · {fmtMin(r.doneMin)} fait</span>}
      </span>
      {!done && (
        <button
          type="button"
          className={chosen ? 'btn btn-sm' : 'btn btn-sm'}
          disabled={disabled || (!chosen && incomplete)}
          aria-pressed={chosen}
          onClick={() => onToggle(r, !chosen)}
          style={{
            minWidth: 110,
            fontWeight: 600,
            background: chosen ? 'var(--primary)' : undefined,
            color: chosen ? 'var(--primary-text)' : undefined,
            borderColor: chosen ? 'var(--primary)' : undefined,
          }}
          title={!chosen && incomplete ? 'Complète le projet d’abord' : undefined}
        >
          {chosen ? '✓ Ce mois' : '+ Ce mois'}
        </button>
      )}
    </div>
  );
}

function CheckDot({ ok }: { ok: boolean }) {
  return (
    <span
      role="img"
      aria-label={ok ? 'Couvert ce mois-ci' : 'Pas couvert ce mois-ci'}
      className="grid place-items-center rounded-full flex-none text-[11px]"
      style={{
        width: 18,
        height: 18,
        marginTop: 2,
        background: ok ? 'var(--status-green)' : 'transparent',
        border: ok ? 0 : '1.5px solid var(--late-bar)',
        color: '#fff',
      }}
    >
      {ok ? '✓' : ''}
    </span>
  );
}
