// Planifier › Trimestre (D-48): choose the objectives of a quarter against the time available.
// Everything is computed by the API (GET /quarter-plans/{quarter}); the page only moves objectives
// between quarters (POST /objectives/{id}/quarter).
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { AiProposeButton } from '../components/ai.tsx';
import { Empty, ErrorBox, InfoTip, Loading, PageHeader, Section } from '../components/ui.tsx';
import { get, post } from '../lib/api.ts';
import { fmtDate, fmtMin, STATUS_LABEL } from '../lib/format.ts';
import { useAction, useDomainLookup, useMe } from '../lib/hooks.ts';
import type { QuarterPlanningPage } from '../lib/types.ts';

type Row = QuarterPlanningPage['chosen'][number];
const label = (q: string) => `T${q.slice(-1)} ${q.slice(0, 4)}`;
const quarterOfDate = (d: string) => `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;

export function QuarterPlanPage({ trimestre, tabs }: { trimestre?: string; tabs: React.ReactNode }) {
  const me = useMe();
  const quarter = trimestre ?? (me.data ? quarterOfDate(me.data.today) : undefined);
  const q = useQuery({
    queryKey: ['quarter-plan', quarter],
    queryFn: () => get<QuarterPlanningPage>(`/quarter-plans/${quarter}`),
    enabled: !!quarter,
  });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  return <QuarterPlan page={q.data} tabs={tabs} />;
}

function QuarterPlan({ page, tabs }: { page: QuarterPlanningPage; tabs: React.ReactNode }) {
  const navigate = useNavigate();
  const move = useAction((v: { id: string; quarter: string }) =>
    post(`/objectives/${v.id}/quarter`, { quarter: v.quarter }),
  );
  const b = page.budget;
  const go = (q: string) => navigate({ to: '/planifier', search: { vue: 'trimestre', trimestre: q } });
  const pct = `${Math.min(100, Math.round((b.neededMin / Math.max(1, b.availableMin)) * 100))}%`;
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
                aria-label="Trimestre précédent"
                onClick={() => go(page.navigation.previous)}
              >
                ‹
              </button>
              {label(page.quarter)} · {fmtDate(page.period.from)} – {fmtDate(page.period.to)}
              <button
                type="button"
                className="btn btn-sm btn-ghost px-1"
                aria-label="Trimestre suivant"
                onClick={() => go(page.navigation.next)}
              >
                ›
              </button>
            </span>
          }
          title="Planifier le trimestre"
          actions={
            <AiProposeButton
              scope="quarter"
              period={page.quarter}
              postponeTo={page.navigation.next}
              disabled={page.isPast}
            />
          }
        />
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0" style={{ flex: '999 1 600px' }}>
          <section className="bin flex flex-col gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="h2-bin">Objectifs du trimestre</h2>
              <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {fmtMin(b.neededMin)} de travail restant
              </span>
            </div>
            <div className="card overflow-hidden">
              {page.chosen.length === 0 && <Empty>Aucun objectif sur ce trimestre.</Empty>}
              {page.chosen.map((o) => (
                <ObjectiveRow
                  key={o.id}
                  o={o}
                  action={
                    page.isPast || !['active', 'paused'].includes(o.status) ? null : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => move.mutate({ id: o.id, quarter: page.navigation.next })}
                        title={`Reporter à ${label(page.navigation.next)}`}
                      >
                        Reporter →
                      </button>
                    )
                  }
                />
              ))}
            </div>
          </section>
          <section className="bin flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <h2 className="h2-bin">Autres objectifs ouverts</h2>
              <InfoTip>
                Objectifs actifs ou en pause d'autres trimestres : ceux d'un trimestre passé (en retard)
                d'abord, puis par deadline. « + Ce trimestre » le déplace ici ; sa deadline est ramenée dans
                le trimestre si besoin.
              </InfoTip>
            </div>
            <div className="card overflow-hidden">
              {page.candidates.length === 0 && <Empty>Aucun autre objectif ouvert.</Empty>}
              {page.candidates.map((o) => (
                <ObjectiveRow
                  key={o.id}
                  o={o}
                  note={o.overdue ? `en retard (${label(o.quarter)})` : label(o.quarter)}
                  action={
                    page.isPast ? null : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ minWidth: 130, fontWeight: 600 }}
                        onClick={() => move.mutate({ id: o.id, quarter: page.quarter })}
                      >
                        + Ce trimestre
                      </button>
                    )
                  }
                />
              ))}
            </div>
          </section>
        </div>
        <aside className="flex flex-col gap-4 min-w-0" style={{ flex: '1 1 340px' }}>
          <Section
            title="Temps du trimestre"
            info="Capacité = budget de chaque semaine du trimestre (ajusté ou par défaut). Charge = reste à faire des projets des chemins de ses objectifs (projets terminés exclus). Les projets sans tâches chiffrées ne comptent pas encore : la charge réelle est plus élevée."
          >
            <div className="mono text-[26px]">
              {fmtMin(b.neededMin)}{' '}
              <span style={{ color: 'var(--text-faint)', fontSize: 15 }}>/ {fmtMin(b.availableMin)}</span>
            </div>
            <div className="track" style={{ height: 10 }}>
              <div
                style={{
                  height: 10,
                  width: pct,
                  background: b.overMin ? 'var(--status-red)' : 'var(--primary)',
                }}
              />
            </div>
            <div
              className="text-[14px] font-medium"
              style={{ color: b.overMin ? 'var(--status-red)' : 'var(--ok)' }}
            >
              {b.overMin ? `${fmtMin(b.overMin)} de trop` : `Reste ${fmtMin(b.availableMin - b.neededMin)}`}
            </div>
            <div className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              <span>Capacité du trimestre : {fmtMin(b.capacityMin)}</span>
              {b.spentMin > 0 && <span>Déjà fait : {fmtMin(b.spentMin)}</span>}
            </div>
          </Section>
          <Section
            title="Méta-objectifs"
            info="Tous tes méta-objectifs actifs, pour information : chacun se coche tout seul dès qu'un objectif du trimestre le sert. Aucune obligation de tous les couvrir."
          >
            {page.metas.length === 0 && (
              <span className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
                Aucun méta-objectif actif.
              </span>
            )}
            {page.metas.map((m) => (
              <div key={m.id} className="flex gap-2.5 items-start text-[14px]">
                <span
                  role="img"
                  aria-label={m.objectives ? 'Couvert' : 'Pas couvert'}
                  className="grid place-items-center rounded-full flex-none text-[11px]"
                  style={{
                    width: 18,
                    height: 18,
                    marginTop: 2,
                    background: m.objectives ? 'var(--status-green)' : 'transparent',
                    border: m.objectives ? 0 : '1.5px solid var(--late-bar)',
                    color: '#fff',
                  }}
                >
                  {m.objectives ? '✓' : ''}
                </span>
                <span className="flex-1">
                  {m.title}
                  <span className="block text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    {m.objectives
                      ? `${m.objectives} objectif${m.objectives > 1 ? 's' : ''} ce trimestre`
                      : 'Aucun objectif ce trimestre'}
                    {m.horizonDate ? ` · horizon ${fmtDate(m.horizonDate)}` : ''}
                  </span>
                </span>
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
    </div>
  );
}

function ObjectiveRow({ o, note, action }: { o: Row; note?: string; action: React.ReactNode }) {
  const dl = useDomainLookup();
  const p = o.projects;
  return (
    <div
      className="row-line flex flex-wrap items-center gap-3"
      style={{
        padding: '12px 16px',
        borderLeft: `4px solid ${dl.color(o.domainId)}`,
      }}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <Link to="/objectifs/$id" params={{ id: o.id }} className="text-[15px] font-semibold">
          {o.title}
        </Link>
        <span className="text-[12px] flex flex-wrap gap-x-2" style={{ color: 'var(--text-faint)' }}>
          {o.metaTitle && <span>{o.metaTitle}</span>}
          <span>· deadline {fmtDate(o.deadline)}</span>
          {o.status !== 'active' && <span>· {STATUS_LABEL[o.status]}</span>}
          {note && (
            <span style={{ color: note.startsWith('en retard') ? 'var(--late-text)' : undefined }}>
              · {note}
            </span>
          )}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {p.total
            ? `${p.done}/${p.total} projets terminés · ${p.active} actif${p.active > 1 ? 's' : ''} · ${p.ready} prêt${p.ready > 1 ? 's' : ''} · ${p.ideas} idée${p.ideas > 1 ? 's' : ''}`
            : 'Aucun projet sur le chemin'}
          {o.unknownSize > 0 && (
            <span style={{ color: 'var(--late-text)' }}>
              {' '}
              · {o.unknownSize} non chiffré{o.unknownSize > 1 ? 's' : ''}
            </span>
          )}
        </span>
      </div>
      <span className="mono text-[13px] flex-none" style={{ color: 'var(--text-muted)' }}>
        {fmtMin(o.remainingMin)} · {o.progressPct} %
      </span>
      {action}
    </div>
  );
}
