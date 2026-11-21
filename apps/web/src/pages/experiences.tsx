// Expériences (D-54): the goal of living more experiences, made visible. Everything is computed by the API
// (GET /experiences); the page adds ideas to the reserve, records a lived experience (D-153) and opens tasks.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { EnviePanel } from '../components/envie.tsx';
import { LivingView } from '../components/living.tsx';
import { Breadcrumb, usePageFab } from '../components/shell.tsx';
import { DurationOptions, TaskDrawer } from '../components/tasks.tsx';
import {
  Duration,
  Empty,
  ErrorBox,
  Field,
  InfoTip,
  Loading,
  PageHeader,
  Panel,
  PlannedBadge,
  SearchSelect,
  Section,
  Tabs,
} from '../components/ui.tsx';
import { get, post } from '../lib/api.ts';
import { fmtDate, parisLocal, STATUS_LABEL } from '../lib/format.ts';
import { useAction, useDomainLookup } from '../lib/hooks.ts';
import type { Living } from '../lib/souvenirs.ts';
import type { ExperiencesPage as Data, Project, TaskDuration } from '../lib/types.ts';
import { SouvenirsJournal, type SouvenirsView, useCaptureSouvenir } from './souvenirs.tsx';

type Item = Data['lived'][number];

const monthShort = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
const monthLong = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export type ExperiencesTab = 'vecues' | 'a-vivre' | 'bilan';

/**
 * One page for the experiences (user request 17/11/2026, D-170): the counters, then « Vécues » (the souvenirs:
 * journal or map), « À vivre » (planned, then the envies: the reserve, D-171) and « Bilan » (« Vivre » for a year or a quarter).
 */
export function ExperiencesPage({
  tache,
  onglet = 'vecues',
  vue = 'journal',
}: {
  tache?: string;
  onglet?: ExperiencesTab;
  vue?: SouvenirsView;
}) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['experiences'], queryFn: () => get<Data>('/experiences') });
  const go = (search: { onglet?: ExperiencesTab; vue?: SouvenirsView; tache?: string }) =>
    navigate({ to: '/experiences', search: { onglet, ...(onglet === 'vecues' ? { vue } : {}), ...search } });
  const open = (id: string) => go({ tache: id });
  const [living, setLiving] = useState(false);
  // D-174: « + Envie » opens its panel (with a place); the envie field of « À vivre » stays for a quick one.
  const [idea, setIdea] = useState(false);
  const newIdea = () => setIdea(true);
  const capture = useCaptureSouvenir();
  // D-174: on iPhone, the « + » offers the three, whatever the tab.
  usePageFab('Ajouter', [
    { label: '+ Souvenir (photos)', run: capture.pick },
    { label: '+ Envie', run: newIdea },
    { label: 'Vécue sans photo', run: () => setLiving(true) },
  ]);
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const d = q.data;
  const max = Math.max(1, ...d.months.map((m) => m.count));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Expériences' }]} />
        <PageHeader
          eyebrow="Vivre plus d'expériences · souvenirs et envies"
          title="Expériences"
          actions={
            <>
              <button type="button" className="btn" onClick={newIdea}>
                + Envie
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setLiving(true)}
                title="Une expérience vécue, sans photo"
              >
                Vécue sans photo
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={capture.pick}
                disabled={capture.busy}
              >
                {capture.busy ? 'Préparation des photos…' : '+ Souvenir'}
              </button>
            </>
          }
        />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <section className="card flex flex-col gap-1.5" style={{ padding: '18px 20px' }}>
          <span className="label-caps flex items-center gap-1.5">
            Cible du mois
            <InfoTip>
              Expériences vécues en {monthLong(d.month)}, comparées à la cible par mois. Réglable dans
              Configuration › Seuils.
            </InfoTip>
          </span>
          <span className="mono" style={{ fontSize: 34 }}>
            {d.doneThisMonth}
            <span style={{ fontSize: 18, color: 'var(--text-faint)' }}> / {d.target}</span>
          </span>
          <span
            className="text-[13px] font-medium"
            style={{ color: d.onTrack ? 'var(--ok)' : 'var(--late-text)' }}
          >
            {d.onTrack
              ? 'Cible du mois atteinte'
              : `Encore ${d.target - d.doneThisMonth} ce mois-ci pour tenir la cible`}
          </span>
        </section>
        <section className="card flex flex-col gap-1.5" style={{ padding: '18px 20px' }}>
          <span className="label-caps">Cette année</span>
          <span className="mono" style={{ fontSize: 34 }}>
            {d.thisYear}
          </span>
          <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
            {d.daysThisYear} jour{d.daysThisYear > 1 ? 's' : ''} vécu{d.daysThisYear > 1 ? 's' : ''} ·{' '}
            {d.planned.length} prévue
            {d.planned.length > 1 ? 's' : ''} · {d.reserve.length} envie{d.reserve.length > 1 ? 's' : ''}
          </span>
        </section>
        <section className="card flex flex-col gap-2" style={{ padding: '18px 20px' }}>
          <span className="label-caps">12 derniers mois</span>
          <div
            className="flex items-end gap-1.5"
            style={{ height: 70 }}
            role="img"
            aria-label="Expériences par mois"
          >
            {d.months.map((m) => (
              <div
                key={m.month}
                className="flex-1 flex flex-col items-center gap-1"
                title={`${monthLong(m.month)} : ${m.count}`}
              >
                <div
                  style={{
                    width: '100%',
                    height: Math.max(3, (m.count / max) * 52),
                    borderRadius: 4,
                    background: m.count ? 'var(--experience)' : 'var(--track)',
                  }}
                />
                <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>
                  {monthShort(m.month)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <Tabs
        value={onglet}
        options={[
          { value: 'vecues', label: `Vécues · ${d.thisYear} cette année` },
          {
            value: 'a-vivre',
            label: `À vivre · ${d.planned.length + d.reserve.length}`,
          },
          { value: 'bilan', label: 'Bilan' },
        ]}
        onChange={(v) => go({ onglet: v, vue: undefined })}
      />
      {onglet === 'vecues' && <SouvenirsJournal vue={vue} onVue={(v) => go({ vue: v })} />}
      {onglet === 'a-vivre' && (
        <div className="flex flex-col gap-6">
          <Section
            title="Prévues"
            info="Expériences dans le plan de cette semaine ou d'une semaine à venir, ou avec une date. Pour en prévoir une : donne-lui une deadline ou choisis-la dans Planifier."
          >
            {d.planned.length === 0 && <Empty>Rien de prévu pour l'instant.</Empty>}
            {d.planned.map((t) => (
              <Row
                key={t.id}
                t={t}
                onOpen={open}
                badge={<PlannedBadge week={t.plannedWeek} />}
                meta={t.dueDate ? `le ${fmtDate(t.dueDate)}` : ''}
              />
            ))}
          </Section>
          <Section
            title="Envies"
            info="Ta liste d'expériences à vivre un jour, pour t'y référer. Hors Inbox, jamais proposées par le moteur : pour en vivre une cette semaine, coche-la en bas de Planifier › Semaine (hors budget). Un lien partagé depuis l'iPhone arrive ici."
          >
            <button type="button" className="btn self-start" onClick={newIdea}>
              + Envie
            </button>
            {d.reserve.map((t) => (
              <Row key={t.id} t={t} onOpen={open} />
            ))}
          </Section>
        </div>
      )}
      {onglet === 'bilan' && <YearLiving />}
      <TaskDrawer taskId={tache ?? null} onClose={() => go({ tache: undefined })} />
      {living && <LivedPanel onClose={() => setLiving(false)} />}
      {idea && <EnviePanel onClose={() => setIdea(false)} />}
    </div>
  );
}

function Row({
  t,
  onOpen,
  meta,
  badge,
}: {
  t: Item;
  onOpen: (id: string) => void;
  meta?: string;
  badge?: ReactNode;
}) {
  const dl = useDomainLookup();
  return (
    <div className="row-line flex items-center gap-3" style={{ minHeight: 40 }}>
      <span className="dot" style={{ background: dl.color(t.domainId) }} />
      <button
        type="button"
        className="flex-1 min-w-0 text-left border-0 bg-transparent p-0 text-[15px] cursor-pointer hover:underline truncate"
        onClick={() => onOpen(t.id)}
      >
        {t.title}
      </button>
      {t.projectId && (
        <Link
          to="/projets/$id"
          params={{ id: t.projectId }}
          className="text-[12px] truncate"
          style={{ color: 'var(--text-faint)', maxWidth: 160 }}
        >
          {t.projectTitle}
        </Link>
      )}
      {badge}
      {meta && (
        <span className="text-[12px] flex-none" style={{ color: 'var(--text-muted)' }}>
          {meta}
        </span>
      )}
      <Duration min={t.durationMin} small />
    </div>
  );
}

/** EX-60 / D-167: « Vivre » live, for a year or a quarter (the quarter report freezes its own). */
function YearLiving() {
  const now = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const [year, setYear] = useState(Number(now.slice(0, 4)));
  const [quarter, setQuarter] = useState(0);
  const from = quarter ? `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01` : `${year}-01-01`;
  const to = quarter
    ? `${year}-${String(quarter * 3).padStart(2, '0')}-${[31, 30, 30, 31][quarter - 1]}`
    : `${year}-12-31`;
  const q = useQuery({
    queryKey: ['living', from, to],
    queryFn: () => get<Living>(`/living?from=${from}&to=${to}`),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h2 mr-2">Bilan</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setYear(year - 1)}
          aria-label="Année précédente"
        >
          ‹
        </button>
        <span className="mono">{year}</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setYear(year + 1)}
          aria-label="Année suivante"
        >
          ›
        </button>
        <select
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
          aria-label="Période"
          style={{ width: 160 }}
        >
          <option value={0}>Toute l'année</option>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? '1er' : `${n}e`} trimestre
            </option>
          ))}
        </select>
      </div>
      {q.isError && <ErrorBox error={q.error} />}
      {q.data ? (
        <LivingView v={q.data} title={quarter ? `Vivre · T${quarter} ${year}` : `Vivre · ${year}`} />
      ) : (
        <Loading />
      )}
    </div>
  );
}

/**
 * D-153: « J'ai vécu une expérience »: recorded already done, now by default (Paris time). In a project (it then
 * takes the project's domain, and needs a duration like any task of a month project) or in a domain, Famille by
 * default.
 */
function LivedPanel({ onClose }: { onClose: () => void }) {
  const dl = useDomainLookup();
  const family = dl.domains.find((d) => d.name === 'Famille')?.id ?? '';
  const [f, setF] = useState({
    title: '',
    description: '',
    doneAt: parisLocal(),
    domainId: family,
    projectId: '',
    durationMin: null as TaskDuration | null,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const projects = useQuery({
    queryKey: ['projects', 'experience'],
    queryFn: () => get<Project[]>('/projects?status=ready,active,paused,done'),
  });
  const save = useAction(
    () =>
      post('/experiences/lived', {
        title: f.title.trim(),
        description: f.description,
        doneAt: f.doneAt,
        durationMin: f.durationMin,
        ...(f.projectId ? { projectId: f.projectId } : { domainId: f.domainId || null }),
      }),
    { onSuccess: onClose, toast: 'Souvenir ajouté.' },
  );
  return (
    <Panel open onClose={onClose} title="J'ai vécu une expérience">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.title.trim()) save.mutate(undefined);
        }}
      >
        <Field label="Quoi">
          <input
            value={f.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="ex. Pique-nique au bord du lac"
            autoFocus
          />
        </Field>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label="Quand" info="Heure de Paris. Maintenant par défaut ; jamais dans l'avenir.">
            <input
              type="datetime-local"
              value={f.doneAt}
              max={parisLocal()}
              onChange={(e) => set('doneAt', e.target.value)}
            />
          </Field>
          <Field
            label="Durée"
            info="Facultative : une expérience ne compte pas dans le budget. Obligatoire dans un projet du mois, comme toute tâche."
          >
            <select
              value={f.durationMin ?? ''}
              onChange={(e) =>
                set('durationMin', e.target.value ? (Number(e.target.value) as TaskDuration) : null)
              }
            >
              <option value="">Sans durée</option>
              <DurationOptions />
            </select>
          </Field>
        </div>
        <Field
          label="Projet"
          info="Facultatif. L'expérience compte dans les rapports du mois, avec ou sans projet."
        >
          <SearchSelect
            value={f.projectId}
            onChange={(v) => set('projectId', v)}
            ariaLabel="Projet"
            emptyLabel="Aucun projet"
            options={(projects.data ?? []).map((p) => ({
              value: p.id,
              label: p.title,
              hint: STATUS_LABEL[p.status],
            }))}
          />
        </Field>
        {!f.projectId && (
          <Field label="Domaine">
            <select value={f.domainId} onChange={(e) => set('domainId', e.target.value)}>
              <option value="">Aucun</option>
              {dl.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Ce que j'en retiens" info="Facultatif : la note du souvenir (Markdown).">
          <textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={!f.title.trim() || save.isPending}>
            Ajouter aux souvenirs
          </button>
        </div>
      </form>
    </Panel>
  );
}
