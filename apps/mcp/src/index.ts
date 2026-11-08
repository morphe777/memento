// Mémento MCP server (dossier de dev §9, G-07, F-24). Thin layer: every tool = one or two REST API calls.
// Auth: the caller's bearer token (Configuration › Accès) is forwarded to the API, so each agent is journaled
// as ai:<token name> and visible in "À revoir". No business logic and no secret stored here.
import { createServer, type IncomingMessage } from 'node:http';
import * as S from '@memento/domain/schemas';
import { APP_VERSION } from '@memento/domain/version';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const API = process.env.MEMENTO_API_URL ?? 'http://127.0.0.1:4500/api/v1';
const PORT = Number(process.env.MEMENTO_MCP_PORT ?? 4502);
const HOST = process.env.MEMENTO_MCP_HOST ?? '127.0.0.1';

type Call = (method: string, path: string, body?: unknown) => Promise<unknown>;

function apiClient(token: string): Call {
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiFailure(res.status, data);
    return data;
  };
}

class ApiFailure extends Error {
  constructor(
    public status: number,
    public data: { code?: string; message?: string; details?: unknown } | null,
  ) {
    super(data?.message ?? `HTTP ${status}`);
  }
}

/** M-20: one line per tool call (name, result, duration), never the arguments (they hold personal data). */
const logCall = (tool: string, started: number, status: number) =>
  console.log(
    JSON.stringify({
      level: status === 200 ? 30 : 40,
      time: Date.now(),
      msg: 'mcp tool',
      tool,
      status,
      ms: Date.now() - started,
    }),
  );

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  isError: true,
  content: [
    {
      type: 'text' as const,
      text:
        e instanceof ApiFailure
          ? JSON.stringify({ status: e.status, ...e.data }, null, 2)
          : String((e as Error).message ?? e),
    },
  ],
});

const currentWeek = async (call: Call) =>
  ((await call('GET', '/auth/me')) as { currentWeek: string }).currentWeek;
/** A query string, already encoded: `p` leaves it as it is. */
class Query {
  constructor(readonly text: string) {}
}
const qs = (o: Record<string, unknown>) => {
  const q = Object.entries(o).filter(([, v]) => v !== undefined && v !== '');
  return new Query(
    q.length ? `?${q.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '',
  );
};
/**
 * C-03: builds an API path. Every interpolated value is one encoded segment; an empty, `.` or `..` value is
 * refused, so a tool can only reach its own route (the arguments are also checked by the domain schemas).
 */
export function p(parts: TemplateStringsArray, ...values: unknown[]): string {
  return parts.reduce((out, part, i) => {
    if (i === 0) return part;
    const v = values[i - 1];
    if (v instanceof Query) return out + v.text + part;
    const seg = v === undefined || v === null ? '' : String(v);
    if (seg === '' || seg === '.' || seg === '..') throw new Error(`Paramètre invalide : « ${seg} ».`);
    return out + encodeURIComponent(seg) + part;
  }, '');
}

/** H-12: one description per parameter name, used by every tool that has it (unless the tool gives its own). */
const PARAMS: Record<string, string> = {
  actor: "Auteur des changements : « me » (l'utilisateur) ou « ai:<nom du jeton> ».",
  actualMin: "Temps réellement passé, en minutes (1 à 6000), si différent de l'estimation.",
  baseVersion: 'Version du graphe lue avec get_plan_graph : refus si le plan a changé entre-temps.',
  criticality: "Criticité de l'objectif : 1 (faible) à 3 (forte).",
  date: 'Jour AAAA-MM-JJ (heure de Paris).',
  deadline: 'Échéance AAAA-MM-JJ.',
  dependsOn: 'Identifiants (uuid) des projets prérequis.',
  dependsOnId: 'Identifiant (uuid) du projet prérequis.',
  description: "Description en Markdown, rédigée selon le modèle de l'utilisateur (get_templates).",
  domainId: "Identifiant (uuid) d'un domaine (voir get_context).",
  domainIds: 'Domaines à garder (uuid) ; vide ou absent = tous.',
  dueDate: "Date due AAAA-MM-JJ, ou null pour l'effacer.",
  durationMin: 'Durée estimée en minutes : 5, 15, 30, 60 ou 120.',
  from: 'Premier jour (AAAA-MM-JJ) ou première période incluse.',
  groupId: "Identifiant (uuid) d'un groupe.",
  groupIds: 'Groupes du projet (uuid, au moins un) : le domaine en découle.',
  horizonDate: 'Horizon AAAA-MM-JJ du méta-objectif.',
  id: "Identifiant (uuid) de l'élément visé, lu dans une réponse précédente.",
  ids: "Identifiants (uuid) dans l'ordre voulu.",
  ignore: 'Éléments reconnus à ne pas appliquer (rendus au titre).',
  importance: 'Importance : low, normal ou high.',
  inbox: "true pour une tâche de l'Inbox (récurrence, #domaine et « cette semaine » sont lus).",
  includeReserve: 'Inclure les projets de la réserve (sans objectif).',
  includeReviewed: 'true pour inclure les changements déjà revus.',
  isExperience: 'true pour une expérience (R-02), hors budget de travail.',
  isFree: "true pour un élément libre : il n'attend pas le précédent.",
  isoWeek: 'Semaine ISO AAAA-Wss (ex. 2026-W45).',
  items: 'Sélection complète de la semaine : [{ taskId, kind: week | bonus }].',
  kind: 'Sorte de rapport : week, month ou quarter.',
  label: 'Libellé du lien.',
  limit: 'Nombre maximal de lignes (1 à 500).',
  metaObjectiveId: 'Identifiant (uuid) du méta-objectif, ou null.',
  month: 'Mois AAAA-MM.',
  motive: "Pourquoi l'utilisateur le veut (ses mots).",
  objectiveId: "Identifiant (uuid) de l'objectif, ou null pour la réserve.",
  offset: 'Lignes à sauter (pages, avec limit).',
  ops: "Opérations à appliquer, dans l'ordre (voir le guide).",
  outcomeTitle: 'Résultat visé, formulé comme un état atteint.',
  ownerId: "Identifiant (uuid) de l'élément qui porte le lien.",
  ownerType: "Sorte d'élément : objective, project, task ou group.",
  periodKey: 'Période : AAAA-Wss (semaine), AAAA-MM (mois) ou AAAA-Qn (trimestre).',
  position: 'Position dans la liste (0 = en tête).',
  primaryDomainId: 'Domaine principal (uuid) parmi ceux des groupes.',
  projectId: 'Identifiant (uuid) du projet ; null ou absent = Inbox.',
  q: 'Mots cherchés.',
  quarter: 'Trimestre AAAA-Qn (ex. 2026-Q4).',
  recurrence: 'Récurrence : monthly, quarterly ou yearly ; null = aucune.',
  recurrenceRule: "Règle de récurrence RRULE d'une tâche de l'Inbox (ex. FREQ=WEEKLY;BYDAY=MO), ou null.",
  sequenceMode: "sequential (une tâche après l'autre) ou parallel.",
  since: 'Depuis : une date ISO, « 24h », « 7d », « last-visit » (dernière visite) ou « all ».',
  smartCurrent: "Valeur actuelle de l'indicateur.",
  smartIndicator: "Indicateur mesurable de l'objectif.",
  smartTarget: "Valeur cible de l'indicateur.",
  startDate: 'Date de début AAAA-MM-JJ, ou null.',
  status: 'Statut (valeurs listées dans le guide, section Le modèle).',
  successCriterion: "Critère de succès : comment savoir que c'est fini.",
  tasks: "Tâches dans l'ordre d'exécution : [{ title, durationMin }].",
  text: 'Texte en français à lire (ex. « appeler le garage demain 15 min »).',
  title: 'Titre court.',
  to: 'Dernier jour (AAAA-MM-JJ) ou dernière période incluse.',
  url: 'Adresse du lien (https://…).',
  withProjects: "false pour dupliquer l'objectif sans ses projets.",
};
const described = <T extends z.ZodRawShape>(shape: T): T =>
  Object.fromEntries(
    Object.entries(shape).map(([k, v]) => {
      const t = v as z.ZodType;
      return [k, t.description || !PARAMS[k] ? t : t.describe(PARAMS[k])];
    }),
  ) as unknown as T;

/** H-12: tools that only read (readOnlyHint, the only ones a read token sees). */
export const isReadTool = (name: string) =>
  /^(get|list)_/.test(name) || ['search', 'preview_plan_changes', 'parse_task'].includes(name);
/** H-12: tools that delete or replace what exists (destructiveHint: ask the user first). */
export const isDestructiveTool = (name: string) =>
  /^(delete|remove)_/.test(name) ||
  ['set_project_dependencies', 'set_week_plan_items', 'apply_plan_changes'].includes(name);

export function buildServer(call: Call, canWrite = true) {
  const server = new McpServer(
    { name: 'memento', version: APP_VERSION },
    {
      instructions:
        "Mémento : objectifs, projets et tâches de l'utilisateur. Avant d'agir, lis le guide (outil get_guide) puis la vue d'ensemble (get_context). Toutes les règles sont appliquées par l'API ; un refus renvoie un code et un message en français à transmettre tel quel.",
    },
  );
  type Args<T extends z.ZodRawShape> = z.infer<z.ZodObject<T>>;
  const tool = <T extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: T,
    run: (a: Args<T>) => Promise<unknown>,
  ) => {
    if (!canWrite && !isReadTool(name)) return; // H-12: a read token does not see the writing tools
    server.registerTool(
      name,
      {
        title: name.replaceAll('_', ' '),
        description,
        inputSchema: described(shape),
        annotations: {
          readOnlyHint: isReadTool(name),
          destructiveHint: !isReadTool(name) && isDestructiveTool(name),
          openWorldHint: false,
        },
      },
      (async (args: Args<T>) => {
        const started = Date.now();
        try {
          const out = ok(await run(args));
          logCall(name, started, 200);
          return out;
        } catch (e) {
          logCall(name, started, e instanceof ApiFailure ? e.status : 0);
          return fail(e);
        }
      }) as never,
    );
  };

  tool(
    'search',
    'Recherche globale (objectifs, projets, idées, tâches, Inbox), classée par pertinence.',
    { q: z.string() },
    (a) => call('GET', p`/search${qs({ q: a.q })}`),
  );

  tool(
    'get_context',
    "Vue d'ensemble : domaines par priorité, objectifs actifs, projets du mois, semaine en cours (budget, fait), alertes de planification.",
    {},
    async () => {
      const week = await currentWeek(call);
      const [domains, objectives, monthProjects, execution, plan] = await Promise.all([
        call('GET', '/domains'),
        call('GET', '/objectives?status=active'),
        call('GET', p`/projects${qs({ status: 'active', month: new Date().toISOString().slice(0, 7) })}`),
        call('GET', p`/weeks/${week}/execution`),
        call('GET', p`/week-plans/${week}`),
      ]);
      const ex = execution as { budget: unknown; doneMin: number; experiences: unknown; remaining: number };
      return {
        currentWeek: week,
        domains,
        objectives,
        monthProjects,
        week: {
          budget: ex.budget,
          doneMin: ex.doneMin,
          experiences: ex.experiences,
          remaining: ex.remaining,
        },
        alerts: (plan as { alerts: unknown }).alerts,
      };
    },
  );

  tool(
    'list_objectives',
    'Liste les objectifs (filtres statut, trimestre ex. 2026-Q4).',
    { status: z.string().optional(), quarter: z.string().optional() },
    (a) => call('GET', p`/objectives${qs(a)}`),
  );
  tool(
    'get_objective',
    "Détail d'un objectif avec son chemin : projets ordonnés et leurs prérequis (dependsOn ; waitingOn = prérequis non terminés, informatif).",
    { id: S.uuid },
    async (a) => ({
      ...((await call('GET', p`/objectives/${a.id}`)) as object),
      path: await call('GET', p`/objectives/${a.id}/path`),
    }),
  );
  tool(
    'create_objective',
    'Crée un objectif trimestriel (deadline obligatoire, dans le trimestre).',
    S.objectiveCreate.shape,
    (a) => call('POST', '/objectives', a),
  );
  tool(
    'update_objective',
    'Modifie un objectif.',
    { id: S.uuid, ...S.objectivePatch.shape },
    ({ id, ...rest }) => call('PATCH', p`/objectives/${id}`, rest),
  );

  tool(
    'list_projects',
    'Liste les projets (statuts séparés par des virgules : idea,active,paused,done,abandoned ; groupe ; domaine ; mois AAAA-MM).',
    S.projectListQuery.shape,
    (a) => call('GET', p`/projects${qs(a)}`),
  );
  tool(
    'get_project',
    'Détail d’un projet avec ses tâches dans l’ordre (verrous inclus : dans un projet séquentiel une tâche attend la précédente), ses prérequis (dependsOn, waitingOn, blocked : informatifs, ils ne bloquent jamais le projet) et ses ressources.',
    { id: S.uuid },
    async (a) => ({
      ...((await call('GET', p`/projects/${a.id}`)) as object),
      tasks: await call('GET', p`/tasks${qs({ projectId: a.id })}`),
    }),
  );
  tool(
    'create_idea',
    'Capture une idée : un titre et au moins un groupe suffisent.',
    { title: z.string(), groupIds: z.array(S.uuid).min(1), description: z.string().optional() },
    (a) => call('POST', '/projects', a),
  );
  tool(
    'create_project',
    'Crée un projet (critère de succès, groupes, tâches 5/15/30/60/120 min ; dates facultatives) puis le promeut en « prêt » (backlog). Les manques éventuels sont dans le champ gaps.',
    {
      ...S.projectCreate.omit({ promote: true }).shape,
      tasks: z
        .array(
          z.object({
            title: z.string(),
            durationMin: S.duration,
            isExperience: z.boolean().optional(),
            isFree: z.boolean().optional(),
          }),
        )
        .min(1),
    },
    // H-11: project, tasks and promotion in one call (all or none).
    (body) => call('POST', '/projects', { ...body, promote: true }),
  );
  tool(
    'update_project',
    'Modifie un projet ou une idée (titre, critère, dates, objectif, projet libre isFree, statut : ready / paused / abandoned / idea). Pour le projet du mois, utiliser set_project_month.',
    { id: S.uuid, ...S.projectPatch.shape },
    ({ id, ...rest }) => call('PATCH', p`/projects/${id}`, rest),
  );
  tool(
    'duplicate_project',
    'Duplique un projet (D-109) : mêmes groupes, objectif, critère, description, tâches toutes à faire ; ni mois, ni dates, ni récurrence. Titre par défaut « … (copie) ». Une idée reste une idée, sinon la copie est « prête ».',
    { id: S.uuid, title: S.projectDuplicateBody.shape.title },
    ({ id, ...rest }) => call('POST', p`/projects/${id}/duplicate`, rest),
  );
  tool(
    'duplicate_objective',
    'Duplique un objectif (D-109) : mêmes champs, mesure remise à 0, même trimestre ; avec ses projets (hors abandonnés) et l’ordre de leur chemin, sauf withProjects: false.',
    { id: S.uuid, ...S.objectiveDuplicateBody.shape },
    ({ id, ...rest }) => call('POST', p`/objectives/${id}/duplicate`, rest),
  );
  tool(
    'promote_idea',
    'Promeut une idée en projet « prêt » (backlog). Jamais bloquant : les manques RB-02 sont renvoyés dans gaps.',
    { id: S.uuid },
    (a) => call('POST', p`/projects/${a.id}/promote`),
  );
  tool(
    'get_templates',
    'Modèles de description de l’utilisateur (méta-objectif, objectif, projet, tâche) : la structure à suivre quand tu rédiges une description. Ils ne sont jamais copiés tels quels (D-119).',
    {},
    () => call('GET', '/templates'),
  );

  tool(
    'get_guide',
    'Guide d’utilisation de Mémento pour une IA (Markdown) : modèle, cycle de vie, planification, recettes, codes d’erreur. À lire en premier.',
    {},
    async () => ((await call('GET', '/guide')) as { markdown: string }).markdown,
  );
  tool(
    'get_experiences',
    'Expériences (objectif de vivre plus d’expériences) : cible sur la fenêtre glissante, souvenirs (faites), prévues, réserve.',
    {},
    () => call('GET', '/experiences'),
  );
  tool(
    'add_experience_idea',
    'Ajoute une idée d’expérience à la réserve (tâche Inbox marquée Expérience, sans date).',
    S.experienceIdea.shape,
    (a) => call('POST', '/experiences', a),
  );
  tool(
    'set_objective_quarter',
    'Place un objectif dans un trimestre (AAAA-Qn) : planification du trimestre. Sa deadline est ramenée dans le trimestre si besoin.',
    { id: S.uuid, quarter: S.quarterKey },
    (a) => call('POST', p`/objectives/${a.id}/quarter`, { quarter: a.quarter }),
  );
  tool(
    'set_project_month',
    'Choisit un projet prêt comme projet du mois (month = AAAA-MM ; mois courant = actif) ou le retire (month = null). Exige RB-02 complet.',
    { id: S.uuid, month: S.monthKey.nullable() },
    (a) => call('POST', p`/projects/${a.id}/month`, { month: a.month }),
  );
  tool(
    'complete_project',
    'Termine un projet réussi (critère de succès atteint). Un projet qui ne l’atteindra pas s’abandonne (update_project status « abandoned ») : ses tâches faites restent faites (D-140).',
    { id: S.uuid },
    (a) => call('POST', p`/projects/${a.id}/complete`, {}),
  );

  tool(
    'list_meta_objectives',
    'Liste les méta-objectifs (cap long terme ; outcomeTitle = titre formulé en résultat, primaryDomainId = domaine).',
    {},
    () => call('GET', '/meta-objectives'),
  );
  tool('get_meta_objective', "Détail d'un méta-objectif avec ses objectifs.", { id: S.uuid }, (a) =>
    call('GET', p`/meta-objectives/${a.id}`),
  );
  tool(
    'create_meta_objective',
    'Crée un méta-objectif (titre ; outcomeTitle ≤ 80 caractères ; primaryDomainId = domaine de la Vue Plan).',
    S.metaObjectiveCreate.shape,
    (a) => call('POST', '/meta-objectives', a),
  );
  tool(
    'update_meta_objective',
    'Modifie un méta-objectif (titre, description, horizon, statut, outcomeTitle, primaryDomainId).',
    { id: S.uuid, ...S.metaObjectivePatch.shape },
    ({ id, ...rest }) => call('PATCH', p`/meta-objectives/${id}`, rest),
  );
  tool(
    'set_objective_meta',
    'Rattache un objectif à un méta-objectif (metaObjectiveId = null : aucun).',
    { id: S.uuid, metaObjectiveId: S.uuid.nullable() },
    (a) => call('PATCH', p`/objectives/${a.id}`, { metaObjectiveId: a.metaObjectiveId }),
  );

  tool(
    'set_project_dependencies',
    "Remplace les prérequis d'un projet (dependsOn = ids des projets à terminer avant). Les prérequis ne bloquent jamais le mois ni la semaine ; refus DEPENDENCY_CYCLE / DEPENDENCY_SELF / DEPENDENCY_NOT_FOUND.",
    { id: S.uuid, ...S.projectDependenciesBody.shape },
    (a) => call('PUT', p`/projects/${a.id}/dependencies`, { dependsOn: a.dependsOn }),
  );
  tool(
    'add_project_dependency',
    'Ajoute un prérequis à un projet (dependsOnId = projet à terminer avant).',
    { id: S.uuid, dependsOnId: S.uuid },
    (a) => call('POST', p`/projects/${a.id}/dependencies`, { dependsOnId: a.dependsOnId }),
  );
  tool(
    'remove_project_dependency',
    "Retire un prérequis d'un projet.",
    { id: S.uuid, dependsOnId: S.uuid },
    (a) => call('DELETE', p`/projects/${a.id}/dependencies/${a.dependsOnId}`),
  );

  const planOps = z
    .array(
      z.discriminatedUnion('op', [
        z.object({ op: z.literal('setDependencies'), projectId: S.uuid, dependsOn: z.array(S.uuid) }),
        z.object({
          op: z.literal('attachProject'),
          projectId: S.uuid,
          objectiveId: S.uuid,
          dependsOn: z.array(S.uuid).optional(),
          free: z.boolean().optional(),
        }),
        z.object({ op: z.literal('detachProject'), projectId: S.uuid }),
        z.object({ op: z.literal('setFree'), projectId: S.uuid, free: z.boolean() }),
        z.object({ op: z.literal('setObjectiveQuarter'), objectiveId: S.uuid, quarter: S.quarterKey }),
        z.object({
          op: z.literal('setObjectiveMeta'),
          objectiveId: S.uuid,
          metaObjectiveId: S.uuid.nullable(),
        }),
        z.object({ op: z.literal('reorderObjectives'), quarter: S.quarterKey, ids: z.array(S.uuid).min(1) }),
      ]),
    )
    .min(1);
  const planBody = {
    ops: planOps,
    baseVersion: z.string().optional(),
    domainIds: z.string().optional(),
  };
  tool(
    'get_plan_graph',
    'Vue Plan : tout le graphe (méta-objectifs, objectifs, projets, prérequis, capacité par trimestre, alertes, version, réserve). domainIds = ids séparés par des virgules (vide = tous) ; from / to = AAAA-Qn.',
    {
      domainIds: z.string().optional(),
      from: S.quarterKey.optional(),
      to: S.quarterKey.optional(),
      includeReserve: z.boolean().optional(),
    },
    (a) =>
      call(
        'GET',
        p`/plan-graph${qs({ ...a, includeReserve: a.includeReserve === undefined ? undefined : String(a.includeReserve) })}`,
      ),
  );
  tool(
    'preview_plan_changes',
    'Simule des modifications du plan (ops : setDependencies, attachProject, detachProject, setFree, setObjectiveQuarter, setObjectiveMeta, reorderObjectives) sans rien écrire : renvoie capacité, alertes et objectifs résultants.',
    planBody,
    (a) => call('POST', '/plan/preview', a),
  );
  tool(
    'apply_plan_changes',
    "Applique des modifications du plan en une seule opération atomique (mêmes ops que preview_plan_changes). Tout ou rien ; baseVersion (champ version de get_plan_graph) périmée = PLAN_APPLY_CONFLICT. À prévisualiser d'abord.",
    planBody,
    (a) => call('POST', '/plan/apply', a),
  );
  tool(
    'reorder_objectives',
    "Fixe l'ordre des objectifs d'un trimestre (ids dans l'ordre voulu).",
    { quarter: S.quarterKey, ids: z.array(S.uuid).min(1) },
    (a) =>
      call('POST', '/plan/apply', { ops: [{ op: 'reorderObjectives', quarter: a.quarter, ids: a.ids }] }),
  );

  tool(
    'create_tasks',
    'Crée des tâches en lot (découper un projet). projectId absent = Inbox.',
    S.taskBatchCreate.shape,
    (a) => call('POST', '/tasks/batch', a),
  );
  // H-12: reading the tasks themselves (Inbox included), by pages.
  tool(
    'list_tasks',
    'Liste les tâches d\'un projet (projectId) ou de l\'Inbox (projectId: "inbox"), dans leur ordre ; status : todo, done ou cancelled. Pages avec limit et offset.',
    {
      projectId: z.union([S.uuid, z.literal('inbox')]),
      status: z.enum(['todo', 'done', 'cancelled']).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    },
    (a) => call('GET', p`/tasks${qs(a)}`),
  );
  tool(
    'list_inbox',
    "Liste les tâches à faire de l'Inbox (hors projet), dans leur ordre.",
    { limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() },
    (a) => call('GET', p`/tasks${qs({ projectId: 'inbox', status: 'todo', ...a })}`),
  );
  tool('get_task', "Détail d'une tâche (projet, prérequis, liens).", { id: S.uuid }, (a) =>
    call('GET', p`/tasks/${a.id}`),
  );
  tool('update_task', 'Modifie une tâche.', { id: S.uuid, ...S.taskPatch.shape }, ({ id, ...rest }) =>
    call('PATCH', p`/tasks/${id}`, rest),
  );
  tool(
    'complete_task',
    'Coche une tâche (une tâche Inbox récurrente crée sa prochaine occurrence). actualMin : temps réellement passé en minutes, si différent de l’estimation. Une tâche qui n’était prévue ni cette semaine ni la précédente est tracée « hors planification » (D-99).',
    { id: S.uuid, actualMin: z.number().int().min(1).max(6000).optional() },
    (a) => call('POST', p`/tasks/${a.id}/complete`, a.actualMin ? { actualMin: a.actualMin } : undefined),
  );
  tool(
    'reorder_tasks',
    "Réordonne les tâches d'un projet (l'ordre crée le prérequis implicite ; une tâche isFree démarre une nouvelle suite : elle n'attend rien et les tâches non libres placées dessous la suivent).",
    S.taskReorderBody.shape,
    (a) => call('POST', '/tasks/reorder', a),
  );
  tool(
    'log_done_task',
    'Trace une tâche déjà faite sans avoir été prévue (« Fait hors plan », D-99) : la crée dans le projet (projectId absent = Inbox) et la coche ; elle compte dans la dérive des rapports.',
    S.taskCreate.shape,
    (a) => call('POST', '/tasks/done', a),
  );
  tool(
    'get_calendar',
    'Calendrier des tâches (D-113) de from à to (AAAA-MM-JJ, 121 jours max) : entries = tâches à faire à leur deadline (late si dépassée), faites au jour où elles l’ont été, prochaines occurrences des récurrentes (kind occurrence) ; planned = tâches prévues dans le plan d’une semaine sans jour dans cette semaine.',
    S.calendarQuery.shape,
    (a) => call('GET', p`/calendar${qs({ from: a.from, to: a.to })}`),
  );
  tool(
    'parse_task',
    'Lit une tâche écrite en français courant (D-115) sans rien créer : title nettoyé, dueDate, recurrenceRule (RRULE), durationMin (arrondie à 5/15/30/60/120), domainId (#domaine), week (« cette semaine » = plan de la semaine, isoWeek), parts = ce qui a été reconnu avec d’éventuels avertissements. inbox=false pour une tâche de projet (ni récurrence, ni domaine, ni semaine). Ex. « Sortir les poubelles tous les mardis 5 min #maison ».',
    S.taskParseBody.shape,
    (a) => call('POST', '/tasks/parse', a),
  );
  tool(
    'get_cap',
    'Cap (D-100) : objectifs du trimestre par méta-objectif et projets du mois, chacun avec son pourquoi en quelques mots (motive, mot-clé entre **…**). month = AAAA-MM, défaut = mois en cours. Le pourquoi se modifie par update_meta_objective / update_objective / update_project (champ motive).',
    { month: S.monthKey.optional() },
    (a) => call('GET', p`/cap${qs({ month: a.month })}`),
  );
  tool(
    'add_inbox_task',
    'Capture rapide dans l’Inbox.',
    {
      title: z.string(),
      durationMin: S.duration.optional(),
      dueDate: S.isoDate.optional(),
      domainId: S.uuid.optional(),
    },
    (a) => call('POST', '/tasks', { ...a, projectId: null }),
  );

  tool(
    'get_week_plan',
    'Page « Planifier la semaine » : bacs, tâches visibles, pourquoi, budget, alertes. Semaine ISO (ex. 2026-W45), défaut = semaine en cours.',
    { isoWeek: S.isoWeek.optional() },
    async (a) => call('GET', p`/week-plans/${a.isoWeek ?? (await currentWeek(call))}`),
  );
  tool(
    'propose_week_plan',
    'Relance le moteur de proposition pour une semaine.',
    { isoWeek: S.isoWeek },
    (a) => call('POST', p`/week-plans/${a.isoWeek}/propose`),
  );
  tool(
    'set_week_plan_items',
    'Remplace la sélection de la semaine (kind = week ou bonus).',
    { isoWeek: S.isoWeek, ...S.weekItemsBody.shape },
    ({ isoWeek, items }) => call('PUT', p`/week-plans/${isoWeek}/items`, { items }),
  );

  tool(
    'list_reports',
    'Liste les rapports figés (kind = week, month, quarter).',
    S.reportListQuery.shape,
    (a) => call('GET', p`/reports${qs(a)}`),
  );
  tool(
    'get_report',
    'Lit un rapport figé (par id, ou par kind + periodKey ex. week/2026-W43).',
    {
      id: S.uuid.optional(),
      kind: z.enum(['week', 'month', 'quarter']).optional(),
      periodKey: S.reportPeriodKey.optional(),
    },
    async (a) => {
      if (a.id) return call('GET', p`/reports/${a.id}`);
      if (!a.kind || !a.periodKey) throw new Error('Donner id, ou kind et periodKey (ex. week, 2026-W43).');
      return call('GET', p`/reports/by-period/${a.kind}/${a.periodKey}`);
    },
  );
  tool(
    'get_daily_recap',
    'Bilan du jour (D-77, D-78) : faits des 24 dernières heures (D-121 ; le dimanche : 48 h ; ou date = AAAA-MM-JJ : les 24 h jusqu’à l’heure d’envoi de ce jour), 7 derniers jours, semaines d’affilée et volume des 4 semaines, semaine, pistes si rien n’est fait, et le rapport simple.',
    { date: S.isoDate.optional() },
    (a) => call('GET', p`/daily-recap${qs(a)}`),
  );
  tool(
    'list_vacations',
    'Périodes de vacances (D-78) : aucun bilan du soir pendant ces jours. onVacation = vacances aujourd’hui.',
    {},
    () => call('GET', '/vacations'),
  );
  tool(
    'add_vacation',
    'Déclare des vacances du from au to (AAAA-MM-JJ, inclus) : aucun bilan du soir, la série de semaines ne casse pas.',
    { from: S.isoDate, to: S.isoDate },
    (a) => call('POST', '/vacations', a),
  );
  tool(
    'remove_vacation',
    'Supprime la période de vacances qui commence le from (AAAA-MM-JJ).',
    { from: S.isoDate },
    (a) => call('DELETE', p`/vacations/${a.from}`),
  );
  tool(
    'list_changes',
    'Ce qui a changé (F-25) : since = 24h | 7d | ISO, actor = all | me | ai.',
    S.changesQuery.shape,
    (a) => call('GET', p`/changes${qs(a)}`),
  );
  tool(
    'add_resource',
    'Ajoute un lien de documentation (objectif, projet, tâche, groupe).',
    S.resourceCreate.shape,
    (a) => call('POST', '/resources', a),
  );

  // Hard deletion (D-35, D-60): definitive and journaled. Only on the user's explicit request.
  const DELETE_WARNING =
    "Suppression DÉFINITIVE (journalisée). Uniquement si l'utilisateur l'a demandé explicitement ; sinon préfère abandonner / annuler.";
  tool('delete_task', `Supprime une tâche. ${DELETE_WARNING}`, { id: S.uuid }, (a) =>
    call('DELETE', p`/tasks/${a.id}`),
  );
  tool('delete_project', `Supprime un projet avec ses tâches. ${DELETE_WARNING}`, { id: S.uuid }, (a) =>
    call('DELETE', p`/projects/${a.id}`),
  );
  tool(
    'delete_objective',
    `Supprime un objectif ; ses projets restent, hors objectif. ${DELETE_WARNING}`,
    { id: S.uuid },
    (a) => call('DELETE', p`/objectives/${a.id}`),
  );
  tool(
    'delete_meta_objective',
    `Supprime un méta-objectif ; ses objectifs restent, sans méta-objectif. ${DELETE_WARNING}`,
    { id: S.uuid },
    (a) => call('DELETE', p`/meta-objectives/${a.id}`),
  );
  return server;
}

const bearer = (req: IncomingMessage) =>
  req.headers.authorization?.match(/^Bearer\s+(mem_[A-Za-z0-9_-]+)$/)?.[1];

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error('Body too large');
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
}

const http = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404).end();
    return;
  }
  const token = bearer(req);
  if (!token) {
    res
      .writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' })
      .end('{"error":"Bearer token required (Configuration › Accès)"}');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' }).end(); // stateless server: no SSE stream, no session
    return;
  }
  try {
    const body = await readJson(req);
    const call = apiClient(token);
    const me = (await call('GET', '/auth/me')) as { canWrite?: boolean };
    const server = buildServer(call, me.canWrite !== false);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent)
      res
        .writeHead(e instanceof ApiFailure ? e.status : 400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: (e as Error).message }));
  }
});

if (process.env.MEMENTO_MCP_NO_LISTEN !== '1') {
  http.listen(PORT, HOST, () =>
    console.log(
      JSON.stringify({ level: 30, time: Date.now(), msg: `MCP listening on http://${HOST}:${PORT}/mcp` }),
    ),
  );
}

export { http };
