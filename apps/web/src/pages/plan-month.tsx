// Planifier › Mois (D-43): choose the month projects against the time available. Everything is computed by the
// API (GET /month-plans/{month}); the page only sends the choices back (POST /projects/{id}/month).
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AiProposeButton } from '../components/ai.tsx';
import { Empty, ErrorBox, InfoTip, Loading, PageHeader, Panel, Section } from '../components/ui.tsx';
import { ApiError, get, post } from '../lib/api.ts';
import { fmtDate, fmtMin } from '../lib/format.ts';
import { useAction, useDomainLookup, useIsPhone, useMe } from '../lib/hooks.ts';
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
  const go = (m: string) => navigate({ to: '/planifier', search: { vue: 'mois', mois: m } });
  const [chosenOpen, toggleChosen] = useFold('memento.month.fold.chosen');
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
      <MonthTime page={page} />
      <div className="flex flex-wrap gap-6 items-start">
        <div className="min-w-0" style={{ flex: '3 1 420px' }}>
          <QuarterObjectives page={page} />
        </div>
        <div className="min-w-0" style={{ flex: '2 1 300px' }}>
          <Alerts alerts={page.alerts} />
        </div>
      </div>
      <section className="bin flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <FoldButton open={chosenOpen} onClick={toggleChosen} what="les projets du mois" />
          <h2 className="h2-bin">Projets du mois</h2>
          <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {page.chosen.length} · {fmtMin(page.budget.plannedMin)} de travail restant
          </span>
        </div>
        {chosenOpen && (
          <div className="card overflow-hidden">
            {page.chosen.length === 0 && <Empty>Aucun projet choisi pour ce mois.</Empty>}
            {page.chosen.map((r) => (
              <ProjectRow key={r.id} r={r} chosen disabled={page.isPast} onToggle={toggle} />
            ))}
          </div>
        )}
      </section>
      <Backlog page={page} onToggle={toggle} />
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

/** A box that folds from the chevron of its title, remembered on this device (user request 01/11/2026). */
function useFold(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? '0' : '1');
    } catch {
      // private mode: not remembered
    }
  };
  return [open, toggle];
}

function FoldButton({ open, onClick, what }: { open: boolean; onClick: () => void; what: string }) {
  const label = `${open ? 'Masquer' : 'Afficher'} ${what}`;
  return (
    <button
      type="button"
      className="icon-btn flex-none"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ width: 28, height: 28, minHeight: 28, color: 'var(--text-muted)' }}
    >
      <svg
        aria-hidden="true"
        width={14}
        height={14}
        viewBox="0 0 14 14"
        style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform 0.15s' }}
      >
        <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * Time of the month, at the top (user request 01/11/2026): it moves as projects are added, so it stays in
 * sight while scrolling (PC / iPad); the breakdown is folded behind « Détail ».
 */
function MonthTime({ page }: { page: MonthPlanningPage }) {
  const phone = useIsPhone();
  const [detail, setDetail] = useState(false);
  const b = page.budget;
  const pct = `${Math.min(100, Math.round((b.neededMin / Math.max(1, b.availableMin)) * 100))}%`;
  return (
    <section
      className="card flex flex-col gap-2"
      style={{
        padding: '14px 20px',
        ...(phone ? {} : { position: 'sticky', top: 8, zIndex: 5, boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }),
      }}
    >
      <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap">
        <h2 className="h2 flex items-center gap-2">
          Temps du mois
          <InfoTip>
            <span className="tip-p">
              <b>Capacité</b> = budget de chaque semaine (ajusté dans Planifier › Semaine, sinon le budget par
              défaut), au prorata de ses jours dans le mois.
            </span>
            <span className="tip-p">
              <b>Besoin</b> = travail restant des projets du mois + tâches Inbox à deadline ce mois-ci
              (réservées d'office).
            </span>
          </InfoTip>
        </h2>
        <span className="mono text-[22px]">
          {fmtMin(b.neededMin)}{' '}
          <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>/ {fmtMin(b.availableMin)}</span>
        </span>
        <span
          className="text-[14px] font-medium"
          style={{ color: b.overMin ? 'var(--status-red)' : 'var(--ok)' }}
        >
          {b.overMin
            ? `${fmtMin(b.overMin)} de trop : retire un projet ou étale-le`
            : `Reste ${fmtMin(b.availableMin - b.neededMin)}`}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="border-0 bg-transparent p-0 cursor-pointer underline underline-offset-2 text-[13px]"
          style={{ color: 'var(--text-muted)' }}
          aria-expanded={detail}
          onClick={() => setDetail(!detail)}
        >
          {detail ? 'Masquer le détail' : 'Détail'}
        </button>
      </div>
      <div className="track" style={{ height: 10 }}>
        <div
          style={{ height: 10, width: pct, background: b.overMin ? 'var(--status-red)' : 'var(--primary)' }}
        />
      </div>
      {detail && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <span>Capacité du mois : {fmtMin(b.capacityMin)}</span>
          {b.spentMin > 0 && <span>Déjà fait ce mois-ci : {fmtMin(b.spentMin)}</span>}
          <span>Projets du mois : {fmtMin(b.plannedMin)}</span>
          {b.inboxReserveMin > 0 && <span>Inbox à deadline : {fmtMin(b.inboxReserveMin)}</span>}
          {page.weeks.some((w) => w.reason) && (
            <span>
              Semaines ajustées :{' '}
              {page.weeks
                .filter((w) => w.reason)
                .map((w) => `S${Number(w.isoWeek.slice(-2))} (${w.reason})`)
                .join(', ')}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

type Focus = MonthPlanningPage['objectives'][number]['focus'];
const FOCUS: Record<Focus, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critique', color: '#fff', bg: 'var(--status-red)' },
  finish: { label: 'Presque fini', color: '#fff', bg: 'var(--status-green)' },
  at_risk: { label: 'À risque', color: 'var(--text)', bg: 'var(--status-orange)' },
  on_track: { label: 'En cours', color: 'var(--ok)', bg: 'transparent' },
  can_wait: { label: 'Peut attendre', color: 'var(--text-faint)', bg: 'transparent' },
  no_path: { label: 'Sans chemin', color: 'var(--text-faint)', bg: 'transparent' },
  done: { label: 'Terminé', color: 'var(--ok)', bg: 'transparent' },
};

const OBJECTIVES_HELP = (
  <>
    <span className="tip-p">
      <b>Le pourcentage</b> = part du travail estimé du chemin déjà fait (durées des tâches faites ÷ toutes
      les durées). « 2 / 5 projets » compte les projets terminés du chemin. 0 % : rien de fait encore, ou des
      tâches sans durée.
    </span>
    <span className="tip-p">
      <b>Les objectifs sont triés</b> du plus urgent au moins urgent :
      <span className="tip-li">
        <b>Critique</b> : échéance dépassée, ou criticité 3 / échéance dans moins d'un mois sans projet ce
        mois-ci ;
      </span>
      <span className="tip-li">
        <b>Presque fini</b> : au plus 4 h de travail (8 h si 75 % fait) — un petit effort et il est atteint ;
      </span>
      <span className="tip-li">
        <b>À risque</b> : plus de travail que de temps d'ici l'échéance (même en n'y consacrant que lui) ;
      </span>
      <span className="tip-li">
        <b>En cours</b> : un projet du mois le fait avancer ;
      </span>
      <span className="tip-li">
        <b>Peut attendre</b> : rien ce mois-ci, ni urgent ni critique.
      </span>
    </span>
    <span className="tip-p tip-dim">Si tu ne peux pas tout faire : prends dans l'ordre de la liste.</span>
  </>
);

/** D-108: the quarter objectives sorted by where they stand, to choose what to focus on. */
function QuarterObjectives({ page }: { page: MonthPlanningPage }) {
  const rows = page.objectives;
  const first = rows.filter((o) => o.focus === 'critical' || o.focus === 'finish');
  const wait = rows.filter((o) => o.focus === 'can_wait');
  return (
    <Section title="Objectifs du trimestre" info={OBJECTIVES_HELP}>
      {rows.length === 0 && (
        <span className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
          Aucun objectif sur ce trimestre.
        </span>
      )}
      {(first.length > 0 || wait.length > 0) && (
        <div
          className="text-[13px] flex flex-col gap-0.5"
          style={{
            color: 'var(--text-muted)',
            background: 'var(--surface-2)',
            borderRadius: 10,
            padding: '8px 12px',
          }}
        >
          {first.length > 0 && (
            <span>
              <b style={{ color: 'var(--text)' }}>D'abord :</b> {first.map((o) => o.title).join(', ')}
            </span>
          )}
          {wait.length > 0 && (
            <span>
              <b style={{ color: 'var(--text)' }}>Peut attendre :</b> {wait.map((o) => o.title).join(', ')}
            </span>
          )}
        </div>
      )}
      {rows.map((o) => {
        const f = FOCUS[o.focus];
        return (
          <div key={o.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[11px] font-semibold flex-none"
                style={{
                  color: f.color,
                  background: f.bg,
                  border: f.bg === 'transparent' ? '1px solid var(--btn-border)' : 0,
                  borderRadius: 999,
                  padding: '1px 8px',
                }}
              >
                {f.label}
              </span>
              <Link
                to="/objectifs/$id"
                params={{ id: o.id }}
                className="font-medium text-[14px] flex-1 min-w-0"
              >
                {o.title}
              </Link>
              <span
                className="mono text-[12px] flex-none"
                style={{ color: 'var(--text-faint)' }}
                title={`Criticité ${o.criticality}/3`}
              >
                {'●'.repeat(o.criticality)}
                {'○'.repeat(3 - o.criticality)} · {fmtDate(o.deadline)}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="track flex-1" style={{ height: 6 }}>
                <div
                  style={{
                    height: 6,
                    width: `${o.workPct}%`,
                    background: o.focus === 'finish' ? 'var(--status-green)' : 'var(--primary)',
                  }}
                />
              </div>
              <span className="mono text-[12px] flex-none" style={{ color: 'var(--text-muted)' }}>
                {o.workPct} % · {o.pathDone}/{o.pathTotal} projet{o.pathTotal > 1 ? 's' : ''}
              </span>
            </div>
            <span
              className="text-[12px]"
              style={{
                color:
                  o.focus === 'critical'
                    ? 'var(--status-red)'
                    : o.focus === 'at_risk'
                      ? 'var(--late-text)'
                      : 'var(--text-muted)',
              }}
            >
              {o.reason}
              {o.monthProjects > 0 &&
                ` · ${o.monthProjects} projet${o.monthProjects > 1 ? 's' : ''} ce mois-ci`}
              {!o.covered && o.readyProjects > 0
                ? ` · ${o.readyProjects} prêt${o.readyProjects > 1 ? 's' : ''} à choisir`
                : ''}
              {o.unestimated > 0 && ` · ${o.unestimated} tâche${o.unestimated > 1 ? 's' : ''} sans durée`}
            </span>
          </div>
        );
      })}
    </Section>
  );
}

const LEVEL_COLOR: Record<string, string> = {
  critical: 'var(--status-red)',
  warn: 'var(--status-orange)',
  info: 'var(--text-ghost)',
  ok: 'var(--status-green)',
};

/** D-108: alerts on three levels; those that concern projects open their list. */
function Alerts({ alerts }: { alerts: MonthPlanningPage['alerts'] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section
      title="Alertes"
      info={
        <>
          <span className="tip-li">
            <b style={{ color: '#f08a80' }}>Rouge</b> : à traiter avant de valider le mois ;
          </span>
          <span className="tip-li">
            <b style={{ color: '#f0b45b' }}>Orange</b> : à surveiller ;
          </span>
          <span className="tip-li">
            <b>Gris</b> : pour information.
          </span>
        </>
      }
    >
      <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
        {alerts.map((a) => {
          const key = a.code + a.text;
          const items = a.items ?? [];
          return (
            <li key={key} className="flex gap-2.5 text-[14px]">
              <span className="dot flex-none" style={{ marginTop: 6, background: LEVEL_COLOR[a.level] }} />
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                {items.length ? (
                  <button
                    type="button"
                    className="link-btn"
                    aria-expanded={open === key}
                    onClick={() => setOpen(open === key ? null : key)}
                    style={{ fontWeight: a.level === 'critical' ? 600 : undefined }}
                  >
                    {a.text} <span style={{ color: 'var(--text-faint)' }}>{open === key ? '▴' : '▾'}</span>
                  </button>
                ) : (
                  <span style={{ fontWeight: a.level === 'critical' ? 600 : undefined }}>{a.text}</span>
                )}
                {open === key && (
                  <ul className="m-0 pl-4 flex flex-col gap-0.5 text-[13px]">
                    {items.map((p) => (
                      <li key={p.id}>
                        <Link
                          to={p.type === 'objective' ? '/objectifs/$id' : '/projets/$id'}
                          params={{ id: p.id }}
                        >
                          {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
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
  const folds = {
    quarter: useFold('memento.month.fold.quarter'),
    other: useFold('memento.month.fold.other'),
  };
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
      {boxes.map((b) => {
        const [open, toggle] = folds[b.key as keyof typeof folds];
        return (
          <section key={b.key} className="bin flex flex-col gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <FoldButton open={open} onClick={toggle} what={b.title.toLowerCase()} />
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
            {open && (
              <div className="card overflow-hidden">
                {b.rows.length === 0 && <Empty>{b.empty}</Empty>}
                {b.rows.map((r) => (
                  <ProjectRow key={r.id} r={r} chosen={false} disabled={page.isPast} onToggle={onToggle} />
                ))}
              </div>
            )}
          </section>
        );
      })}
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
