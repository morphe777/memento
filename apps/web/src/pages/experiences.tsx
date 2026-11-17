// Expériences (D-54): the goal of living more experiences, made visible. Everything is computed by the API
// (GET /experiences); the page adds ideas to the reserve, records a lived experience (D-153) and opens tasks.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { Markdown } from '../components/markdown.tsx';
import { Breadcrumb } from '../components/shell.tsx';
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
} from '../components/ui.tsx';
import { get, post } from '../lib/api.ts';
import { fmtDate, parisLocal, STATUS_LABEL } from '../lib/format.ts';
import { useAction, useDomainLookup } from '../lib/hooks.ts';
import type { ExperiencesPage as Data, Project, TaskDuration } from '../lib/types.ts';

type Item = Data['lived'][number];

const monthShort = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
const monthLong = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function ExperiencesPage({ tache }: { tache?: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['experiences'], queryFn: () => get<Data>('/experiences') });
  const open = (id: string) => navigate({ to: '/experiences', search: { tache: id } });
  const [living, setLiving] = useState(false);
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const d = q.data;
  const max = Math.max(1, ...d.months.map((m) => m.count));
  const byMonth = new Map<string, Item[]>();
  for (const t of d.lived) {
    const m = t.doneDate?.slice(0, 7) ?? '';
    byMonth.set(m, [...(byMonth.get(m) ?? []), t]);
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Expériences' }]} />
        <PageHeader
          eyebrow="Vivre plus d'expériences · souvenirs et envies"
          title="Expériences"
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setLiving(true)}>
              J'ai vécu une expérience
            </button>
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
            {d.planned.length} prévue{d.planned.length > 1 ? 's' : ''} · {d.reserve.length} en réserve
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
      <div className="flex flex-wrap gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0" style={{ flex: '1 1 420px' }}>
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
            title="Réserve"
            info="Les envies d'expériences, sans date. Le moteur peut en proposer quand la cible n'est pas tenue. Une idée ajoutée ici est une tâche Inbox marquée Expérience."
          >
            <AddIdea />
            {d.reserve.map((t) => (
              <Row key={t.id} t={t} onOpen={open} />
            ))}
          </Section>
        </div>
        <Section
          title="Souvenirs"
          info="Les expériences vécues, de la plus récente à la plus ancienne. La description de la tâche sert de note : ouvre-la pour raconter ce que tu en retiens."
          className="min-w-0"
        >
          {d.lived.length === 0 && <Empty>Pas encore de souvenir : la première est à vivre.</Empty>}
          {[...byMonth].map(([m, items]) => (
            <div key={m} className="flex flex-col gap-2">
              <span className="label-caps" style={{ fontSize: 11 }}>
                {m ? monthLong(m) : ''}
              </span>
              {items.map((t) => (
                <Memory key={t.id} t={t} onOpen={open} />
              ))}
            </div>
          ))}
        </Section>
      </div>
      <TaskDrawer taskId={tache ?? null} onClose={() => navigate({ to: '/experiences', search: {} })} />
      {living && <LivedPanel onClose={() => setLiving(false)} />}
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

function Memory({ t, onOpen }: { t: Item; onOpen: (id: string) => void }) {
  const dl = useDomainLookup();
  return (
    <button
      type="button"
      onClick={() => onOpen(t.id)}
      className="card text-left cursor-pointer flex flex-col gap-1"
      style={{ padding: '12px 14px', borderLeft: '4px solid var(--experience)' }}
    >
      <span className="flex items-center gap-2">
        <span className="text-[15px] font-semibold flex-1 min-w-0">{t.title}</span>
        <span className="mono text-[12px] flex-none" style={{ color: 'var(--text-faint)' }}>
          {t.doneDate ? fmtDate(t.doneDate) : ''}
        </span>
      </span>
      <span className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
        <span className="dot" style={{ background: dl.color(t.domainId), width: 6, height: 6 }} />
        {dl.name(t.domainId)}
        {t.projectTitle ? ` · ${t.projectTitle}` : ''}
      </span>
      {t.description.trim() && (
        <div
          style={{ maxHeight: 72, overflow: 'hidden', maskImage: 'linear-gradient(#000 60%, transparent)' }}
        >
          <Markdown text={t.description} plain />
        </div>
      )}
    </button>
  );
}

function AddIdea() {
  const dl = useDomainLookup();
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState<TaskDuration | null>(120);
  // User request 17/11/2026: Famille by default, like « J'ai vécu une expérience » (D-153).
  const [picked, setDomainId] = useState<string | null>(null);
  const domainId = picked ?? dl.domains.find((d) => d.name === 'Famille')?.id ?? '';
  const add = useAction(
    () => post('/experiences', { title: title.trim(), durationMin: duration, domainId: domainId || null }),
    { onSuccess: () => setTitle(''), toast: 'Ajoutée à la réserve.' },
  );
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) add.mutate(undefined);
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Une envie d'expérience (ex. baptême de plongée)"
        aria-label="Nouvelle idée d'expérience"
        style={{ flex: '1 1 220px' }}
      />
      <select
        value={duration ?? ''}
        onChange={(e) => setDuration(e.target.value ? (Number(e.target.value) as TaskDuration) : null)}
        aria-label="Durée"
        style={{ width: 120 }}
      >
        <option value="">Durée ?</option>
        <DurationOptions />
      </select>
      <select
        value={domainId}
        onChange={(e) => setDomainId(e.target.value)}
        aria-label="Domaine"
        style={{ width: 190 }}
      >
        <option value="">Aucun domaine</option>
        {dl.domains.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button type="submit" className="btn" disabled={!title.trim() || add.isPending}>
        Ajouter
      </button>
    </form>
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
