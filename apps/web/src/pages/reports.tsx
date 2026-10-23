// Reports (V-08, WF-08): history and frozen report view — mockup rapport-hebdo.dc.html. The page only reads the payload.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Breadcrumb } from '../components/shell.tsx';
import {
  DelayBar,
  DomainBars,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Section,
  Tabs,
} from '../components/ui.tsx';
import { ApiError, get, post } from '../lib/api.ts';
import { fmtDateTime, fmtMin, shiftIsoWeek, weekNumber } from '../lib/format.ts';
import { toast, useAction, useMe, useResolvedTheme } from '../lib/hooks.ts';
import type { Report, ReportRow, WeekPayload } from '../lib/types.ts';

const KIND_LABEL = { week: 'Hebdo', month: 'Mensuel', quarter: 'Trimestriel' } as const;
type Kind = keyof typeof KIND_LABEL;

const LIGHT = {
  green: 'var(--status-green)',
  orange: 'var(--status-orange)',
  red: 'var(--status-red)',
} as const;

function periodTitle(kind: Kind, key: string) {
  if (kind === 'week') return `Semaine ${weekNumber(key)} · ${key.slice(0, 4)}`;
  if (kind === 'month')
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${key}-15T00:00:00Z`),
    );
  return `${key.slice(5)} ${key.slice(0, 4)}`;
}

export function ReportsPage() {
  const [kind, setKind] = useState<Kind>('week');
  const me = useMe();
  const list = useQuery({
    queryKey: ['reports', kind],
    queryFn: () => get<ReportRow[]>(`/reports?kind=${kind}`),
  });
  const navigate = useNavigate();
  const lastPeriod = () => {
    const today = me.data!.today;
    if (kind === 'week') return shiftIsoWeek(me.data!.currentWeek, -1);
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    if (kind === 'month') return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const q = Math.floor((m - 1) / 3) + 1;
    return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
  };
  const generate = useAction(
    () => post<{ report: Report; created: boolean }>('/reports/generate', { kind, periodKey: lastPeriod() }),
    {
      onSuccess: (r) => navigate({ to: '/rapports/$id', params: { id: r.report.id } }),
    },
  );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Rapports' }]} />
        <PageHeader
          eyebrow="Rapports figés · générés automatiquement"
          title="Rapports"
          actions={
            <button
              type="button"
              className="btn"
              onClick={() => generate.mutate(undefined)}
              disabled={!me.data}
            >
              Générer le dernier {KIND_LABEL[kind].toLowerCase()}
            </button>
          }
        />
      </div>
      <Tabs
        value={kind}
        onChange={setKind}
        options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
      />
      <section className="card overflow-hidden">
        {list.isLoading && <Loading />}
        {list.data?.length === 0 && (
          <Empty>
            Aucun rapport pour l'instant. Ils sont générés le lundi à 07:00, le 1er du mois et le 1er jour du
            trimestre.
          </Empty>
        )}
        {list.data?.map((r) => (
          <Link
            key={r.id}
            to="/rapports/$id"
            params={{ id: r.id }}
            className="flex justify-between items-center gap-3 hover:no-underline"
            style={{ padding: '14px 20px', borderBottom: '1px solid var(--divider)' }}
          >
            <span className="text-[15px] font-semibold">{periodTitle(r.kind, r.periodKey)}</span>
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              figé le {fmtDateTime(r.generatedAt)}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}

export function ReportPage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['report', id], queryFn: () => get<Report>(`/reports/${id}`) });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const r = q.data;
  const crumbs = [
    { label: 'Rapports', to: '/rapports' },
    { label: KIND_LABEL[r.kind], to: '/rapports' },
    { label: r.kind === 'week' ? `S${weekNumber(r.periodKey)}` : r.periodKey },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb items={crumbs} />
      {r.kind === 'week' ? (
        <WeekReport r={r} p={r.payload as WeekPayload} />
      ) : r.kind === 'month' ? (
        <MonthReport r={r} />
      ) : (
        <QuarterReport r={r} />
      )}
    </div>
  );
}

function useGoToPeriod() {
  const navigate = useNavigate();
  return async (kind: Kind, key: string) => {
    try {
      const rep = await get<Report>(`/reports/by-period/${kind}/${key}`);
      navigate({ to: '/rapports/$id', params: { id: rep.id } });
    } catch (e) {
      toast(
        e instanceof ApiError && e.status === 404
          ? `Pas de rapport ${KIND_LABEL[kind].toLowerCase()} pour ${key}.`
          : 'Erreur',
        'error',
      );
    }
  };
}

const generatedLabel = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Paris',
  }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(d);
  return `Rapport figé · ${day}, ${time}`;
};

function Hero({ light, title, sentence }: { light: keyof typeof LIGHT; title: string; sentence: string }) {
  return (
    <section className="card flex flex-wrap items-center gap-5" style={{ padding: 24 }}>
      <div
        className="flex-none grid place-items-center"
        style={{ width: 64, height: 64, borderRadius: 999, background: LIGHT[light] }}
      >
        <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28">
          {light === 'green' && (
            <path
              d="M7 14.5l4.5 4.5L21 9.5"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {light === 'orange' && <path d="M8 14h12" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />}
          {light === 'red' && (
            <path d="M9 9l10 10M19 9L9 19" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
          )}
        </svg>
      </div>
      <div className="min-w-0 flex flex-col gap-1.5" style={{ flex: '1 1 400px' }}>
        <div className="label-caps">Indicateur global</div>
        <div className="font-bold" style={{ fontSize: 26 }}>
          {title}
        </div>
        <div className="text-[15px]" style={{ color: 'var(--text-2)' }}>
          {sentence}
        </div>
      </div>
    </section>
  );
}

function Tile({
  label,
  dot,
  children,
  foot,
  big,
}: {
  label: string;
  dot?: string;
  children: React.ReactNode;
  foot: React.ReactNode;
  big?: boolean;
}) {
  return (
    <div className="card flex flex-col gap-2" style={{ padding: '18px 20px' }}>
      <div className="flex justify-between items-center">
        <span className="label-caps">{label}</span>
        {dot && <span className="dot" style={{ width: 10, height: 10, background: dot }} />}
      </div>
      <div className={big ? 'mono' : 'font-bold'} style={{ fontSize: big ? 30 : 26 }}>
        {children}
      </div>
      <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
        {foot}
      </div>
    </div>
  );
}

const FOCUS_TEXT: Record<string, string> = {
  'Cap tenu': 'la majorité du temps sur les objectifs actifs',
  'Semaine Inbox': 'la majorité du temps sur l’Inbox',
  Dispersé: 'la majorité du temps hors objectif',
  Mixte: 'temps partagé entre objectifs, Inbox et le reste',
  'Rien de fait': 'aucune heure de travail faite',
};

function WeekReport({ r, p }: { r: Report; p: WeekPayload }) {
  const theme = useResolvedTheme();
  const go = useGoToPeriod();
  const color = (x: { colorLight: string; colorDark: string }) =>
    theme === 'dark' ? x.colorDark : x.colorLight;
  const expOk = p.experiences.done >= p.experiences.target;
  return (
    <>
      <PageHeader
        eyebrow={generatedLabel(r.generatedAt)}
        title={p.period.label}
        actions={
          <>
            <button type="button" className="btn" onClick={() => go('week', p.navigation.previous)}>
              ‹ Semaine {weekNumber(p.navigation.previous)}
            </button>
            <button type="button" className="btn" onClick={() => go('week', p.navigation.next)}>
              Semaine {weekNumber(p.navigation.next)} ›
            </button>
            <button type="button" className="btn" onClick={() => go('month', p.navigation.month)}>
              Mois
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                go(
                  'quarter',
                  `${p.period.from.slice(0, 4)}-Q${Math.floor((Number(p.period.from.slice(5, 7)) - 1) / 3) + 1}`,
                )
              }
            >
              Trimestre
            </button>
          </>
        }
      />
      <Hero light={p.global.light} title={p.global.title} sentence={p.global.sentence} />

      <section className="card flex flex-col gap-3" style={{ padding: '20px 24px' }}>
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          <h2 className="h2">Mes réussites</h2>
          <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Projets réussis et objectifs qui ont avancé · {p.tasksDone.count} tâche(s) faite(s)
          </span>
        </div>
        {p.successes.length === 0 && (
          <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
            Pas de projet terminé ni d'objectif qui avance cette semaine.
          </div>
        )}
        <ul className="m-0 p-0 list-none flex flex-col gap-3.5">
          {p.successes.map((s) => (
            <li key={s.sentence} className="flex gap-3 items-baseline">
              <span className="dot" style={{ background: color(s) }} />
              <div className="flex flex-col gap-0.5">
                {s.entity.type === 'project' ? (
                  <Link to="/projets/$id" params={{ id: s.entity.id }} className="text-[16px] font-semibold">
                    {s.sentence}
                  </Link>
                ) : (
                  <Link
                    to="/objectifs/$id"
                    params={{ id: s.entity.id }}
                    className="text-[16px] font-semibold"
                  >
                    {s.sentence}
                  </Link>
                )}
                <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
                  {s.name} · {s.detail}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Tile
          label="Tâches terminées"
          big
          foot={`dont ${p.tasksDone.bonus} bonus · ${p.tasksDone.previousWeek} la semaine d'avant`}
        >
          {p.tasksDone.count}
        </Tile>
        <Tile
          label="Expériences"
          dot={expOk ? LIGHT.green : LIGHT.orange}
          big
          foot={`sur les ${p.experiences.windowWeeks} dernières semaines`}
        >
          {p.experiences.done}{' '}
          <span style={{ fontSize: 18, color: 'var(--text-faint)' }}>/ {p.experiences.target}</span>
        </Tile>
        <Tile
          label="Focus"
          dot={
            p.focus === 'Cap tenu'
              ? LIGHT.green
              : p.focus === 'Semaine Inbox'
                ? 'var(--text-ghost)'
                : LIGHT.orange
          }
          foot={FOCUS_TEXT[p.focus]}
        >
          {p.focus}
        </Tile>
        <Tile
          label="Rythme"
          dot={p.rhythm.tier === 'OK' ? LIGHT.green : LIGHT.orange}
          foot={`${fmtMin(p.rhythm.doneMin)} faites pour un budget de ${fmtMin(p.rhythm.budgetMin)}${p.rhythm.bonus ? ` · ${p.rhythm.bonus} bonus` : ''}`}
        >
          {p.rhythm.tier}
        </Tile>
        <Tile
          label="Évitement"
          dot={p.avoidance.count ? LIGHT.orange : LIGHT.green}
          foot={
            p.avoidance.count
              ? p.avoidance.tasks.map((t) => `« ${t.title} » reportée ${t.postponeCount} fois`).join(' · ')
              : 'aucune tâche reportée 3 fois'
          }
        >
          {p.avoidance.count} tâche{p.avoidance.count > 1 ? 's' : ''}
        </Tile>
      </div>

      <div className="flex flex-wrap gap-6 items-start">
        <section
          className="card flex flex-col gap-[18px] min-w-0"
          style={{ flex: '1 1 520px', padding: '20px 24px' }}
        >
          <div className="flex justify-between items-baseline gap-3">
            <h2 className="h2">Avance / retard · projets du mois</h2>
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              centre = à l'heure
            </span>
          </div>
          {p.delays.length === 0 && (
            <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
              Aucun projet du mois.
            </div>
          )}
          {p.delays.map((d) => (
            <DelayBar
              key={d.projectId}
              title={d.title}
              color={color(d)}
              deltaMin={d.deltaMin}
              to={{ id: d.projectId }}
              showLegend={false}
            />
          ))}
          <div className="flex justify-between text-[11px]" style={{ color: 'var(--text-ghost)' }}>
            <span>← retard</span>
            <span>avance →</span>
          </div>
        </section>
        <section
          className="card flex flex-col gap-3 min-w-0"
          style={{ flex: '1 1 420px', padding: '20px 24px' }}
        >
          <h2 className="h2">Heures par domaine</h2>
          <DomainBars
            rows={p.hoursByDomain.map((h) => ({ name: h.name, color: color(h), minutes: h.minutes }))}
            labelWidth={140}
          />
          <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Par ordre de priorité
          </div>
        </section>
      </div>
    </>
  );
}

type AnyPayload = Record<string, any>;

function MonthReport({ r }: { r: Report }) {
  const p = r.payload as AnyPayload;
  const theme = useResolvedTheme();
  const go = useGoToPeriod();
  const color = (x: { colorLight: string; colorDark: string }) =>
    theme === 'dark' ? x.colorDark : x.colorLight;
  return (
    <>
      <PageHeader
        eyebrow={generatedLabel(r.generatedAt)}
        title={`Mois · ${p.period.label}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => go('month', p.navigation.previous)}>
              ‹ Mois précédent
            </button>
            <button type="button" className="btn" onClick={() => go('month', p.navigation.next)}>
              Mois suivant ›
            </button>
          </>
        }
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Tile label="Tâches terminées" big foot={`${fmtMin(p.totals.doneMin)} de travail`}>
          {p.totals.tasksDone}
        </Tile>
        <Tile label="Expériences" big foot="vécues ce mois-ci">
          {p.totals.experiences}
        </Tile>
        <Tile label="Semaines en dépassement" big foot="au-delà de 110 % du budget">
          {p.weeksOverBudget}
        </Tile>
        <Tile label="Idées" big foot={`${p.ideas.promoted} promue(s) · ${p.ideas.dropped} abandonnée(s)`}>
          {p.ideas.created}
        </Tile>
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <Section title="Semaines" className="min-w-0">
          {p.weeks.length === 0 && (
            <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
              Aucun rapport hebdo ce mois-ci.
            </div>
          )}
          {p.weeks.map((w: AnyPayload) => (
            <div key={w.isoWeek} className="flex items-center gap-3 text-[14px]">
              <span
                className="dot"
                style={{ width: 10, height: 10, background: LIGHT[w.light as keyof typeof LIGHT] }}
              />
              <span className="font-medium">S{weekNumber(w.isoWeek)}</span>
              <span style={{ color: 'var(--text-faint)' }}>
                {w.tasksDone} tâches · {fmtMin(w.doneMin)} · {w.focus} · {w.rhythm}
              </span>
            </div>
          ))}
        </Section>
        <Section title="Projets terminés" className="min-w-0">
          {p.projectsFinished.length === 0 && (
            <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
              Aucun.
            </div>
          )}
          {p.projectsFinished.map((x: AnyPayload) => (
            <div key={x.projectId} className="flex items-center gap-2.5 text-[14px]">
              <span className="dot" style={{ background: color(x as never) }} />
              <Link to="/projets/$id" params={{ id: x.projectId }} className="font-medium">
                {x.title}
              </Link>
              <span style={{ color: x.success ? 'var(--ok)' : 'var(--late-text)' }}>
                {x.success ? 'réussi' : 'échec'}
              </span>
            </div>
          ))}
        </Section>
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <Section title="Journal des expériences" className="min-w-0">
          {p.experiencesJournal.length ? (
            p.experiencesJournal.map((t: string) => (
              <div key={t} className="text-[15px]">
                {t}
              </div>
            ))
          ) : (
            <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
              Aucune expérience ce mois-ci.
            </div>
          )}
        </Section>
        <Section title="3 idées à regarder" aside="domaine prioritaire, puis les plus anciennes">
          {p.ideas.surfaced.map((x: AnyPayload) => (
            <div key={x.projectId} className="flex items-center gap-2.5 text-[14px]">
              <span className="dot" style={{ background: color(x as never) }} />
              <Link to="/projets/$id" params={{ id: x.projectId }}>
                {x.title}
              </Link>
            </div>
          ))}
        </Section>
        <Section title="Heures par domaine">
          <DomainBars
            rows={p.hoursByDomain.map((h: AnyPayload) => ({
              name: h.name,
              color: color(h as never),
              minutes: h.minutes,
            }))}
            labelWidth={140}
          />
        </Section>
      </div>
    </>
  );
}

function QuarterReport({ r }: { r: Report }) {
  const p = r.payload as AnyPayload;
  const theme = useResolvedTheme();
  const go = useGoToPeriod();
  const color = (x: { colorLight: string; colorDark: string }) =>
    theme === 'dark' ? x.colorDark : x.colorLight;
  return (
    <>
      <PageHeader
        eyebrow={generatedLabel(r.generatedAt)}
        title={`Trimestre · ${p.period.label}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => go('quarter', p.navigation.previous)}>
              ‹ Trimestre précédent
            </button>
            <button type="button" className="btn" onClick={() => go('quarter', p.navigation.next)}>
              Trimestre suivant ›
            </button>
          </>
        }
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Tile label="Objectifs atteints" dot={LIGHT.green} big foot="">
          {p.objectives.achieved}
        </Tile>
        <Tile label="Partiels" dot={LIGHT.orange} big foot="">
          {p.objectives.partial}
        </Tile>
        <Tile label="Ratés / abandonnés" dot={LIGHT.red} big foot="">
          {p.objectives.failed}
        </Tile>
        <Tile label="Encore ouverts" big foot="à statuer en revue">
          {p.objectives.open}
        </Tile>
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <Section title="Objectifs du trimestre" className="min-w-0">
          {p.objectives.list.map((o: AnyPayload) => (
            <div key={o.id} className="flex items-center justify-between gap-3 text-[14px]">
              <Link to="/objectifs/$id" params={{ id: o.id }} className="font-medium">
                {o.title}
              </Link>
              <span className="mono" style={{ color: 'var(--text-muted)' }}>
                {o.progressPct} %
              </span>
            </div>
          ))}
        </Section>
        <Section title="Méta-objectifs" className="min-w-0">
          {p.metaObjectives.map((m: AnyPayload) => (
            <div key={m.id} className="flex items-center justify-between gap-3 text-[14px]">
              <span>{m.title}</span>
              <span className="mono" style={{ color: 'var(--text-muted)' }}>
                {m.progressPct} %
              </span>
            </div>
          ))}
        </Section>
      </div>
      <Section title="Écart priorités / réalité" aside="ordre déclaré · heures réelles">
        {p.priorityGap.map((h: AnyPayload) => (
          <div key={h.name} className="flex items-center gap-3 text-[13px]">
            <span className="mono flex-none" style={{ width: 28, color: 'var(--text-faint)' }}>
              #{h.declaredRank}
            </span>
            <span className="dot" style={{ background: color(h as never) }} />
            <span className="flex-none" style={{ width: 150 }}>
              {h.name}
            </span>
            <span className="mono" style={{ color: 'var(--text-muted)' }}>
              {fmtMin(h.minutes)} · {h.sharePct} % · réel #{h.realRank || '—'}
            </span>
          </div>
        ))}
      </Section>
      <Section title="Journal des expériences">
        {p.experiencesJournal.length ? (
          p.experiencesJournal.map((t: string) => <div key={t}>{t}</div>)
        ) : (
          <div style={{ color: 'var(--text-faint)' }}>Aucune.</div>
        )}
      </Section>
    </>
  );
}
