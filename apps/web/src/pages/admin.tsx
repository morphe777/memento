// À revoir (F-25), Configuration (V-14), Connexion.
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Fragment, useEffect, useState } from 'react';
import { Breadcrumb, ThemeSwitch } from '../components/shell.tsx';
import { useSortSensors } from '../components/tasks.tsx';
import {
  ConfirmDialog,
  Empty,
  Field,
  InfoTip,
  Loading,
  PageHeader,
  SearchSelect,
  Section,
  Tabs,
} from '../components/ui.tsx';
import { ApiError, del, get, patch, post, put } from '../lib/api.ts';
import { ACTION_LABEL, ENTITY_LABEL, fmtDateTime } from '../lib/format.ts';
import { toast, useAction, useDomainLookup, useGroups, useMe, useSettings } from '../lib/hooks.ts';
import type { AiCheck, AiStatus, Change, Domain, Settings } from '../lib/types.ts';

// ---------- À revoir ----------

/** French past participle agreement for feminine entities (tâche, ressource). */
const agree = (entity: string, label: string) =>
  ['task', 'resource'].includes(entity) ? label.replace(/é(\b|$)/, 'ée') : label;

export function ReviewPage() {
  const [since, setSince] = useState<'last-visit' | '24h' | '7d' | 'all'>('7d');
  const [actor, setActor] = useState<'all' | 'me' | 'ai'>('ai');
  const [selected, setSelected] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ['changes', since, actor],
    queryFn: () => get<Change[]>(`/changes?since=${since}&actor=${actor}`),
  });
  const mark = useAction((body: { ids?: string[]; all?: boolean }) => post('/changes/mark-reviewed', body), {
    onSuccess: () => setSelected([]),
    toast: 'Marqué comme revu.',
  });
  const link = (c: Change) => {
    if (c.entityType === 'project')
      return (
        <Link to="/projets/$id" params={{ id: c.entityId }}>
          {c.title || 'Projet'}
        </Link>
      );
    if (c.entityType === 'objective')
      return (
        <Link to="/objectifs/$id" params={{ id: c.entityId }}>
          {c.title || 'Objectif'}
        </Link>
      );
    if (c.entityType === 'task')
      return c.projectId ? (
        <Link to="/projets/$id" params={{ id: c.projectId }} search={{ tache: c.entityId }}>
          {c.title || 'Tâche'}
        </Link>
      ) : (
        <Link to="/inbox" search={{ tache: c.entityId }}>
          {c.title || 'Tâche'}
        </Link>
      );
    return <span>{c.title || ENTITY_LABEL[c.entityType] || c.entityType}</span>;
  };
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Journal' }]} />
        <PageHeader
          eyebrow="Journal des créations et modifications · IA ou moi"
          title="Journal"
          actions={
            <>
              <button
                type="button"
                className="btn"
                disabled={!selected.length}
                onClick={() => mark.mutate({ ids: selected })}
              >
                Marquer la sélection comme revue
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!q.data?.length}
                onClick={() => mark.mutate({ ids: q.data!.map((c) => c.id) })}
              >
                Tout marquer comme revu
              </button>
            </>
          }
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Tabs
          value={since}
          onChange={setSince}
          options={[
            { value: 'last-visit', label: 'Depuis ma dernière visite' },
            { value: '24h', label: '24 h' },
            { value: '7d', label: '7 jours' },
            { value: 'all', label: 'Tout' },
          ]}
        />
        <Tabs
          value={actor}
          onChange={setActor}
          options={[
            { value: 'ai', label: 'IA' },
            { value: 'me', label: 'Moi' },
            { value: 'all', label: 'Tous' },
          ]}
        />
      </div>
      <section className="card overflow-hidden">
        {q.isLoading && <Loading />}
        {q.data?.length === 0 && <Empty>Rien à revoir.</Empty>}
        {q.data?.map((c) => (
          <div key={c.id} className="row-line flex items-center gap-3" style={{ padding: '10px 16px' }}>
            <input
              type="checkbox"
              aria-label="Sélectionner"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))
              }
            />
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-[15px] font-medium truncate">{link(c)}</span>
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {ENTITY_LABEL[c.entityType] ?? c.entityType}{' '}
                {agree(c.entityType, ACTION_LABEL[c.action] ?? c.action)} ·{' '}
                {c.actor === 'me' ? 'moi' : c.actor} · {fmtDateTime(c.at)}
              </span>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => mark.mutate({ ids: [c.id] })}>
              Revu
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------- Configuration ----------

const CONFIG_TABS = [
  { value: 'budget', label: 'Général' },
  { value: 'domaines', label: 'Domaines' },
  { value: 'groupes', label: 'Groupes' },
  { value: 'moteur', label: 'Moteur' },
  { value: 'alertes', label: 'Alertes' },
  { value: 'planning', label: 'Planning' },
  { value: 'templates', label: 'Templates' },
  { value: 'ia', label: 'IA' },
  { value: 'acces', label: 'Accès' },
  { value: 'compte', label: 'Compte' },
] as const;
type ConfigTab = (typeof CONFIG_TABS)[number]['value'];

export function ConfigPage({ onglet }: { onglet: string }) {
  const navigate = useNavigate();
  const tab = (CONFIG_TABS.find((t) => t.value === onglet)?.value ?? 'budget') as ConfigTab;
  const settings = useSettings();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Configuration', to: '/configuration/$onglet', params: { onglet: 'budget' } },
            { label: CONFIG_TABS.find((t) => t.value === tab)!.label },
          ]}
        />
        <PageHeader title="Configuration" />
      </div>
      <div className="overflow-x-auto">
        <Tabs
          value={tab}
          onChange={(v) => navigate({ to: '/configuration/$onglet', params: { onglet: v } })}
          options={[...CONFIG_TABS]}
        />
      </div>
      {!settings.data ? (
        <Loading />
      ) : tab === 'domaines' ? (
        <DomainsConfig />
      ) : tab === 'groupes' ? (
        <GroupsConfig />
      ) : tab === 'acces' ? (
        <AccessConfig />
      ) : tab === 'compte' ? (
        <AccountConfig />
      ) : (
        <SettingsForm key={tab} tab={tab} settings={settings.data} />
      )}
    </div>
  );
}

const SECTION_INFO: Partial<Record<ConfigTab, { title: string; info: string }>> = {
  budget: {
    title: 'Général',
    info: "Le budget hebdomadaire est le cœur du système : le plan de la semaine ne le dépasse jamais sans te l'afficher.",
  },
  moteur: {
    title: 'Moteur du lundi',
    info: 'Règle la façon dont le moteur classe les tâches et construit la proposition de semaine. Déterministe : mêmes données, même proposition.',
  },
  alertes: {
    title: 'Alertes et indicateurs',
    info: 'Seuils des alertes de Planifier et des indicateurs des rapports (vert / orange / rouge).',
  },
  planning: {
    title: 'Planning automatique',
    info: 'Quand le worker prépare la semaine et génère les rapports, en heure de Paris.',
  },
  ia: {
    title: 'IA',
    info: "Fournisseur appelé par « Proposer avec l'IA » (Planifier) : URL, clé d'API et modèle. La clé est gardée dans la base, jamais réaffichée ni exportée. Les prompts sont modifiables ; le format de réponse attendu est ajouté automatiquement.",
  },
  templates: {
    title: 'Modèles de description',
    info: 'Texte de départ des descriptions, pour garder la même structure partout.',
  },
};

const WEIGHT_INFO: Record<string, string> = {
  value:
    "V : poids du domaine principal + 50 % des autres domaines, × criticité de l'objectif, × importance du projet (basse 0,5 · normale 1 · haute 1,5). Mesure « est-ce important pour moi ».",
  urgency: 'U : se rapproche de 1 quand la deadline de la tâche (sinon la fin du projet) approche.',
  delay: 'R : retard du projet sur son rythme prévu (projets du mois). Fait remonter ce qui glisse.',
  continuity: "C : 1 si une tâche du projet a été faite ces 2 dernières semaines. Favorise l'élan.",
  age: 'A : nombre de reports de la tâche (plafonné à 3). Évite qu’une tâche traîne indéfiniment.',
};

function SettingsForm({ tab, settings }: { tab: ConfigTab; settings: Settings }) {
  const [s, setS] = useState(settings);
  const save = useAction((patchBody: Partial<Settings>) => patch('/settings', patchBody), {
    toast: 'Réglages enregistrés.',
  });
  const num = (k: keyof Settings) => (
    <input
      type="number"
      value={s[k] as number}
      onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
    />
  );
  const keys: Record<string, (keyof Settings)[]> = {
    budget: [
      'budget.weekly_min',
      'theme',
      'ui.breadcrumb',
      'ui.show_recalculate',
      'inbox.recurring_horizon_days',
      'ui.projects_default_view',
    ],
    moteur: ['engine.weights', 'engine.bonus_count', 'engine.consider_also_count'],
    alertes: [
      'guards.window_weeks',
      'experience.target',
      'experience.window_weeks',
      'experience.badge_color',
      'report.rhythm_low_pct',
      'report.rhythm_high_pct',
      'ideas.purge_after_months',
      'month.max_projects',
      'quarter.max_objectives',
    ],
    planning: ['schedule.week_plan', 'schedule.reports'],
    templates: ['templates.meta_objective', 'templates.objective', 'templates.project', 'templates.task'],
    ia: [
      'ai.provider',
      'ai.model',
      'ai.base_url',
      'ai.instructions',
      'ai.prompt.system',
      'ai.prompt.week',
      'ai.prompt.month',
      'ai.prompt.quarter',
    ],
  };
  // D-66: on the IA tab, a typed key is saved with the rest (its own endpoint, never read back).
  const [aiKey, setAiKey] = useState('');
  const submit = async () => {
    if (tab === 'ia' && aiKey.trim()) {
      try {
        await put('/ai/key', { provider: s['ai.provider'], key: aiKey });
        setAiKey('');
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'Clé non enregistrée', 'error');
        return;
      }
    }
    save.mutate(Object.fromEntries(keys[tab].map((k) => [k, s[k]])) as Partial<Settings>);
  };
  const w = s['engine.weights'];
  return (
    <Section title={SECTION_INFO[tab]?.title} info={SECTION_INFO[tab]?.info}>
      {tab === 'budget' && (
        <>
          <Field
            label="Budget hebdo par défaut (heures)"
            info="Le plafond d'heures que le moteur remplit chaque lundi avec les tâches « Semaine ». Le Bonus n'en fait pas partie. Pour une semaine particulière (vacances, semaine chargée), change le budget dans Planifier sans toucher à cette valeur."
          >
            <input
              type="number"
              step={0.5}
              value={s['budget.weekly_min'] / 60}
              onChange={(e) => setS({ ...s, 'budget.weekly_min': Math.round(Number(e.target.value) * 60) })}
            />
          </Field>
          <Field
            label="Vue par défaut de la page Projets"
            info="La vue qui s'ouvre quand tu cliques sur Projets. Tu peux toujours changer de vue sur la page."
          >
            <select
              value={s['ui.projects_default_view']}
              onChange={(e) =>
                setS({
                  ...s,
                  'ui.projects_default_view': e.target.value as Settings['ui.projects_default_view'],
                })
              }
            >
              <option value="tree">Arborescence</option>
              <option value="list">Liste</option>
              <option value="kanban">Kanban</option>
            </select>
          </Field>
          <Field
            label="Inbox : récurrentes « plus tard » au-delà de (jours)"
            info="Une tâche récurrente dont la deadline est plus loin que ce nombre de jours quitte la liste principale de l'Inbox et va dans l'encadré « Récurrentes plus tard »."
          >
            <input
              type="number"
              min={0}
              max={365}
              value={s['inbox.recurring_horizon_days']}
              onChange={(e) => setS({ ...s, 'inbox.recurring_horizon_days': Number(e.target.value) })}
            />
          </Field>
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={s['ui.show_recalculate']}
              onChange={(e) => setS({ ...s, 'ui.show_recalculate': e.target.checked })}
            />
            Afficher le bouton « Recalculer » dans Planifier
            <InfoTip>
              Refait la proposition du moteur avec les données du moment (tes choix sont gardés). Masqué par
              défaut : la proposition par l'IA le remplacera.
            </InfoTip>
          </label>
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={s['ui.breadcrumb']}
              onChange={(e) => setS({ ...s, 'ui.breadcrumb': e.target.checked })}
            />
            Afficher le fil d'Ariane en haut des pages
            <InfoTip>
              Le chemin « Projets › Maison › Travaux › … » au-dessus du titre. Désactivé par défaut : les
              liens des pages suffisent pour naviguer.
            </InfoTip>
          </label>
          <div className="field">
            <span className="flex items-center gap-1.5">
              Thème
              <InfoTip>
                Auto suit le réglage clair / sombre de l'appareil. Également disponible en bas de la barre
                latérale.
              </InfoTip>
            </span>
            <div style={{ maxWidth: 280 }}>
              <ThemeSwitch />
            </div>
          </div>
        </>
      )}
      {tab === 'moteur' && (
        <>
          <div className="label-caps flex items-center gap-1.5">
            Poids du score (V, U, R, C, A)
            <InfoTip>
              Score d'une tâche = (V×Valeur + U×Urgence + R×Retard + C×Continuité + A×Âge) ÷ Durée. Chaque
              critère vaut entre 0 et 1 ; ces poids règlent leur importance relative. Mettre un poids à 0
              ignore le critère. Le même jeu de données donne toujours la même proposition.
            </InfoTip>
          </div>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
          >
            {(
              [
                ['value', 'Valeur'],
                ['urgency', 'Urgence'],
                ['delay', 'Retard'],
                ['continuity', 'Continuité'],
                ['age', 'Âge (reports)'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l} info={WEIGHT_INFO[k]}>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={w[k]}
                  onChange={(e) => setS({ ...s, 'engine.weights': { ...w, [k]: Number(e.target.value) } })}
                />
              </Field>
            ))}
          </div>
          <Field
            label="Taille de la liste Bonus"
            info="Nombre de tâches que le moteur pré-place en Bonus : les suivantes au score, hors budget. Tu peux les décocher. 0 = pas de suggestion Bonus."
          >
            {num('engine.bonus_count')}
          </Field>
          <Field
            label="Projets dans « À considérer aussi »"
            info="Nombre d'autres projets actifs (hors projets du mois) montrés dans Planifier, les mieux notés d'abord. Les projets Santé / Famille en manque d'heures s'y ajoutent toujours (garde-fous)."
          >
            {num('engine.consider_also_count')}
          </Field>
        </>
      )}
      {tab === 'alertes' && (
        <>
          <Field
            label="Garde-fous Santé / Famille : fenêtre (semaines)"
            info="Si aucune heure n'a été faite en Santé ou en Famille sur ces N dernières semaines, Planifier affiche une alerte et remonte un projet de ce domaine. Les domaines sont reconnus par leur nom."
          >
            {num('guards.window_weeks')}
          </Field>
          <Field
            label="Expériences : cible"
            info="Nombre de tâches « Expérience » (badge doré) à faire sur la fenêtre ci-dessous. En dessous, alerte dans Planifier et indicateur orange ou rouge dans les rapports."
          >
            {num('experience.target')}
          </Field>
          <Field
            label="Expériences : fenêtre (semaines)"
            info="Période glissante sur laquelle la cible est comptée."
          >
            {num('experience.window_weeks')}
          </Field>
          <Field
            label="Couleur du badge Expérience"
            info="Couleur du badge doré qui signale une tâche Expérience."
          >
            <input
              type="color"
              value={s['experience.badge_color']}
              onChange={(e) => setS({ ...s, 'experience.badge_color': e.target.value.toUpperCase() })}
              style={{ width: 80, padding: 2 }}
            />
          </Field>
          <Field
            label="Rythme : sous-productif sous (%)"
            info="Rapports : heures faites ÷ budget de la semaine. Sous ce pourcentage, le rythme est « Sous-productif »."
          >
            {num('report.rhythm_low_pct')}
          </Field>
          <Field
            label="Rythme : surproductif au-delà de (%)"
            info="Au-delà de ce pourcentage, le rythme est « Surproductif » : signal de surcharge plutôt que de réussite."
          >
            {num('report.rhythm_high_pct')}
          </Field>
          <Field
            label="Mois : projets en même temps (au-delà, alerte)"
            info="Planifier › Mois alerte quand plus de projets du mois que ce nombre sont menés de front : au-delà, l'effort se disperse."
          >
            {num('month.max_projects')}
          </Field>
          <Field
            label="Trimestre : objectifs en même temps (au-delà, alerte)"
            info="Planifier › Trimestre alerte quand le trimestre compte plus d'objectifs ouverts que ce nombre."
          >
            {num('quarter.max_objectives')}
          </Field>
          <Field
            label="Idées : proposer à la purge après (mois)"
            info="Âge à partir duquel une idée jamais promue sera proposée à l'abandon lors de la revue trimestrielle (pas encore actif en v0.1)."
          >
            {num('ideas.purge_after_months')}
          </Field>
        </>
      )}
      {tab === 'planning' && (
        <>
          <Field
            label="Plan de la semaine : jour (1 = lundi)"
            hint="Heure de Paris"
            info="Moment où le worker clôture la semaine passée (reports des tâches non faites) et prépare la proposition de la nouvelle."
          >
            <input
              type="number"
              min={1}
              max={7}
              value={s['schedule.week_plan'].day}
              onChange={(e) =>
                setS({
                  ...s,
                  'schedule.week_plan': { ...s['schedule.week_plan'], day: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Plan de la semaine : heure">
            <input
              type="time"
              value={s['schedule.week_plan'].time}
              onChange={(e) =>
                setS({ ...s, 'schedule.week_plan': { ...s['schedule.week_plan'], time: e.target.value } })
              }
            />
          </Field>
          <Field
            label="Rapports : heure (lundi, 1er du mois, 1er jour du trimestre)"
            info="Heure de génération des rapports figés. Si le serveur était arrêté, ils sont rattrapés au redémarrage."
          >
            <input
              type="time"
              value={s['schedule.reports'].time}
              onChange={(e) => setS({ ...s, 'schedule.reports': { time: e.target.value } })}
            />
          </Field>
          <div className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
            Canal de notification : dans l'outil seulement (question ouverte Q-16).
          </div>
        </>
      )}
      {tab === 'templates' && (
        <>
          {(
            [
              ['templates.meta_objective', 'Méta-objectif'],
              ['templates.objective', 'Objectif'],
              ['templates.project', 'Projet'],
              ['templates.task', 'Tâche'],
            ] as const
          ).map(([k, l]) => (
            <Field
              key={k}
              label={l}
              info={`Texte pré-rempli dans la description d'un nouvel élément « ${l} ».`}
            >
              <textarea
                value={s[k]}
                onChange={(e) => setS({ ...s, [k]: e.target.value })}
                style={{ minHeight: 120 }}
              />
            </Field>
          ))}
        </>
      )}
      {tab === 'ia' && <AiConfig s={s} setS={setS} aiKey={aiKey} setAiKey={setAiKey} />}
      <button type="button" className="btn btn-primary self-start" onClick={submit} disabled={save.isPending}>
        Enregistrer
      </button>
      {tab === 'budget' && (
        <div className="flex flex-col gap-2 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="label-caps flex items-center gap-1.5">
            Données
            <InfoTip>
              Télécharge toutes les données (domaines, objectifs, projets, tâches, plans, rapports, réglages,
              journal) dans un fichier JSON : une sauvegarde lisible par d'autres outils. Aucun secret n'y
              figure (ni mot de passe, ni session, ni jeton). « Vider les données » efface les méta-objectifs,
              objectifs, projets et tâches mais garde la configuration (domaines, groupes, réglages, compte,
              jetons).
            </InfoTip>
          </span>
          <div className="flex flex-wrap gap-2">
            <a className="btn hover:no-underline" href="/api/v1/export" download>
              Exporter toutes les données (JSON)
            </a>
            <ImportButton />
            <PurgeButton />
          </div>
        </div>
      )}
    </Section>
  );
}

function SortableDomain({ d, children }: { d: Domain; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: d.id });
  return (
    <div
      ref={setNodeRef}
      className="row-line flex flex-wrap items-center gap-3"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        padding: '10px 12px',
        background: 'var(--surface)',
        position: 'relative',
      }}
    >
      <button
        type="button"
        aria-label="Déplacer"
        className="border-0 bg-transparent cursor-grab"
        style={{ width: 24, minHeight: 32, color: 'var(--text-ghost)', touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      {children}
    </div>
  );
}

/** Domains: order = priority (drag), weight, colours, archive. Weights proposed linearly from rank (D-07). */
function DomainsConfig() {
  const dl = useDomainLookup();
  const sensors = useSortSensors();
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => setOrder(dl.domains.map((d) => d.id)), [dl.domains]);
  const reorder = useAction((ids: string[]) => post('/domains/reorder', { ids }), {
    toast: 'Ordre de priorité enregistré.',
  });
  const update = useAction(({ id, body }: { id: string; body: Partial<Domain> }) =>
    patch(`/domains/${id}`, body),
  );
  // One draft for the whole list, saved by a single « Enregistrer » like the other settings pages.
  const fieldsOf = (d: Domain): DomainFields => ({
    name: d.name,
    weight: d.weight,
    colorLight: d.colorLight,
    colorDark: d.colorDark,
  });
  const [drafts, setDrafts] = useState<Record<string, DomainFields>>({});
  useEffect(() => setDrafts(Object.fromEntries(dl.domains.map((d) => [d.id, fieldsOf(d)]))), [dl.domains]);
  const changed = dl.domains.filter(
    (d) => drafts[d.id] && JSON.stringify(drafts[d.id]) !== JSON.stringify(fieldsOf(d)),
  );
  const save = useAction(() => Promise.all(changed.map((d) => patch(`/domains/${d.id}`, drafts[d.id]))), {
    toast: 'Domaines enregistrés.',
  });
  const create = useAction(
    (body: { name: string; colorLight: string; colorDark: string }) => post('/domains', body),
    { toast: 'Domaine ajouté.' },
  );
  const [name, setName] = useState('');
  const byId = new Map(dl.domains.map((d) => [d.id, d]));
  const proposeWeights = () =>
    setDrafts((ds) =>
      Object.fromEntries(
        Object.entries(ds).map(([id, f]) => [
          id,
          { ...f, weight: Math.round(((order.length - order.indexOf(id)) / order.length) * 1000) / 1000 },
        ]),
      ),
    );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
    setOrder(next);
    reorder.mutate(next);
  };
  return (
    <>
      <Section
        title="Domaines de vie"
        aside="glisser pour changer l'ordre de priorité"
        info="L'ordre = la priorité : il départage les égalités et fixe le domaine principal par défaut d'un projet à plusieurs groupes. La description de chaque domaine se rédige sur sa page (Domaines). Le poids (0 à 1) est la Valeur V du score. Les deux couleurs servent aux thèmes clair et sombre. Archiver masque un domaine sans rien supprimer."
      >
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Le poids (0 à 1) entre dans la valeur du score du moteur. Proposition par défaut : linéaire selon le
          rang (1 pour le n°1, puis −1/8 par rang).
        </p>
        <div className="card overflow-hidden">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {order.map((id, i) => {
                const d = byId.get(id);
                if (!d) return null;
                return (
                  <SortableDomain key={id} d={d}>
                    <span className="mono text-[12px]" style={{ width: 24, color: 'var(--text-faint)' }}>
                      #{i + 1}
                    </span>
                    {drafts[id] && (
                      <DomainEditor
                        d={d}
                        f={drafts[id]}
                        onChange={(f) => setDrafts((ds) => ({ ...ds, [id]: f }))}
                        onArchive={() => update.mutate({ id, body: { archived: !d.archived } })}
                      />
                    )}
                  </SortableDomain>
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => save.mutate(undefined)}
            disabled={!changed.length || save.isPending}
          >
            Enregistrer
          </button>
          <button type="button" className="btn" onClick={proposeWeights}>
            Recalculer les poids depuis l'ordre
          </button>
          <InfoTip>
            Remplace tous les poids par la proposition linéaire : le domaine n°1 reçoit 1, puis chaque rang
            perd 1/8 (n°2 = 0,875 … n°8 = 0,125). Pratique après avoir réordonné les domaines. Tu peux ensuite
            ajuster chaque poids à la main, puis « Enregistrer ».
          </InfoTip>
        </div>
      </Section>
      <Section
        title="Nouveau domaine"
        info="La liste des domaines est volontairement courte et stable : ajoute un domaine seulement après réflexion. Il arrive en dernier ; glisse-le ensuite à son rang."
      >
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim())
              create.mutate(
                { name: name.trim(), colorLight: '#7A7A75', colorDark: '#9A9A94' },
                { onSuccess: () => setName('') },
              );
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du domaine"
            aria-label="Nom du nouveau domaine"
            style={{ flex: '1 1 260px' }}
          />
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Ajouter
          </button>
        </form>
      </Section>
    </>
  );
}

type DomainFields = Pick<Domain, 'name' | 'weight' | 'colorLight' | 'colorDark'>;

function DomainEditor({
  d,
  f,
  onChange: setF,
  onArchive,
}: {
  d: Domain;
  f: DomainFields;
  onChange: (f: DomainFields) => void;
  onArchive: () => void;
}) {
  return (
    <>
      <input
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        aria-label="Nom"
        style={{ flex: '1 1 160px', opacity: d.archived ? 0.5 : 1 }}
      />
      <label className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        poids
        <input
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={f.weight}
          onChange={(e) => setF({ ...f, weight: Number(e.target.value) })}
          style={{ width: 76 }}
        />
      </label>
      <label className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        clair
        <input
          type="color"
          value={f.colorLight}
          onChange={(e) => setF({ ...f, colorLight: e.target.value.toUpperCase() })}
          style={{ width: 44, padding: 2 }}
        />
      </label>
      <label className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        sombre
        <input
          type="color"
          value={f.colorDark}
          onChange={(e) => setF({ ...f, colorDark: e.target.value.toUpperCase() })}
          style={{ width: 44, padding: 2 }}
        />
      </label>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onArchive}>
        {d.archived ? 'Désarchiver' : 'Archiver'}
      </button>
    </>
  );
}

function GroupsConfig() {
  const groups = useGroups();
  const dl = useDomainLookup();
  const [name, setName] = useState('');
  const [domainId, setDomainId] = useState('');
  const create = useAction(() => post('/groups', { name, domainId }), {
    onSuccess: () => setName(''),
    toast: 'Groupe créé.',
  });
  const update = useAction(({ id, body }: { id: string; body: object }) => patch(`/groups/${id}`, body), {
    toast: 'Groupe enregistré.',
  });
  const remove = useAction((id: string) => del(`/groups/${id}`), { toast: 'Groupe supprimé.' });
  const [sortBy, setSortBy] = useState<'domain' | 'alpha'>('domain');
  const rank = (id: string) => dl.get(id)?.priorityRank ?? 99;
  const sorted = [...(groups.data ?? [])].sort(
    (a, b) =>
      (sortBy === 'domain' ? rank(a.domainId) - rank(b.domainId) : 0) || a.name.localeCompare(b.name, 'fr'),
  );
  return (
    <>
      <Section
        title="Groupes"
        aside="rangement libre · un groupe = un domaine"
        info="Les groupes rangent les projets. Chaque groupe appartient à un domaine, et un projet tire ses domaines de ses groupes. Un groupe qui contient encore des projets ne peut pas être supprimé."
      >
        <div className="self-start">
          <Tabs
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'domain', label: 'Par domaine' },
              { value: 'alpha', label: 'Alphabétique' },
            ]}
          />
        </div>
        <div className="card overflow-hidden">
          {sorted.map((g, i) => (
            <Fragment key={g.id}>
              {sortBy === 'domain' && g.domainId !== sorted[i - 1]?.domainId && (
                <div
                  className="flex items-center gap-2 text-[12px] font-semibold uppercase"
                  style={{
                    padding: '8px 12px',
                    letterSpacing: '0.08em',
                    color: 'var(--text-muted)',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--divider)',
                  }}
                >
                  <span className="dot" style={{ background: dl.color(g.domainId) }} />
                  {dl.name(g.domainId)}
                </div>
              )}
              <div className="row-line flex flex-wrap items-center gap-3" style={{ padding: '8px 12px' }}>
                <span className="dot" style={{ background: dl.color(g.domainId) }} />
                <input
                  defaultValue={g.name}
                  aria-label="Nom du groupe"
                  onBlur={(e) =>
                    e.target.value !== g.name && update.mutate({ id: g.id, body: { name: e.target.value } })
                  }
                  style={{ flex: '1 1 180px' }}
                />
                <select
                  value={g.domainId}
                  onChange={(e) => update.mutate({ id: g.id, body: { domainId: e.target.value } })}
                  aria-label="Domaine"
                >
                  {dl.domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <span className="text-[12px]" style={{ color: 'var(--text-faint)', width: 90 }}>
                  {g.projectCount} projet(s)
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={g.projectCount > 0}
                  title={g.projectCount ? 'Contient des projets' : 'Supprimer'}
                  onClick={() => remove.mutate(g.id)}
                >
                  Supprimer
                </button>
              </div>
            </Fragment>
          ))}
        </div>
      </Section>
      <Section
        title="Nouveau groupe"
        info="Choisis le domaine auquel le groupe appartient : ses projets en héritent."
      >
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && domainId) create.mutate(undefined);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du groupe"
            aria-label="Nom du nouveau groupe"
            style={{ flex: '1 1 200px' }}
          />
          <select value={domainId} onChange={(e) => setDomainId(e.target.value)} aria-label="Domaine">
            <option value="">Domaine…</option>
            {dl.domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !domainId}>
            Créer
          </button>
        </form>
      </Section>
    </>
  );
}

interface TokenRow {
  id: string;
  name: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function AccessConfig() {
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => get<TokenRow[]>('/tokens') });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<'read' | 'read_write'>('read_write');
  const [created, setCreated] = useState<string | null>(null);
  const create = useAction(() => post<{ token: string }>('/tokens', { name, scopes }), {
    onSuccess: (t) => {
      setCreated(t.token);
      setName('');
    },
  });
  const revoke = useAction((id: string) => del(`/tokens/${id}`), { toast: 'Jeton révoqué.' });
  return (
    <Section
      title="Jetons API / MCP"
      aside="IA et robots · secret affiché une seule fois, stocké haché"
      info="Un jeton par agent (claude, n8n…) : ses changements apparaissent sous ai:<nom> dans le Journal. Lecture seule = consultation uniquement. Aucun jeton ne peut gérer les jetons, les réglages ni le compte. Révoquer coupe l'accès immédiatement."
    >
      {created && (
        <div className="card p-3 flex flex-col gap-2" style={{ background: 'var(--row-week)' }}>
          <span className="text-[13px] font-semibold">
            Copie ce jeton maintenant : il ne sera plus jamais affiché.
          </span>
          <code className="mono text-[13px] break-all select-all">{created}</code>
          <button
            type="button"
            className="btn btn-sm self-start"
            onClick={() => navigator.clipboard?.writeText(created)}
          >
            Copier
          </button>
        </div>
      )}
      <div className="card overflow-hidden">
        {(tokens.data ?? []).map((t) => (
          <div
            key={t.id}
            className="row-line flex flex-wrap items-center gap-3"
            style={{
              padding: '10px 12px',
              opacity: t.revokedAt ? 0.5 : 1,
            }}
          >
            <span className="mono text-[14px] flex-1">ai:{t.name}</span>
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              {t.scopes === 'read' ? 'lecture' : 'lecture-écriture'} ·{' '}
              {t.lastUsedAt ? `utilisé ${fmtDateTime(t.lastUsedAt)}` : 'jamais utilisé'}
              {t.revokedAt ? ' · révoqué' : ''}
            </span>
            {!t.revokedAt && (
              <button type="button" className="btn btn-sm" onClick={() => revoke.mutate(t.id)}>
                Révoquer
              </button>
            )}
          </div>
        ))}
        {tokens.data?.length === 0 && <Empty>Aucun jeton.</Empty>}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(undefined);
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom (ex. claude, yuki, n8n)"
          style={{ flex: '1 1 200px' }}
        />
        <select
          value={scopes}
          onChange={(e) => setScopes(e.target.value as typeof scopes)}
          aria-label="Portée"
        >
          <option value="read_write">Lecture-écriture</option>
          <option value="read">Lecture seule</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Créer un jeton
        </button>
      </form>
    </Section>
  );
}

const AI_PROVIDER_OPTIONS: [Settings['ai.provider'], string][] = [
  ['none', 'Aucun (bouton désactivé)'],
  ['anthropic', 'Anthropic (Claude)'],
  ['openai', 'OpenAI'],
  ['openrouter', 'OpenRouter'],
  ['google', 'Google (Gemini)'],
  ['ollama', 'Ollama (local)'],
  ['custom', 'Autre, compatible OpenAI'],
];

const AI_PROMPTS = [
  [
    'ai.prompt.system',
    'Prompt système (commun)',
    'Le rôle et les règles générales, envoyés à chaque proposition.',
  ],
  ['ai.prompt.week', 'Prompt Semaine', 'Comment choisir les tâches de la semaine.'],
  ['ai.prompt.month', 'Prompt Mois', 'Comment choisir les projets du mois.'],
  ['ai.prompt.quarter', 'Prompt Trimestre', 'Comment choisir les objectifs du trimestre.'],
] as const;

/** D-58 / D-66: Configuration › IA. Provider, URL, API key and model; the key is written, never read back. */
function AiConfig({
  s,
  setS,
  aiKey,
  setAiKey,
}: {
  s: Settings;
  setS: (s: Settings) => void;
  aiKey: string;
  setAiKey: (k: string) => void;
}) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => get<AiStatus>('/ai/status') });
  const st = status.data;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const provider = s['ai.provider'];
  const savedProvider = st?.provider === provider;
  const [check, setCheck] = useState<AiCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const defaultUrl = provider === 'none' ? '' : (st?.defaultUrls[provider] ?? '');
  // An older configuration may have an empty URL (= the usual one): show it instead of an empty field.
  useEffect(() => {
    if (defaultUrl && !s['ai.base_url']) setS({ ...s, 'ai.base_url': defaultUrl });
  }, [defaultUrl, s, setS]);
  const changeProvider = (p: Settings['ai.provider']) => {
    setCheck(null);
    setAiKey('');
    // The URL is always shown: switching provider fills in its usual address, and the model starts over.
    setS({
      ...s,
      'ai.provider': p,
      'ai.base_url': p === 'none' ? '' : (st?.defaultUrls[p] ?? ''),
      'ai.model': p === st?.provider ? (st?.model ?? '') : '',
    });
  };
  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await post<AiCheck>('/ai/check', { provider, baseUrl: s['ai.base_url'], key: aiKey }));
    } catch (e) {
      setCheck(null);
      toast(e instanceof ApiError ? e.message : 'Test impossible', 'error');
    } finally {
      setChecking(false);
    }
  };
  const clearKey = async () => {
    try {
      await put('/ai/key', { provider, key: '' });
      toast('Clé effacée.');
      await qc.invalidateQueries({ queryKey: ['ai-status'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  const storedKey = savedProvider && st?.keySource === 'saisie';
  const envKey = savedProvider && st?.keySource === 'env';
  const modelOptions = check?.models.map((m) => ({ value: m.id, label: m.label, hint: m.hint })) ?? [];
  return (
    <>
      <Field label="Fournisseur">
        <select value={provider} onChange={(e) => changeProvider(e.target.value as Settings['ai.provider'])}>
          {AI_PROVIDER_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {provider !== 'none' && (
        <>
          <Field
            label="URL de l'API"
            info="Pré-remplie avec l'adresse du fournisseur. À changer pour Ollama en Docker (ex. http://192.168.1.10:11434/v1) ou un autre serveur compatible OpenAI."
          >
            <input
              value={s['ai.base_url']}
              onChange={(e) => set('ai.base_url', e.target.value.trim())}
              placeholder={defaultUrl || 'https://…/v1'}
            />
          </Field>
          <Field
            label="Clé d'API"
            info={
              provider === 'openrouter'
                ? 'Créée sur openrouter.ai › Keys (commence par sk-or-). Gardée dans la base de Mémento, jamais réaffichée ni exportée.'
                : provider === 'ollama'
                  ? 'Inutile pour un Ollama local.'
                  : 'Gardée dans la base de Mémento, jamais réaffichée ni exportée.'
            }
          >
            <div className="flex gap-2 items-center flex-wrap">
              <input
                type="password"
                autoComplete="off"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={
                  storedKey
                    ? `Clé enregistrée (${st?.keyHint}) — en saisir une autre pour la remplacer`
                    : envKey
                      ? `Clé lue dans ${st?.keyEnv} (${st?.keyHint})`
                      : 'Coller la clé ici'
                }
                style={{ flex: '1 1 260px' }}
              />
              {storedKey && !aiKey && (
                <button type="button" className="btn btn-sm" onClick={clearKey}>
                  Effacer la clé
                </button>
              )}
            </div>
          </Field>
          <div className="flex flex-col gap-1">
            <button type="button" className="btn self-start" onClick={runCheck} disabled={checking}>
              {checking ? 'Test en cours…' : 'Tester et charger les modèles'}
            </button>
            {check && (
              <span className="text-[14px]" style={{ color: 'var(--ok, #2E7D4F)' }}>
                ✓ Connexion réussie{check.info ? ` : ${check.info}` : '.'} {check.models.length} modèles
                disponibles.
              </span>
            )}
          </div>
          <Field
            label="Modèle"
            info={
              provider === 'openrouter'
                ? 'Clique « Tester et charger les modèles » pour choisir dans la liste (prix en $ par million de jetons, entrée / sortie). Les modèles capables de rendre un JSON structuré sont en tête. Identifiant au format « fournisseur/modèle ».'
                : "Clique « Tester et charger les modèles » pour choisir dans la liste, ou saisis l'identifiant exact du modèle."
            }
          >
            {modelOptions.length > 0 ? (
              <SearchSelect
                value={s['ai.model']}
                onChange={(v) => set('ai.model', v)}
                options={
                  s['ai.model'] && !modelOptions.some((o) => o.value === s['ai.model'])
                    ? [
                        { value: s['ai.model'], label: s['ai.model'], hint: 'absent de la liste' },
                        ...modelOptions,
                      ]
                    : modelOptions
                }
                placeholder="Rechercher un modèle…"
                ariaLabel="Modèle"
              />
            ) : (
              <input
                value={s['ai.model']}
                onChange={(e) => set('ai.model', e.target.value.trim())}
                placeholder={
                  provider === 'anthropic'
                    ? 'claude-opus-5-5'
                    : provider === 'openrouter'
                      ? 'ex. anthropic/claude-opus-5.5'
                      : 'identifiant du modèle'
                }
              />
            )}
          </Field>
        </>
      )}
      {st && (
        <p
          className="m-0 text-[14px]"
          style={{ color: st.configured ? 'var(--ok, #2E7D4F)' : 'var(--warn, #B7791F)' }}
        >
          {st.configured ? `✓ Prêt : ${st.providerLabel}, modèle ${st.model}.` : `⚠ ${st.reason}`}
          <span style={{ color: 'var(--text-muted)' }}> (état des réglages enregistrés)</span>
        </p>
      )}
      <Field
        label="Tes consignes"
        info="Ce que l'IA doit savoir de toi en plus des données : contraintes, préférences (ex. « le mercredi je suis avec les enfants »)."
      >
        <textarea
          value={s['ai.instructions']}
          onChange={(e) => set('ai.instructions', e.target.value)}
          style={{ minHeight: 80 }}
        />
      </Field>
      {AI_PROMPTS.map(([k, label, info]) => (
        <Field key={k} label={label} info={info}>
          <textarea value={s[k]} onChange={(e) => set(k, e.target.value)} style={{ minHeight: 160 }} />
          {st &&
            s[k] !== st.defaultPrompts[k.slice('ai.prompt.'.length) as keyof typeof st.defaultPrompts] && (
              <button
                type="button"
                className="btn btn-sm self-start mt-1"
                onClick={() =>
                  set(k, st.defaultPrompts[k.slice('ai.prompt.'.length) as keyof typeof st.defaultPrompts])
                }
              >
                Rétablir le texte d'origine
              </button>
            )}
        </Field>
      ))}
    </>
  );
}

/** D-57: wipe meta-objectives, objectives, projects and tasks; the configuration stays. Typed confirmation. */
function PurgeButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    setWord('');
    setHistory(false);
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await post<{ counts: Record<string, number>; backup: string | null }>('/purge', {
        confirm: word,
        history,
      });
      toast(
        `Données vidées : ${r.counts.project ?? 0} projets, ${r.counts.task ?? 0} tâches, ${r.counts.objective ?? 0} objectifs supprimés.${r.backup ? ` Sauvegarde : data/${r.backup}` : ''}`,
      );
      close();
      await qc.invalidateQueries();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Suppression impossible', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Vider les données…
      </button>
      <ConfirmDialog
        open={open}
        title="Vider les données ?"
        confirmLabel="Tout supprimer"
        busy={busy}
        disabled={word !== 'SUPPRIMER'}
        onClose={close}
        onConfirm={run}
      >
        <p className="m-0">
          Tous les <b>méta-objectifs, objectifs, projets et tâches</b> (Inbox et expériences comprises) seront
          supprimés définitivement.
        </p>
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Restent : domaines et leurs descriptions, groupes, réglages, modèles, compte et jetons d'accès. Une
          copie de la base est faite juste avant, dans le dossier data/.
        </p>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
          Effacer aussi l'historique : plans de semaine, rapports et journal
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          Tape SUPPRIMER pour confirmer
          <input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
        </label>
      </ConfirmDialog>
    </>
  );
}

/** D-50: restore an export. Replaces all business data after confirmation; a SQLite backup is taken first. */
function ImportButton() {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await post<{ counts: Record<string, number>; backup: string | null }>('/import', file.data);
      toast(
        `Import terminé : ${r.counts.project ?? 0} projets, ${r.counts.task ?? 0} tâches.${r.backup ? ` Sauvegarde : data/${r.backup}` : ''}`,
      );
      setFile(null);
      await qc.invalidateQueries();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Import impossible', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <label className="btn cursor-pointer">
        Importer une sauvegarde…
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              setFile({ name: f.name, data: JSON.parse(await f.text()) });
            } catch {
              toast('Fichier illisible : un export Mémento (.json) est attendu.', 'error');
            }
          }}
        />
      </label>
      <ConfirmDialog
        open={!!file}
        title="Remplacer toutes les données ?"
        confirmLabel="Importer et remplacer"
        busy={busy}
        onClose={() => setFile(null)}
        onConfirm={run}
      >
        <p className="m-0">
          Toutes les données actuelles (domaines, objectifs, projets, tâches, plans, rapports, réglages,
          journal) seront remplacées par celles de « {file?.name} ».
        </p>
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Une copie de la base actuelle est faite juste avant, dans le dossier data/. Ton compte et tes jetons
          d'accès ne changent pas.
        </p>
      </ConfirmDialog>
    </>
  );
}

/** Own account: rename the login and change the password (web session only, never by API token). */
function AccountConfig() {
  const me = useMe();
  const [login, setLogin] = useState(me.data?.login ?? '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const rename = useAction(() => patch('/auth/account', { login }), { toast: 'Identifiant modifié.' });
  const change = useAction(() => post('/auth/password', { current: pw.current, next: pw.next }), {
    onSuccess: () => setPw({ current: '', next: '', confirm: '' }),
    toast: 'Mot de passe modifié. Les autres sessions ont été déconnectées.',
  });
  const mismatch = pw.confirm.length > 0 && pw.next !== pw.confirm;
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Identifiant"
        info="Le nom utilisé pour te connecter à l'interface web. Il ne change rien aux données ni au journal : tes actions restent signées « moi »."
      >
        <form
          className="flex flex-wrap gap-2 items-end"
          style={{ maxWidth: 560 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (login.trim() && login !== me.data?.login) rename.mutate(undefined);
          }}
        >
          <div style={{ flex: '1 1 240px' }}>
            <Field label="Identifiant" hint="Lettres, chiffres, . - ou _ (2 à 40 caractères)">
              <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} />
            </Field>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!login.trim() || login === me.data?.login || rename.isPending}
            style={{ marginBottom: 22 }}
          >
            Renommer
          </button>
        </form>
      </Section>
      <Section
        title="Mot de passe"
        info="12 caractères minimum ; une phrase de passe est idéale. Le mot de passe actuel est demandé. Après le changement, toutes tes autres sessions (autres navigateurs, iPhone) sont déconnectées ; celle-ci reste ouverte."
      >
        <form
          className="flex flex-col gap-4"
          style={{ maxWidth: 420 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) change.mutate(undefined);
          }}
        >
          <Field label="Mot de passe actuel">
            <input
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
          </Field>
          <Field label="Nouveau mot de passe" hint="12 caractères minimum">
            <input
              type="password"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
          </Field>
          <Field
            label="Confirmer le nouveau mot de passe"
            hint={
              mismatch ? (
                <span style={{ color: 'var(--late-text)' }}>Les deux saisies diffèrent.</span>
              ) : undefined
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            />
          </Field>
          <button
            type="submit"
            className="btn btn-primary self-start"
            disabled={!pw.current || pw.next.length < 12 || pw.next !== pw.confirm || change.isPending}
          >
            Changer le mot de passe
          </button>
        </form>
      </Section>
    </div>
  );
}

// ---------- Login ----------

export function LoginPage() {
  const qc = useQueryClient();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-screen grid place-items-center px-4" style={{ background: 'var(--bg)' }}>
      <form
        className="card flex flex-col gap-4 w-full"
        style={{ maxWidth: 380, padding: 28 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await post('/auth/login', { login, password });
            await qc.invalidateQueries();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Connexion impossible');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <h1 className="m-0 text-[24px] font-bold">Mémento</h1>
        </div>
        <Field label="Identifiant">
          <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
        </Field>
        <Field label="Mot de passe">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <div role="alert" className="text-[14px]" style={{ color: 'var(--late-text)' }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !login || !password}
          style={{ minHeight: 44 }}
        >
          Se connecter
        </button>
      </form>
    </div>
  );
}
