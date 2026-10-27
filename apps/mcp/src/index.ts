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
const qs = (o: Record<string, unknown>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};

export function buildServer(call: Call) {
  const server = new McpServer(
    { name: 'memento', version: APP_VERSION },
    {
      instructions:
        "Mémento : objectifs, projets et tâches de Mehdi. Avant d'agir, lis le guide (outil get_guide) puis la vue d'ensemble (get_context). Toutes les règles sont appliquées par l'API ; un refus renvoie un code et un message en français à transmettre tel quel.",
    },
  );
  type Args<T extends z.ZodRawShape> = z.infer<z.ZodObject<T>>;
  const tool = <T extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: T,
    run: (a: Args<T>) => Promise<unknown>,
  ) =>
    server.registerTool(name, { description, inputSchema: shape }, (async (args: Args<T>) => {
      try {
        return ok(await run(args));
      } catch (e) {
        return fail(e);
      }
    }) as never);

  tool(
    'search',
    'Recherche globale (objectifs, projets, idées, tâches, Inbox), classée par pertinence.',
    { q: z.string() },
    (a) => call('GET', `/search${qs({ q: a.q })}`),
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
        call('GET', `/projects${qs({ status: 'active', month: new Date().toISOString().slice(0, 7) })}`),
        call('GET', `/weeks/${week}/execution`),
        call('GET', `/week-plans/${week}`),
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
    (a) => call('GET', `/objectives${qs(a)}`),
  );
  tool(
    'get_objective',
    "Détail d'un objectif avec son chemin : projets ordonnés, prérequis, blocages.",
    { id: S.uuid },
    async (a) => ({
      ...((await call('GET', `/objectives/${a.id}`)) as object),
      path: await call('GET', `/objectives/${a.id}/path`),
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
    ({ id, ...rest }) => call('PATCH', `/objectives/${id}`, rest),
  );

  tool(
    'list_projects',
    'Liste les projets (statuts séparés par des virgules : idea,active,paused,done,abandoned ; groupe ; domaine ; mois AAAA-MM).',
    S.projectListQuery.shape,
    (a) => call('GET', `/projects${qs(a)}`),
  );
  tool(
    'get_project',
    'Détail d’un projet avec ses tâches dans l’ordre (verrous inclus) et ressources.',
    { id: S.uuid },
    async (a) => ({
      ...((await call('GET', `/projects/${a.id}`)) as object),
      tasks: await call('GET', `/tasks?projectId=${a.id}`),
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
      ...S.projectCreate.shape,
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
    async ({ tasks, ...p }) => {
      const project = (await call('POST', '/projects', p)) as { id: string };
      await call('POST', '/tasks/batch', { projectId: project.id, tasks });
      try {
        return await call('POST', `/projects/${project.id}/promote`);
      } catch (e) {
        return { project, promoted: false, error: e instanceof ApiFailure ? e.data : String(e) };
      }
    },
  );
  tool(
    'update_project',
    'Modifie un projet ou une idée (titre, critère, dates, objectif, statut : ready / paused / abandoned / idea). Pour le projet du mois, utiliser set_project_month.',
    { id: S.uuid, ...S.projectPatch.shape },
    ({ id, ...rest }) => call('PATCH', `/projects/${id}`, rest),
  );
  tool(
    'promote_idea',
    'Promeut une idée en projet « prêt » (backlog). Jamais bloquant : les manques RB-02 sont renvoyés dans gaps.',
    { id: S.uuid },
    (a) => call('POST', `/projects/${a.id}/promote`),
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
    (a) => call('POST', `/objectives/${a.id}/quarter`, { quarter: a.quarter }),
  );
  tool(
    'set_project_month',
    'Choisit un projet prêt comme projet du mois (month = AAAA-MM ; mois courant = actif) ou le retire (month = null). Exige RB-02 complet.',
    { id: S.uuid, month: S.monthKey.nullable() },
    (a) => call('POST', `/projects/${a.id}/month`, { month: a.month }),
  );
  tool(
    'complete_project',
    'Termine un projet : critère de succès atteint ? (oui/non).',
    { id: S.uuid, success: z.boolean() },
    (a) => call('POST', `/projects/${a.id}/complete`, { success: a.success }),
  );

  tool(
    'create_tasks',
    'Crée des tâches en lot (découper un projet). projectId absent = Inbox.',
    S.taskBatchCreate.shape,
    (a) => call('POST', '/tasks/batch', a),
  );
  tool('update_task', 'Modifie une tâche.', { id: S.uuid, ...S.taskPatch.shape }, ({ id, ...rest }) =>
    call('PATCH', `/tasks/${id}`, rest),
  );
  tool(
    'complete_task',
    'Coche une tâche (une tâche Inbox récurrente crée sa prochaine occurrence). actualMin : temps réellement passé en minutes, si différent de l’estimation.',
    { id: S.uuid, actualMin: z.number().int().min(1).max(6000).optional() },
    (a) => call('POST', `/tasks/${a.id}/complete`, a.actualMin ? { actualMin: a.actualMin } : undefined),
  );
  tool(
    'reorder_tasks',
    "Réordonne les tâches d'un projet (l'ordre crée le prérequis implicite).",
    S.taskReorderBody.shape,
    (a) => call('POST', '/tasks/reorder', a),
  );
  tool(
    'add_inbox_task',
    'Capture rapide dans l’Inbox.',
    {
      title: z.string(),
      durationMin: S.duration.optional(),
      dueDate: z.string().optional(),
      domainId: S.uuid.optional(),
    },
    (a) => call('POST', '/tasks', { ...a, projectId: null }),
  );

  tool(
    'get_week_plan',
    'Page « Planifier la semaine » : bacs, tâches visibles, pourquoi, budget, alertes. Semaine ISO (ex. 2026-W45), défaut = semaine en cours.',
    { isoWeek: z.string().optional() },
    async (a) => call('GET', `/week-plans/${a.isoWeek ?? (await currentWeek(call))}`),
  );
  tool(
    'propose_week_plan',
    'Relance le moteur de proposition pour une semaine.',
    { isoWeek: z.string() },
    (a) => call('POST', `/week-plans/${a.isoWeek}/propose`),
  );
  tool(
    'set_week_plan_items',
    'Remplace la sélection de la semaine (kind = week ou bonus).',
    { isoWeek: z.string(), ...S.weekItemsBody.shape },
    ({ isoWeek, items }) => call('PUT', `/week-plans/${isoWeek}/items`, { items }),
  );

  tool(
    'list_reports',
    'Liste les rapports figés (kind = week, month, quarter).',
    S.reportListQuery.shape,
    (a) => call('GET', `/reports${qs(a)}`),
  );
  tool(
    'get_report',
    'Lit un rapport figé (par id, ou par kind + periodKey ex. week/2026-W43).',
    {
      id: S.uuid.optional(),
      kind: z.enum(['week', 'month', 'quarter']).optional(),
      periodKey: z.string().optional(),
    },
    (a) =>
      a.id ? call('GET', `/reports/${a.id}`) : call('GET', `/reports/by-period/${a.kind}/${a.periodKey}`),
  );
  tool(
    'list_changes',
    'Ce qui a changé (F-25) : since = 24h | 7d | ISO, actor = all | me | ai.',
    S.changesQuery.shape,
    (a) => call('GET', `/changes${qs(a)}`),
  );
  tool(
    'add_resource',
    'Ajoute un lien de documentation (objectif, projet, tâche, groupe).',
    S.resourceCreate.shape,
    (a) => call('POST', '/resources', a),
  );

  // Hard deletion (D-35, D-60): definitive and journaled. Only on Mehdi's explicit request.
  const DELETE_WARNING =
    "Suppression DÉFINITIVE (journalisée). Uniquement si Mehdi l'a demandé explicitement ; sinon préfère abandonner / annuler.";
  tool('delete_task', `Supprime une tâche. ${DELETE_WARNING}`, { id: S.uuid }, (a) =>
    call('DELETE', `/tasks/${a.id}`),
  );
  tool('delete_project', `Supprime un projet avec ses tâches. ${DELETE_WARNING}`, { id: S.uuid }, (a) =>
    call('DELETE', `/projects/${a.id}`),
  );
  tool(
    'delete_objective',
    `Supprime un objectif ; ses projets restent, hors objectif. ${DELETE_WARNING}`,
    { id: S.uuid },
    (a) => call('DELETE', `/objectives/${a.id}`),
  );
  tool(
    'delete_meta_objective',
    `Supprime un méta-objectif ; ses objectifs restent, sans méta-objectif. ${DELETE_WARNING}`,
    { id: S.uuid },
    (a) => call('DELETE', `/meta-objectives/${a.id}`),
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
    const server = buildServer(apiClient(token));
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
        .writeHead(400, { 'content-type': 'application/json' })
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
