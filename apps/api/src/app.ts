// Mémento REST API (dossier de dev §8). The only entry point to business logic (F-26): routes are thin
// adapters around @memento/domain services.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import type { Db, SqliteDatabase } from '@memento/db';
import * as D from '@memento/domain';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import * as A from './auth.ts';

const GUIDE_FILE = resolve(import.meta.dirname, '../../../docs/api/guide-ia.md');

export interface AppOptions {
  db: Db;
  sqlite: SqliteDatabase;
  cookieSecure: boolean;
  webDist?: string;
  logger?: boolean;
  now?: () => Date;
  /** Where the SQLite backup is written before an import (D-50); no backup when absent (tests). */
  backupDir?: string;
  /** Replaces the configured AI provider (tests). */
  llm?: D.Llm;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: A.Principal | null;
  }
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger: opts.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    trustProxy: true,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Mémento API',
        description: 'Objectifs, projets, charge mentale. Auth : cookie de session ou Bearer.',
        version: D.APP_VERSION,
      },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });

  const { db, sqlite } = opts;
  app.decorateRequest('principal', null);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
  });

  // Authentication for every /api/v1 route except login, health and the OpenAPI document.
  const PUBLIC = new Set(['/api/v1/auth/login', '/api/v1/health', '/api/v1/openapi.json']);
  // /auth/me answers 200 { authenticated: false } instead of 401 (no console noise before login).
  const SOFT = new Set(['/api/v1/auth/me']);
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC.has(path)) return;
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    req.principal = bearer
      ? A.tokenPrincipal(db, bearer)
      : A.sessionPrincipal(db, req.cookies[A.SESSION_COOKIE]);
    if (!req.principal && SOFT.has(path)) return;
    if (!req.principal)
      return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Connexion requise.' });
    if (!req.principal.canWrite && req.method !== 'GET') {
      return reply.code(403).send({ code: 'READ_ONLY_TOKEN', message: 'Jeton en lecture seule.' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof D.DomainError)
      return reply.code(422).send({ code: err.code, message: err.message, details: err.details });
    if (err instanceof D.NotFoundError)
      return reply.code(404).send({ code: 'NOT_FOUND', message: `${err.entity} introuvable` });
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply
        .code(400)
        .send({ code: 'VALIDATION_ERROR', message: 'Requête invalide', details: err.validation });
    }
    if ((err as { statusCode?: number }).statusCode === 429)
      return reply
        .code(429)
        .send({ code: 'RATE_LIMITED', message: 'Trop de tentatives, réessaie dans une minute.' });
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      return reply
        .code((err as { statusCode: number }).statusCode)
        .send({ code: 'BAD_REQUEST', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ code: 'INTERNAL', message: 'Erreur interne' });
  });

  const ctx = (req: FastifyRequest): D.Ctx => ({ db, sqlite, actor: req.principal!.actor, now: opts.now });
  const userOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.principal?.kind !== 'user')
      return reply
        .code(403)
        .send({ code: 'USER_ONLY', message: 'Réservé à l’interface (utilisateur connecté).' });
  };
  const today = () => D.parisDate(opts.now ? opts.now() : new Date());

  await app.register(
    async (api) => {
      const r = api.withTypeProvider<ZodTypeProvider>();
      const tag = (t: string) => ({ tags: [t] });

      // ---------- Health, auth ----------
      r.get('/health', { schema: tag('Système') }, async () => ({ ok: true, version: D.APP_VERSION }));
      // Guide for AI clients (docs/api/guide-ia.md), also served by the MCP tool get_guide.
      r.get('/guide', { schema: tag('Système') }, async () => ({
        format: 'markdown',
        markdown: await readFile(GUIDE_FILE, 'utf8'),
      }));
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

      r.post(
        '/auth/login',
        {
          schema: {
            ...tag('Auth'),
            body: z.object({ login: z.string().min(1).max(100), password: z.string().min(1).max(500) }),
          },
          config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        },
        async (req, reply) => {
          const res = await A.login(db, req.body.login, req.body.password);
          if (!res)
            return reply
              .code(401)
              .send({ code: 'BAD_CREDENTIALS', message: 'Identifiant ou mot de passe incorrect.' });
          reply.setCookie(A.SESSION_COOKIE, res.raw, {
            path: '/',
            httpOnly: true,
            sameSite: 'strict',
            secure: opts.cookieSecure,
            maxAge: A.SESSION_DAYS * 86_400,
          });
          return { user: res.user };
        },
      );
      r.post('/auth/logout', { schema: tag('Auth') }, async (req, reply) => {
        const raw = req.cookies[A.SESSION_COOKIE];
        if (raw) A.logout(db, raw);
        reply.clearCookie(A.SESSION_COOKIE, { path: '/' });
        return { ok: true };
      });
      r.get('/auth/me', { schema: tag('Auth') }, async (req) => {
        if (!req.principal) return { authenticated: false };
        return {
          authenticated: true,
          kind: req.principal!.kind,
          actor: req.principal!.actor,
          login: req.principal!.login ?? null,
          canWrite: req.principal!.canWrite,
          today: today(),
          currentWeek: D.isoWeekOf(today()),
          unreviewed: D.unreviewedCount(ctx(req)),
        };
      });

      r.patch(
        '/auth/account',
        {
          schema: { ...tag('Auth'), body: z.object({ login: z.string().min(1).max(100) }) },
          preHandler: userOnly,
        },
        async (req) => {
          const c = ctx(req);
          return D.tx(c, () => {
            const before = req.principal!.login;
            const res = A.renameUser(db, req.principal!.userId!, req.body.login);
            D.audit(c, 'app_user', req.principal!.userId!, 'update', { login: before }, res);
            return res;
          });
        },
      );
      r.post(
        '/auth/password',
        {
          schema: {
            ...tag('Auth'),
            body: z.object({ current: z.string().min(1).max(500), next: z.string().min(1).max(500) }),
          },
          preHandler: userOnly,
          config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        },
        async (req) => {
          const c = ctx(req);
          await A.changeOwnPassword(
            db,
            req.principal!.userId!,
            req.cookies[A.SESSION_COOKIE]!,
            req.body.current,
            req.body.next,
          );
          D.audit(c, 'app_user', req.principal!.userId!, 'update', null, { password: 'changed' });
          return { ok: true };
        },
      );

      // ---------- Settings & tokens (interface only, not for AI: dossier §9) ----------
      r.get('/settings', { schema: tag('Réglages') }, async (req) => D.getSettings(ctx(req)));
      r.patch(
        '/settings',
        { schema: { ...tag('Réglages'), body: D.settingsPatchSchema }, preHandler: userOnly },
        async (req) => D.patchSettings(ctx(req), req.body),
      );
      r.get('/tokens', { schema: tag('Accès'), preHandler: userOnly }, async () => A.listTokens(db));
      // D-50: restore an export (replaces all business data). A SQLite backup is taken first.
      r.post(
        '/import',
        {
          schema: { ...tag('Réglages'), body: z.record(z.string(), z.unknown()) },
          preHandler: userOnly,
          bodyLimit: 100 * 1024 * 1024,
        },
        async (req) => {
          let backup: string | null = null;
          if (opts.backupDir) {
            backup = join(
              opts.backupDir,
              `backup-avant-import-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
            );
            await sqlite.backup(backup);
          }
          return { ...D.importData(ctx(req), req.body), backup: backup ? basename(backup) : null };
        },
      );
      // D-58: « Proposer avec l'IA ». Interface only (it spends the user's AI credits); the proposal is
      // returned, never applied: the user applies it through the usual planning endpoints.
      r.get('/ai/status', { schema: tag('IA'), preHandler: userOnly }, async (req) => {
        const s = D.getSettings(ctx(req));
        return D.aiStatus(s, process.env, D.getAiKey(ctx(req), s['ai.provider']));
      });
      // D-66: the API key is typed in Configuration › IA; it is written here and never read back.
      r.put('/ai/key', { schema: { ...tag('IA'), body: D.aiKeyBody }, preHandler: userOnly }, async (req) =>
        D.setAiKey(ctx(req), req.body.provider, req.body.key),
      );
      // D-66: connection test + model list, with the form's values (not yet saved).
      r.post(
        '/ai/check',
        { schema: { ...tag('IA'), body: D.aiCheckBody }, preHandler: userOnly },
        async (req) => D.checkAi(req.body, process.env, D.getAiKey(ctx(req), req.body.provider)),
      );
      r.post(
        '/ai/propose',
        { schema: { ...tag('IA'), body: D.aiProposeBody }, preHandler: userOnly },
        async (req) => {
          const c = ctx(req);
          const s = D.getSettings(c);
          const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
          return D.proposeWithAi(c, req.body.scope, req.body.period, llm);
        },
      );
      // D-70: « Découper avec l'IA »: proposed tasks of a project (nothing created; POST /tasks/batch adds them).
      r.post(
        '/ai/breakdown',
        { schema: { ...tag('IA'), body: D.aiBreakdownBody }, preHandler: userOnly },
        async (req) => {
          const c = ctx(req);
          const s = D.getSettings(c);
          const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
          return D.breakdownWithAi(c, req.body, llm);
        },
      );
      // D-75: « Proposer un chemin avec l'IA »: proposed projects of an objective (nothing created).
      r.post(
        '/ai/path',
        { schema: { ...tag('IA'), body: D.aiPathBody }, preHandler: userOnly },
        async (req) => {
          const c = ctx(req);
          const s = D.getSettings(c);
          const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
          return D.pathWithAi(c, req.body, llm);
        },
      );
      // D-68: « Rédiger avec l'IA »: a description proposal, returned to the editor (nothing saved).
      r.post(
        '/ai/describe',
        { schema: { ...tag('IA'), body: D.aiDescribeBody }, preHandler: userOnly },
        async (req) => {
          const c = ctx(req);
          const s = D.getSettings(c);
          const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
          return D.describeWithAi(c, req.body, llm);
        },
      );
      // D-57: wipe objectives, projects and tasks (configuration kept). A SQLite backup is taken first.
      r.post(
        '/purge',
        { schema: { ...tag('Réglages'), body: D.purgeBody }, preHandler: userOnly },
        async (req) => {
          let backup: string | null = null;
          if (opts.backupDir) {
            backup = join(
              opts.backupDir,
              `backup-avant-purge-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
            );
            await sqlite.backup(backup);
          }
          return {
            ...D.purgeData(ctx(req), { history: req.body.history }),
            backup: backup ? basename(backup) : null,
          };
        },
      );
      // D-45: full JSON export (backup), interface only, without any secret.
      r.get('/export', { schema: tag('Réglages'), preHandler: userOnly }, async (req, reply) => {
        const data = D.exportData(ctx(req));
        reply.header(
          'content-disposition',
          `attachment; filename="memento-export-${data.exportedAt.slice(0, 10)}.json"`,
        );
        return data;
      });
      r.post(
        '/tokens',
        {
          schema: {
            ...tag('Accès'),
            body: z.object({ name: z.string(), scopes: z.enum(['read', 'read_write']) }),
          },
          preHandler: userOnly,
        },
        async (req) => {
          const c = ctx(req);
          return D.tx(c, () => {
            const t = A.createToken(db, req.body.name, req.body.scopes);
            D.audit(c, 'api_token', t.id, 'create', null, { name: t.name, scopes: t.scopes });
            return t;
          });
        },
      );
      r.delete(
        '/tokens/:id',
        { schema: { ...tag('Accès'), params: D.idParam }, preHandler: userOnly },
        async (req) => {
          const c = ctx(req);
          D.tx(c, () => {
            A.revokeToken(db, req.params.id);
            D.audit(c, 'api_token', req.params.id, 'revoke', null, { revoked: true });
          });
          return { ok: true };
        },
      );

      // ---------- Domains ----------
      r.get('/domains', { schema: tag('Domaines') }, async (req) => D.listDomains(ctx(req)));
      r.post(
        '/domains',
        { schema: { ...tag('Domaines'), body: D.domainCreate }, preHandler: userOnly },
        async (req) => D.createDomain(ctx(req), req.body),
      );
      r.patch(
        '/domains/:id',
        { schema: { ...tag('Domaines'), params: D.idParam, body: D.domainPatch } },
        async (req) => D.updateDomain(ctx(req), req.params.id, req.body),
      );
      r.post('/domains/reorder', { schema: { ...tag('Domaines'), body: D.reorderBody } }, async (req) =>
        D.reorderDomains(ctx(req), req.body.ids),
      );

      // ---------- Groups ----------
      r.get('/groups', { schema: tag('Groupes') }, async (req) => D.listGroups(ctx(req)));
      r.post('/groups', { schema: { ...tag('Groupes'), body: D.groupCreate } }, async (req) =>
        D.createGroup(ctx(req), req.body),
      );
      r.patch(
        '/groups/:id',
        { schema: { ...tag('Groupes'), params: D.idParam, body: D.groupPatch } },
        async (req) => D.updateGroup(ctx(req), req.params.id, req.body),
      );
      r.delete('/groups/:id', { schema: { ...tag('Groupes'), params: D.idParam } }, async (req) => {
        D.deleteGroup(ctx(req), req.params.id);
        return { ok: true };
      });

      // ---------- Meta-objectives & objectives ----------
      r.get('/meta-objectives', { schema: tag('Objectifs') }, async (req) => D.listMetaObjectives(ctx(req)));
      r.post(
        '/meta-objectives/reorder',
        { schema: { ...tag('Objectifs'), body: D.metaReorderBody } },
        async (req) => D.reorderMetaObjectives(ctx(req), req.body.ids),
      );
      r.get('/meta-objectives/:id', { schema: { ...tag('Objectifs'), params: D.idParam } }, async (req) =>
        D.getMetaObjective(ctx(req), req.params.id),
      );
      r.post(
        '/meta-objectives',
        { schema: { ...tag('Objectifs'), body: D.metaObjectiveCreate } },
        async (req) => D.createMetaObjective(ctx(req), req.body),
      );
      r.patch(
        '/meta-objectives/:id',
        { schema: { ...tag('Objectifs'), params: D.idParam, body: D.metaObjectivePatch } },
        async (req) => D.updateMetaObjective(ctx(req), req.params.id, req.body),
      );
      r.get(
        '/objectives',
        {
          schema: {
            ...tag('Objectifs'),
            querystring: z.object({ status: z.string().optional(), quarter: z.string().optional() }),
          },
        },
        async (req) => D.listObjectives(ctx(req), req.query),
      );
      r.get(
        '/objectives/map',
        {
          schema: {
            ...tag('Objectifs'),
            querystring: z.object({ includeClosed: z.enum(['true', 'false']).optional() }),
          },
        },
        async (req) => D.getObjectivesMap(ctx(req), { includeClosed: req.query.includeClosed === 'true' }),
      );
      r.get('/objectives/:id', { schema: { ...tag('Objectifs'), params: D.idParam } }, async (req) => {
        const c = ctx(req);
        return {
          ...D.getObjective(c, req.params.id),
          resources: D.listResources(c, 'objective', [req.params.id]),
        };
      });
      r.get('/objectives/:id/path', { schema: { ...tag('Objectifs'), params: D.idParam } }, async (req) =>
        D.getObjectivePath(ctx(req), req.params.id),
      );
      r.post('/objectives', { schema: { ...tag('Objectifs'), body: D.objectiveCreate } }, async (req) =>
        D.createObjective(ctx(req), req.body),
      );
      r.patch(
        '/objectives/:id',
        { schema: { ...tag('Objectifs'), params: D.idParam, body: D.objectivePatch } },
        async (req) => D.updateObjective(ctx(req), req.params.id, req.body),
      );

      // ---------- Projects & ideas ----------
      r.get('/projects', { schema: { ...tag('Projets'), querystring: D.projectListQuery } }, async (req) =>
        D.listProjects(ctx(req), req.query),
      );
      r.get(
        '/ideas',
        {
          schema: {
            ...tag('Projets'),
            querystring: z.object({ groupId: z.string().optional(), domainId: z.string().optional() }),
          },
        },
        async (req) => D.listIdeas(ctx(req), req.query),
      );
      r.get('/projects/:id', { schema: { ...tag('Projets'), params: D.idParam } }, async (req) => {
        const c = ctx(req);
        return {
          ...D.getProject(c, req.params.id),
          dependsOn: D.listProjectDependencies(c, req.params.id),
          resources: D.listResources(c, 'project', [req.params.id]),
          readiness: D.getProjectReadiness(c, req.params.id),
        };
      });
      r.post('/projects', { schema: { ...tag('Projets'), body: D.projectCreate } }, async (req) =>
        D.createProject(ctx(req), req.body),
      );
      r.patch(
        '/projects/:id',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.projectPatch } },
        async (req) => D.updateProject(ctx(req), req.params.id, req.body),
      );
      r.put(
        '/projects/:id/groups',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.projectGroupsBody } },
        async (req) =>
          D.setProjectGroups(ctx(req), req.params.id, req.body.groupIds, req.body.primaryDomainId),
      );
      r.post('/projects/:id/promote', { schema: { ...tag('Projets'), params: D.idParam } }, async (req) =>
        D.promoteProject(ctx(req), req.params.id),
      );
      r.post(
        '/projects/:id/month',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.projectMonthBody } },
        async (req) => D.setProjectMonth(ctx(req), req.params.id, req.body.month),
      );
      r.post(
        '/projects/:id/complete',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.projectCompleteBody } },
        async (req) => D.completeProject(ctx(req), req.params.id, req.body.success),
      );
      r.post(
        '/projects/:id/replan',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.projectReplanBody } },
        async (req) => D.replanProject(ctx(req), req.params.id, req.body.dueDate),
      );
      r.post(
        '/projects/reorder',
        { schema: { ...tag('Projets'), body: D.projectReorderBody } },
        async (req) => D.reorderProjects(ctx(req), req.body.objectiveId, req.body.ids),
      );
      r.post(
        '/projects/:id/dependencies',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.dependencyBody } },
        async (req) => D.addProjectDependency(ctx(req), req.params.id, req.body.dependsOnId),
      );
      r.delete(
        '/projects/:id/dependencies/:dependsOnId',
        { schema: { ...tag('Projets'), params: z.object({ id: D.uuid, dependsOnId: D.uuid }) } },
        async (req) => D.removeProjectDependency(ctx(req), req.params.id, req.params.dependsOnId),
      );

      // ---------- Tasks & Inbox ----------
      r.get('/tasks', { schema: { ...tag('Tâches'), querystring: D.taskListQuery } }, async (req) =>
        D.listTasks(ctx(req), req.query),
      );
      r.get('/inbox', { schema: tag('Tâches') }, async (req) => D.listInbox(ctx(req)));
      r.get('/experiences', { schema: tag('Expériences') }, async (req) => D.getExperiencesPage(ctx(req)));
      r.post('/experiences', { schema: { ...tag('Expériences'), body: D.experienceIdea } }, async (req) =>
        D.addExperienceIdea(ctx(req), req.body),
      );
      r.get('/tasks/board', { schema: { ...tag('Tâches'), querystring: D.boardQuery } }, async (req) =>
        D.listBoardTasks(ctx(req), req.query),
      );
      r.put(
        '/tasks/:id/current-week',
        { schema: { ...tag('Tâches'), params: D.idParam, body: D.weekToggleBody } },
        async (req) => D.setTaskInCurrentWeek(ctx(req), req.params.id, req.body.inWeek),
      );
      r.get('/tasks/:id', { schema: { ...tag('Tâches'), params: D.idParam } }, async (req) => {
        const c = ctx(req);
        return { ...D.getTask(c, req.params.id), resources: D.listResources(c, 'task', [req.params.id]) };
      });
      r.post('/tasks', { schema: { ...tag('Tâches'), body: D.taskCreate } }, async (req) =>
        D.createTask(ctx(req), req.body),
      );
      r.post('/tasks/batch', { schema: { ...tag('Tâches'), body: D.taskBatchCreate } }, async (req) =>
        D.createTasks(ctx(req), req.body.projectId ?? null, req.body.tasks),
      );
      r.patch(
        '/tasks/:id',
        { schema: { ...tag('Tâches'), params: D.idParam, body: D.taskPatch } },
        async (req) => D.updateTask(ctx(req), req.params.id, req.body),
      );
      r.post(
        '/tasks/:id/complete',
        { schema: { ...tag('Tâches'), params: D.idParam, body: D.taskCompleteBody } },
        async (req) => D.completeTask(ctx(req), req.params.id, { actualMin: req.body?.actualMin }),
      );
      r.post('/tasks/:id/uncomplete', { schema: { ...tag('Tâches'), params: D.idParam } }, async (req) =>
        D.uncompleteTask(ctx(req), req.params.id),
      );
      r.post('/tasks/reorder', { schema: { ...tag('Tâches'), body: D.taskReorderBody } }, async (req) =>
        D.reorderTasks(ctx(req), req.body.projectId, req.body.ids),
      );
      r.post(
        '/tasks/:id/move',
        { schema: { ...tag('Tâches'), params: D.idParam, body: D.taskMoveBody } },
        async (req) => D.moveTask(ctx(req), req.params.id, req.body.projectId, req.body.position),
      );
      r.post(
        '/tasks/:id/dependencies',
        { schema: { ...tag('Tâches'), params: D.idParam, body: D.dependencyBody } },
        async (req) => D.addTaskDependency(ctx(req), req.params.id, req.body.dependsOnId),
      );
      r.delete(
        '/tasks/:id/dependencies/:dependsOnId',
        { schema: { ...tag('Tâches'), params: z.object({ id: D.uuid, dependsOnId: D.uuid }) } },
        async (req) => D.removeTaskDependency(ctx(req), req.params.id, req.params.dependsOnId),
      );

      // ---------- Deletion (D-35): hard delete, journaled ----------
      const del = (path: string, tagName: string, fn: (c: D.Ctx, id: string) => { ok: true }) =>
        r.delete(path, { schema: { ...tag(tagName), params: D.idParam } }, async (req) =>
          fn(ctx(req), req.params.id),
        );
      del('/tasks/:id', 'Tâches', D.deleteTask);
      del('/projects/:id', 'Projets', D.deleteProject);
      del('/objectives/:id', 'Objectifs', D.deleteObjective);
      del('/meta-objectives/:id', 'Objectifs', D.deleteMetaObjective);

      // ---------- Resources ----------
      r.post('/resources', { schema: { ...tag('Ressources'), body: D.resourceCreate } }, async (req) =>
        D.createResource(ctx(req), req.body),
      );
      r.delete('/resources/:id', { schema: { ...tag('Ressources'), params: D.idParam } }, async (req) => {
        D.deleteResource(ctx(req), req.params.id);
        return { ok: true };
      });

      // ---------- Planning & execution ----------
      r.get(
        '/week-plans/:isoWeek',
        { schema: { ...tag('Planification'), params: D.isoWeekParam } },
        async (req) => D.getPlanningPage(ctx(req), req.params.isoWeek),
      );
      r.post(
        '/week-plans/:isoWeek/propose',
        { schema: { ...tag('Planification'), params: D.isoWeekParam } },
        async (req) => D.proposeWeek(ctx(req), req.params.isoWeek),
      );
      r.put(
        '/week-plans/:isoWeek/items',
        { schema: { ...tag('Planification'), params: D.isoWeekParam, body: D.weekItemsBody } },
        async (req) => D.setWeekItems(ctx(req), req.params.isoWeek, req.body.items),
      );
      r.patch(
        '/week-plans/:isoWeek',
        { schema: { ...tag('Planification'), params: D.isoWeekParam, body: D.weekPatchBody } },
        async (req) => D.patchWeek(ctx(req), req.params.isoWeek, req.body.budgetMin, req.body.budgetReason),
      );
      r.post(
        '/week-plans/:isoWeek/validate',
        { schema: { ...tag('Planification'), params: D.isoWeekParam } },
        async (req) => D.validateWeek(ctx(req), req.params.isoWeek),
      );
      r.get(
        '/month-plans/:month',
        { schema: { ...tag('Planification'), params: z.object({ month: D.monthKey }) } },
        async (req) => D.getMonthPlanningPage(ctx(req), req.params.month),
      );
      r.get(
        '/quarter-plans/:quarter',
        { schema: { ...tag('Planification'), params: z.object({ quarter: D.quarterKey }) } },
        async (req) => D.getQuarterPlanningPage(ctx(req), req.params.quarter),
      );
      r.post(
        '/objectives/:id/quarter',
        { schema: { ...tag('Objectifs'), params: D.idParam, body: D.objectiveQuarterBody } },
        async (req) => D.setObjectiveQuarter(ctx(req), req.params.id, req.body.quarter),
      );
      // D-69: map « Réorganiser »: drop an objective in a (meta-objective, quarter) cell at a place.
      r.post(
        '/objectives/:id/place',
        { schema: { ...tag('Objectifs'), params: D.idParam, body: D.objectivePlaceBody } },
        async (req) => D.placeObjective(ctx(req), req.params.id, req.body),
      );
      r.get(
        '/weeks/:isoWeek/execution',
        { schema: { ...tag('Planification'), params: D.isoWeekParam } },
        async (req) => D.getExecution(ctx(req), req.params.isoWeek),
      );

      // ---------- Reports ----------
      r.get('/reports', { schema: { ...tag('Rapports'), querystring: D.reportListQuery } }, async (req) =>
        D.listReports(ctx(req), req.query),
      );
      // D-77: the evening report: the plain version and the facts it is made from (the AI one is built on sending).
      r.get(
        '/daily-recap',
        { schema: { ...tag('Rapports'), querystring: z.object({ date: z.string().optional() }) } },
        async (req) => D.getDailyRecap(ctx(req), req.query.date),
      );
      // D-78: holidays, also open to the AI token (« je suis en vacances du… au… »).
      r.get('/vacations', { schema: tag('Réglages') }, async (req) => D.listVacations(ctx(req)));
      r.post('/vacations', { schema: { ...tag('Réglages'), body: D.vacationBody } }, async (req) =>
        D.addVacation(ctx(req), req.body),
      );
      r.delete(
        '/vacations/:from',
        { schema: { ...tag('Réglages'), params: z.object({ from: z.string() }) } },
        async (req) => D.removeVacation(ctx(req), req.params.from),
      );
      r.get('/notify/status', { schema: tag('Réglages'), preHandler: userOnly }, async (req) =>
        D.notifyStatus(ctx(req), process.env),
      );
      // The bot token is written here and never read back (like the AI keys, D-66).
      r.put(
        '/notify/telegram-token',
        { schema: { ...tag('Réglages'), body: D.telegramTokenBody }, preHandler: userOnly },
        async (req) => D.setTelegramToken(ctx(req), req.body.token),
      );
      r.post('/notify/telegram-detect', { schema: tag('Réglages'), preHandler: userOnly }, async (req) =>
        D.detectTelegramChat(ctx(req), process.env),
      );
      // Preview: the message as it would be sent now (AI included), without sending it.
      r.post(
        '/notify/daily-recap/preview',
        {
          schema: { ...tag('Réglages'), body: z.object({ date: z.string().optional() }).default({}) },
          preHandler: userOnly,
        },
        async (req) =>
          D.buildDailyMessage(ctx(req), { env: process.env, llm: opts.llm, date: req.body.date }),
      );
      r.post(
        '/notify/daily-recap/send',
        {
          schema: { ...tag('Réglages'), body: z.object({ date: z.string().optional() }).default({}) },
          preHandler: userOnly,
        },
        async (req) => {
          const out = await D.sendDailyRecap(ctx(req), {
            env: process.env,
            llm: opts.llm,
            date: req.body.date,
          });
          return { sent: out.sent, ai: out.ai, aiError: out.aiError };
        },
      );
      r.get('/reports/:id', { schema: { ...tag('Rapports'), params: D.idParam } }, async (req) =>
        D.getReport(ctx(req), req.params.id),
      );
      r.get(
        '/reports/by-period/:kind/:periodKey',
        {
          schema: {
            ...tag('Rapports'),
            params: z.object({ kind: z.enum(['week', 'month', 'quarter']), periodKey: z.string() }),
          },
        },
        async (req, reply) =>
          D.findReport(ctx(req), req.params.kind, req.params.periodKey) ??
          reply.code(404).send({ code: 'NOT_FOUND', message: 'Rapport non généré' }),
      );
      r.post(
        '/reports/generate',
        { schema: { ...tag('Rapports'), body: D.reportGenerateBody } },
        async (req) => D.generateReport(ctx(req), req.body.kind, req.body.periodKey),
      );

      // ---------- Search & changes ----------
      r.get(
        '/search',
        { schema: { ...tag('Recherche'), querystring: z.object({ q: z.string().max(200) }) } },
        async (req) => D.search(ctx(req), req.query.q),
      );
      r.get('/changes', { schema: { ...tag('À revoir'), querystring: D.changesQuery } }, async (req) => {
        const c = ctx(req);
        const since =
          req.query.since === 'last-visit'
            ? (req.principal!.previousSeenAt ?? undefined)
            : D.resolveSince(c, req.query.since);
        return D.listChanges(c, {
          since,
          actor: req.query.actor,
          includeReviewed: req.query.includeReviewed,
        });
      });
      r.post(
        '/changes/mark-reviewed',
        { schema: { ...tag('À revoir'), body: D.markReviewedBody } },
        async (req) => ({
          updated: D.markReviewed(ctx(req), req.body),
        }),
      );
    },
    { prefix: '/api/v1' },
  );

  // Static web app (built SPA) with client-side routing fallback.
  const dist = opts.webDist ?? resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist, wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !/\.[a-z0-9]+(\?|$)/i.test(req.url)) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Route inconnue' });
    });
  }
  return app;
}
