// Calendrier (D-113, user request 02/11/2026): every task on a week, month or quarter calendar, filtered by
// domain, kind (project / Inbox / recurring) and status. Everything comes from GET /calendar; a task opens over
// the page (D-108).
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Breadcrumb } from '../components/shell.tsx';
import { openTask } from '../components/tasks.tsx';
import { DomainFilter, ErrorBox, Loading, PageHeader, Panel, Tabs } from '../components/ui.tsx';
import { get } from '../lib/api.ts';
import { fmtMin } from '../lib/format.ts';
import { useDomainLookup, useIsPhone, useMe } from '../lib/hooks.ts';
import type { CalendarPage } from '../lib/types.ts';

export type CalendarView = 'semaine' | 'mois' | 'trimestre';
type Entry = CalendarPage['entries'][number];
type Planned = CalendarPage['planned'][number]['tasks'][number];
type Kind = 'project' | 'inbox' | 'recurring';

// ---------- dates (calendar days, as strings) ----------
const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const isoDay = (d: string) => new Date(ms(d)).getUTCDay() || 7;
const monday = (d: string) => addDays(d, 1 - isoDay(d));
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const shiftMonth = (d: string, n: number) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const dt = new Date(Date.UTC(y, m, 1));
  return dt.toISOString().slice(0, 10);
};
const monthEnd = (d: string) => addDays(shiftMonth(monthStart(d), 1), -1);
const quarterStart = (d: string) =>
  `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
function isoWeekOf(d: string) {
  const thursday = addDays(d, 4 - isoDay(d));
  const year = thursday.slice(0, 4);
  const week = Math.floor((ms(thursday) - ms(`${year}-01-01`)) / DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
const fr = (d: string, o: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', ...o });
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** The days the view shows (`grid`: whole weeks around a month) and the range to fetch. */
function range(view: CalendarView, date: string) {
  if (view === 'semaine') return { from: monday(date), to: addDays(monday(date), 6) };
  if (view === 'mois') {
    const from = monday(monthStart(date));
    return { from, to: addDays(monday(monthEnd(date)), 6) };
  }
  const q = quarterStart(date);
  return { from: q, to: monthEnd(shiftMonth(q, 2)) };
}
const step = (view: CalendarView, date: string, n: number) =>
  view === 'semaine' ? addDays(date, 7 * n) : shiftMonth(monthStart(date), view === 'mois' ? n : 3 * n);

function title(view: CalendarView, date: string) {
  if (view === 'semaine') {
    const m = monday(date);
    return `Semaine ${Number(isoWeekOf(m).slice(6))} · ${fr(m, { day: 'numeric', month: 'short' })} – ${fr(addDays(m, 6), { day: 'numeric', month: 'short' })}`;
  }
  if (view === 'mois') return fr(date, { month: 'long', year: 'numeric' });
  const q = quarterStart(date);
  return `T${Math.floor(Number(q.slice(5, 7)) / 3) + 1} ${q.slice(0, 4)} · ${fr(q, { month: 'long' })} – ${fr(shiftMonth(q, 2), { month: 'long' })}`;
}

// ---------- filters (remembered on this device) ----------
type Filters = { domains: string[]; kinds: Kind[]; done: boolean; planned: boolean };
const FILTER_KEY = 'memento.calendar.filters';
function useFilters(): [Filters, (f: Filters) => void] {
  const [f, setF] = useState<Filters>(() => {
    try {
      return {
        domains: [],
        kinds: [],
        done: true,
        planned: true,
        ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}'),
      };
    } catch {
      return { domains: [], kinds: [], done: true, planned: true };
    }
  });
  const set = (v: Filters) => {
    setF(v);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(v));
    } catch {
      // private mode: not remembered
    }
  };
  return [f, set];
}
const kindOf = (t: Planned | Entry): Kind[] => [
  ...(t.projectId ? (['project'] as const) : (['inbox'] as const)),
  ...(t.recurring ? (['recurring'] as const) : []),
];
const keep = (f: Filters) => (t: Planned | Entry) =>
  (!f.domains.length || (!!t.domainId && f.domains.includes(t.domainId))) &&
  (!f.kinds.length || kindOf(t).some((k) => f.kinds.includes(k))) &&
  (f.done || t.status !== 'done');

const KINDS: { value: Kind; label: string }[] = [
  { value: 'project', label: 'Projets' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'recurring', label: 'Récurrentes' },
];

export function CalendarPageView({ vue, date }: { vue?: CalendarView; date?: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const view: CalendarView = vue ?? 'mois';
  const today = me.data?.today;
  const day = date ?? today;
  const r = day ? range(view, day) : null;
  const q = useQuery({
    queryKey: ['calendar', r?.from, r?.to],
    queryFn: () => get<CalendarPage>(`/calendar?from=${r!.from}&to=${r!.to}`),
    enabled: !!r,
  });
  const [filters, setFilters] = useFilters();
  const [open, setOpen] = useState<{ title: string; entries: Entry[]; planned: Planned[] } | null>(null);
  const go = (v: CalendarView, d: string | undefined) =>
    navigate({
      to: '/calendrier',
      search: { vue: v === 'mois' ? undefined : v, date: d === today ? undefined : d },
    });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!day || !today) return <Loading />;
  const data = q.data;
  const entries = (data?.entries ?? []).filter(keep(filters));
  const planned = (data?.planned ?? []).map((w) => ({
    isoWeek: w.isoWeek,
    tasks: filters.planned ? w.tasks.filter(keep(filters)) : [],
  }));
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const plannedOf = (isoWeek: string) => planned.find((w) => w.isoWeek === isoWeek)?.tasks ?? [];
  const showDay = (d: string) =>
    setOpen({
      title: fr(d, { weekday: 'long', day: 'numeric', month: 'long' }),
      entries: byDay.get(d) ?? [],
      planned: [],
    });
  const showWeek = (isoWeek: string) =>
    setOpen({
      title: `Prévues semaine ${Number(isoWeek.slice(6))}, sans jour`,
      entries: [],
      planned: plannedOf(isoWeek),
    });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Breadcrumb items={[{ label: 'Calendrier' }]} />
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-sm btn-ghost px-1"
                aria-label="Précédent"
                onClick={() => go(view, step(view, day, -1))}
              >
                ‹
              </button>
              <span style={{ textTransform: view === 'semaine' ? undefined : 'capitalize' }}>
                {title(view, day)}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost px-1"
                aria-label="Suivant"
                onClick={() => go(view, step(view, day, 1))}
              >
                ›
              </button>
              {range(view, today).from !== r!.from && (
                <button type="button" className="btn btn-sm" onClick={() => go(view, today)}>
                  Aujourd'hui
                </button>
              )}
            </span>
          }
          title="Calendrier"
          actions={
            <Tabs
              value={view}
              onChange={(v) => go(v, day)}
              options={[
                { value: 'semaine', label: 'Semaine' },
                { value: 'mois', label: 'Mois' },
                { value: 'trimestre', label: 'Trimestre' },
              ]}
            />
          }
        />
      </div>
      <FilterBar f={filters} onChange={setFilters} />
      {!data ? (
        <Loading />
      ) : view === 'trimestre' ? (
        <QuarterGrid from={r!.from} today={today} byDay={byDay} onDay={(d) => go('semaine', d)} />
      ) : phone ? (
        <Agenda
          from={view === 'mois' ? monthStart(day) : r!.from}
          to={view === 'mois' ? monthEnd(day) : r!.to}
          today={today}
          byDay={byDay}
          plannedOf={plannedOf}
        />
      ) : view === 'semaine' ? (
        <WeekGrid from={r!.from} today={today} byDay={byDay} planned={plannedOf(isoWeekOf(r!.from))} />
      ) : (
        <MonthGrid
          from={r!.from}
          to={r!.to}
          month={day.slice(0, 7)}
          today={today}
          byDay={byDay}
          plannedOf={plannedOf}
          onDay={showDay}
          onWeek={showWeek}
        />
      )}
      <Panel open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ''}>
        {open && (
          <div className="card overflow-hidden">
            {open.entries.map((e) => (
              <TaskLine key={e.taskId + e.date + e.kind} t={e} />
            ))}
            {open.planned.map((t) => (
              <TaskLine key={t.taskId} t={t} />
            ))}
            {!open.entries.length && !open.planned.length && (
              <div className="text-[14px]" style={{ padding: 16, color: 'var(--text-faint)' }}>
                Rien ce jour-là.
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function FilterBar({ f, onChange }: { f: Filters; onChange: (f: Filters) => void }) {
  const chip = (on: boolean) => ({
    minHeight: 32,
    padding: '0 12px',
    border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`,
    background: on ? 'var(--bin)' : 'var(--surface)',
    fontWeight: on ? 600 : 400,
  });
  return (
    <div className="flex flex-col gap-2">
      <DomainFilter value={f.domains} onChange={(domains) => onChange({ ...f, domains })} />
      <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <button
          type="button"
          aria-pressed={!f.kinds.length}
          className="rounded-full cursor-pointer"
          style={chip(!f.kinds.length)}
          onClick={() => onChange({ ...f, kinds: [] })}
        >
          Toutes les tâches
        </button>
        {KINDS.map((k) => {
          const on = f.kinds.includes(k.value);
          return (
            <button
              key={k.value}
              type="button"
              aria-pressed={on}
              className="rounded-full cursor-pointer"
              style={chip(on)}
              onClick={() =>
                onChange({ ...f, kinds: on ? f.kinds.filter((x) => x !== k.value) : [...f.kinds, k.value] })
              }
            >
              {k.label}
            </button>
          );
        })}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={f.done}
            onChange={(e) => onChange({ ...f, done: e.target.checked })}
          />
          Faites
        </label>
        <label
          className="flex items-center gap-1.5 cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
          title="Tâches du plan d'une semaine qui n'ont pas de jour dans cette semaine"
        >
          <input
            type="checkbox"
            checked={f.planned}
            onChange={(e) => onChange({ ...f, planned: e.target.checked })}
          />
          Prévues sans jour
        </label>
      </div>
    </div>
  );
}

/** One task: domain dot, title (struck when done, red when late, ↻ when recurring), project, duration. */
function TaskLine({ t, compact = false }: { t: Entry | Planned; compact?: boolean }) {
  const dl = useDomainLookup();
  const e =
    'kind' in t && (t.kind === 'due' || t.kind === 'done' || t.kind === 'occurrence') ? (t as Entry) : null;
  const done = t.status === 'done';
  const late = !!e?.late;
  const ghost = e?.kind === 'occurrence';
  const why = [
    t.projectTitle ?? 'Inbox',
    e?.kind === 'occurrence' ? 'prochaine occurrence' : e?.kind === 'done' ? 'faite' : e ? 'deadline' : null,
    late ? 'en retard' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (compact)
    return (
      <button
        type="button"
        onClick={() => openTask(t.taskId)}
        title={`${t.title} — ${why}`}
        className="flex items-center gap-1.5 w-full min-w-0 border-0 bg-transparent p-0 text-left cursor-pointer text-[12px]"
        style={{
          color: late ? 'var(--status-red)' : done || ghost ? 'var(--text-faint)' : 'var(--text-2)',
          textDecoration: done ? 'line-through' : undefined,
          fontStyle: ghost ? 'italic' : undefined,
        }}
      >
        <span className="dot flex-none" style={{ width: 6, height: 6, background: dl.color(t.domainId) }} />
        <span className="truncate">
          {t.recurring ? '↻ ' : ''}
          {t.title}
        </span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => openTask(t.taskId)}
      className="row-line flex items-center gap-2.5 w-full border-0 text-left cursor-pointer"
      style={{ padding: '8px 14px', background: 'var(--surface)', opacity: done || ghost ? 0.65 : 1 }}
    >
      <span className="dot flex-none" style={{ background: dl.color(t.domainId) }} />
      <span className="flex-1 min-w-0 flex flex-col">
        <span
          className="text-[14px] truncate"
          style={{
            textDecoration: done ? 'line-through' : undefined,
            color: late ? 'var(--status-red)' : 'var(--text)',
            fontStyle: ghost ? 'italic' : undefined,
          }}
        >
          {t.recurring ? '↻ ' : ''}
          {t.title}
        </span>
        <span className="text-[12px] truncate" style={{ color: 'var(--text-faint)' }}>
          {why}
        </span>
      </span>
      {t.durationMin ? (
        <span className="mono text-[12px] flex-none" style={{ color: 'var(--text-muted)' }}>
          {fmtMin(t.durationMin)}
        </span>
      ) : null}
    </button>
  );
}

const DAY_MAX = 4;
const todoMin = (l: Entry[]) => l.reduce((s, e) => s + (e.status === 'todo' ? (e.durationMin ?? 0) : 0), 0);

function MonthGrid({
  from,
  to,
  month,
  today,
  byDay,
  plannedOf,
  onDay,
  onWeek,
}: {
  from: string;
  to: string;
  month: string;
  today: string;
  byDay: Map<string, Entry[]>;
  plannedOf: (isoWeek: string) => Planned[];
  onDay: (d: string) => void;
  onWeek: (isoWeek: string) => void;
}) {
  const weeks: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(d);
  return (
    <div className="card overflow-x-auto">
      <div style={{ minWidth: 720 }}>
        <div
          className="grid text-[12px] label-caps"
          style={{
            gridTemplateColumns: '44px repeat(7, minmax(0, 1fr))',
            borderBottom: '1px solid var(--divider)',
          }}
        >
          <span />
          {WEEKDAYS.map((w) => (
            <span key={w} style={{ padding: '8px 8px' }}>
              {w}
            </span>
          ))}
        </div>
        {weeks.map((mon) => {
          const iso = isoWeekOf(mon);
          const p = plannedOf(iso);
          return (
            <div
              key={mon}
              className="grid"
              style={{
                gridTemplateColumns: '44px repeat(7, minmax(0, 1fr))',
                borderBottom: '1px solid var(--divider)',
              }}
            >
              <button
                type="button"
                onClick={() => onWeek(iso)}
                disabled={!p.length}
                className="flex flex-col items-center gap-1 border-0 bg-transparent cursor-pointer"
                style={{ padding: '8px 0', color: 'var(--text-faint)' }}
                title={p.length ? `${p.length} tâche(s) prévue(s) cette semaine, sans jour` : undefined}
              >
                <span className="mono text-[11px]">S{Number(iso.slice(6))}</span>
                {p.length > 0 && (
                  <span
                    className="mono text-[11px]"
                    style={{ border: '1px dashed var(--btn-border)', borderRadius: 999, padding: '0 6px' }}
                  >
                    {p.length}
                  </span>
                )}
              </button>
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(mon, i);
                const list = byDay.get(d) ?? [];
                const out = d.slice(0, 7) !== month;
                return (
                  <div
                    key={d}
                    className="flex flex-col gap-0.5 min-w-0"
                    style={{
                      minHeight: 104,
                      padding: '6px 8px',
                      borderLeft: '1px solid var(--divider)',
                      background: d === today ? 'var(--row-week)' : out ? 'var(--surface-2)' : undefined,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onDay(d)}
                      className="self-start border-0 bg-transparent p-0 cursor-pointer mono text-[12px]"
                      style={{
                        color:
                          d === today ? 'var(--primary)' : out ? 'var(--text-ghost)' : 'var(--text-muted)',
                        fontWeight: d === today ? 700 : undefined,
                      }}
                    >
                      {Number(d.slice(8))}
                    </button>
                    {list.slice(0, DAY_MAX).map((e) => (
                      <TaskLine key={e.taskId + e.kind} t={e} compact />
                    ))}
                    {list.length > DAY_MAX && (
                      <button
                        type="button"
                        onClick={() => onDay(d)}
                        className="self-start border-0 bg-transparent p-0 cursor-pointer text-[12px] underline"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        + {list.length - DAY_MAX} autre{list.length - DAY_MAX > 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  from,
  today,
  byDay,
  planned,
}: {
  from: string;
  today: string;
  byDay: Map<string, Entry[]>;
  planned: Planned[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {planned.length > 0 && (
        <section className="bin flex flex-col gap-2">
          <h2 className="h2-bin">Prévues cette semaine, sans jour · {planned.length}</h2>
          <div className="card overflow-hidden">
            {planned.map((t) => (
              <TaskLine key={t.taskId} t={t} />
            ))}
          </div>
        </section>
      )}
      <div className="card overflow-x-auto">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(7, minmax(130px, 1fr))', minWidth: 910 }}>
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(from, i);
            const list = byDay.get(d) ?? [];
            return (
              <div
                key={d}
                className="flex flex-col gap-1 min-w-0"
                style={{
                  minHeight: 320,
                  padding: '10px 10px',
                  borderLeft: i ? '1px solid var(--divider)' : undefined,
                  background: d === today ? 'var(--row-week)' : undefined,
                }}
              >
                <span
                  className="text-[13px]"
                  style={{
                    color: d === today ? 'var(--primary)' : 'var(--text-muted)',
                    fontWeight: d === today ? 700 : 500,
                    paddingBottom: 6,
                  }}
                >
                  {WEEKDAYS[i]} {Number(d.slice(8))}
                </span>
                {list.map((e) => (
                  <TaskLine key={e.taskId + e.kind} t={e} compact />
                ))}
                {todoMin(list) > 0 && (
                  <span
                    className="mono text-[11px] pt-1"
                    style={{ color: 'var(--text-ghost)' }}
                    title="À faire ce jour"
                  >
                    {fmtMin(todoMin(list))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** iPhone: the days that have something, one under the other (a grid would not be readable). */
function Agenda({
  from,
  to,
  today,
  byDay,
  plannedOf,
}: {
  from: string;
  to: string;
  today: string;
  byDay: Map<string, Entry[]>;
  plannedOf: (isoWeek: string) => Planned[];
}) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (byDay.get(d)?.length) days.push(d);
  const weeks = [
    ...new Set(
      Array.from({ length: Math.round((ms(to) - ms(from)) / DAY) + 1 }, (_, i) =>
        isoWeekOf(addDays(from, i)),
      ),
    ),
  ];
  const planned = weeks.flatMap((w) => plannedOf(w));
  return (
    <div className="flex flex-col gap-4">
      {planned.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="label-caps">Prévues sans jour · {planned.length}</h2>
          <div className="card overflow-hidden">
            {planned.map((t) => (
              <TaskLine key={t.taskId} t={t} />
            ))}
          </div>
        </section>
      )}
      {days.length === 0 && (
        <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
          Aucune tâche datée sur cette période.
        </div>
      )}
      {days.map((d) => (
        <section key={d} className="flex flex-col gap-1.5">
          <h2
            className="label-caps"
            style={{ color: d === today ? 'var(--primary)' : undefined, textTransform: 'capitalize' }}
          >
            {fr(d, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h2>
          <div className="card overflow-hidden">
            {(byDay.get(d) ?? []).map((e) => (
              <TaskLine key={e.taskId + e.kind} t={e} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Three small months: a dot per task (up to 4, domain colours), a click opens the week. */
function QuarterGrid({
  from,
  today,
  byDay,
  onDay,
}: {
  from: string;
  today: string;
  byDay: Map<string, Entry[]>;
  onDay: (d: string) => void;
}) {
  const dl = useDomainLookup();
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}
    >
      {[0, 1, 2].map((n) => {
        const m = shiftMonth(from, n);
        const start = monday(m);
        const end = addDays(monday(monthEnd(m)), 6);
        const days: string[] = [];
        for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
        const count = days
          .filter((d) => d.slice(0, 7) === m.slice(0, 7))
          .reduce((s, d) => s + (byDay.get(d)?.length ?? 0), 0);
        return (
          <section key={m} className="card flex flex-col gap-2" style={{ padding: '14px 16px' }}>
            <div className="flex items-baseline justify-between">
              <h2 className="h2" style={{ textTransform: 'capitalize' }}>
                {fr(m, { month: 'long' })}
              </h2>
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {count} tâche{count > 1 ? 's' : ''}
              </span>
            </div>
            <div
              className="grid text-center"
              style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}
            >
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>
                  {w[0]}
                </span>
              ))}
              {days.map((d) => {
                const out = d.slice(0, 7) !== m.slice(0, 7);
                const list = out ? [] : (byDay.get(d) ?? []);
                const late = list.some((e) => e.late);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={out}
                    onClick={() => onDay(d)}
                    title={list.length ? list.map((e) => e.title).join('\n') : undefined}
                    className="flex flex-col items-center gap-0.5 border-0 cursor-pointer"
                    style={{
                      minHeight: 40,
                      padding: '4px 0',
                      borderRadius: 8,
                      background:
                        d === today ? 'var(--row-week)' : list.length ? 'var(--surface-2)' : 'transparent',
                      visibility: out ? 'hidden' : undefined,
                    }}
                  >
                    <span
                      className="mono text-[12px]"
                      style={{
                        color: late
                          ? 'var(--status-red)'
                          : d === today
                            ? 'var(--primary)'
                            : 'var(--text-muted)',
                        fontWeight: d === today ? 700 : undefined,
                      }}
                    >
                      {Number(d.slice(8))}
                    </span>
                    <span className="flex gap-0.5">
                      {list.slice(0, 4).map((e) => (
                        <span
                          key={e.taskId + e.kind}
                          className="dot"
                          style={{
                            width: 5,
                            height: 5,
                            background: dl.color(e.domainId),
                            opacity: e.status === 'done' ? 0.4 : 1,
                          }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
