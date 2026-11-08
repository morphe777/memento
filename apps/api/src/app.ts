// Mémento REST API (dossier de dev §8). The only entry point to business logic (F-26): routes are thin
// adapters around @memento/domain services.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import type { Db, SqliteDatabase } from '@memento/db';
import * as D from '@memento/domain';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { TOKEN_ROUTES, tokenAccess } from './access.ts';
import * as A from './auth.ts';

const GUIDE_FILE = resolve(import.meta.dirname, '../../../docs/api/guide-ia.md');

/** H-02. Inline styles stay allowed (React `style` and the libraries), scripts never. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export interface AppOptions {
  db: Db;
  sqlite: SqliteDatabase;
  cookieSecure: boolean;
  webDist?: string;
  logger?: boolean;
  /** Log lines go there (tests); implies logging. */
  logStream?: NodeJS.WritableStream;
  now?: () => Date;
  /** Where the SQLite backup is written before an import (D-50); no backup when absent (tests). */
  backupDir?: string;
  /** Replaces the configured AI provider (tests). */
  llm?: D.Llm;
  /**
   * H-01: addresses (IP or CIDR, comma separated) of the reverse proxy whose X-Forwarded-For is believed
   * (MEMENTO_TRUST_PROXY). None by default: the client address is the TCP peer, a header cannot change it.
   */
  trustProxy?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    apiRoutes: string[];
  }
  interface FastifyRequest {
    principal: A.Principal | null;
  }
}

/** M-20: the search words (`q`) never reach the logs. */
export const maskQuery = (url: string) => url.replace(/([?&]q=)[^&]*/g, '$1***');

export async function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger:
      opts.logger || opts.logStream
        ? {
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            serializers: {
              req: (req: { method: string; url: string; ip?: string }) => ({
                method: req.method,
                url: maskQuery(req.url),
                remoteAddress: req.ip,
              }),
            },
            ...(opts.logStream ? { stream: opts.logStream } : {}),
          }
        : false,
    trustProxy: opts.trustProxy?.trim() || false,
  });
  // H-03, H-14: every API route, for the token list check below and the access matrix test.
  const apiRoutes: string[] = [];
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/')) return;
    for (const m of [r.method].flat()) if (m !== 'HEAD') apiRoutes.push(`${m} ${r.url}`);
  });
  app.decorate('apiRoutes', apiRoutes);
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
    // H-02: only this server's scripts, images and connections (no remote image in a description).
    reply.header('Content-Security-Policy', CSP);
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (opts.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000');
  });

  // Authentication for every /api/v1 route except login, health and the OpenAPI document.
  const PUBLIC = new Set(['/api/v1/auth/login', '/api/v1/health', '/api/v1/openapi.json']);
  // /auth/me answers 200 { authenticated: false } instead of 401 (no console noise before login).
  const SOFT = new Set(['/api/v1/auth/me']);
  // C-02: decided on the route the router matched (decoded URL), never on the raw URL. No route = not an API
  // handler: the not-found handler answers.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.routeOptions.url;
    if (!path?.startsWith('/api/') || PUBLIC.has(path)) return;
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    req.principal = bearer
      ? A.tokenPrincipal(db, bearer)
      : A.sessionPrincipal(db, req.cookies[A.SESSION_COOKIE]);
    if (!req.principal && SOFT.has(path)) return;
    if (!req.principal)
      return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Connexion requise.' });
    if (req.principal.kind !== 'token') return;
    // H-03: a token reaches only the routes of the list (access.ts), a read token only their `read` ones.
    const access = tokenAccess(req.method, path);
    if (!access)
      return reply
        .code(403)
        .send({ code: 'USER_ONLY', message: 'Réservé à l’interface (utilisateur connecté).' });
    if (access === 'write' && !req.principal.canWrite)
      return reply.code(403).send({ code: 'READ_ONLY_TOKEN', message: 'Jeton en lecture seule.' });
  });
  // H-03: the list names real routes only (a renamed route would otherwise silently close or stay open).
  app.addHook('onReady', async () => {
    const missing = Object.keys(TOKEN_ROUTES).filter((k) => !apiRoutes.includes(k));
    if (missing.length) throw new Error(`TOKEN_ROUTES: unknown routes ${missing.join(', ')}`);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof D.ConflictError)
      return reply.code(409).send({ code: err.code, message: err.message, details: err.details });
    if (err instanceof D.DomainError)
      return reply.code(422).send({ code: err.code, message: err.message, details: err.details });
    if (err instanceof D.NotFoundError)
      return reply.code(404).send({ code: 'NOT_FOUND', message: `${err.entity} introuvable` });
    // M-16: a unique name already taken (domain, group…) is a conflict, not a server error.
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE')
      return reply.code(409).send({ code: 'ALREADY_EXISTS', message: 'Ce nom existe déjà.' });
    // C-06: an impossible or malformed date has its own code, whatever the field.
    if (hasZodFastifySchemaValidationErrors(err) && err.validation.some((v) => v.message === D.DATE_MESSAGE))
      return reply.code(422).send({ code: 'INVALID_DATE', message: D.DATE_MESSAGE, details: err.validation });
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
  const today = () => D.parisDate(opts.now ? opts.now() : new Date());

  await app.register(
    async (api) => {
      const r = api.withTypeProvider<ZodTypeProvider>();
      const tag = (t: string) => ({ tags: [t] });

      // ---------- Health, auth ----------
      // M-20: the database is read, so a broken database is a 503, not « ok ».
      r.get('/health', { schema: tag('Système') }, async (req, reply) => {
        try {
          sqlite.prepare('select 1').get();
          return { ok: true, db: true, version: D.APP_VERSION };
        } catch (e) {
          req.log.error({ err: e }, 'health: database unreadable');
          return reply.code(503).send({ ok: false, db: false, version: D.APP_VERSION });
        }
      });
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
          if (!res) {
            req.log.warn({ ip: req.ip }, 'login failed'); // M-20 (never the password)
            return reply
              .code(401)
              .send({ code: 'BAD_CREDENTIALS', message: 'Identifiant ou mot de passe incorrect.' });
          }
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
      r.patch('/settings', { schema: { ...tag('Réglages'), body: D.settingsPatchSchema } }, async (req) =>
        D.patchSettings(ctx(req), req.body),
      );
      // D-136: the description templates, also readable by tokens (GET /settings stays closed to them, D-123).
      r.get('/templates', { schema: tag('Réglages') }, async (req) => D.getTemplates(ctx(req)));
      r.get('/tokens', { schema: tag('Accès') }, async () => A.listTokens(db));
      // D-50: restore an export (replaces all business data). M-13: checked first, then a safety copy.
      r.post(
        '/import',
        {
          schema: { ...tag('Réglages'), body: z.record(z.string(), z.unknown()) },
          bodyLimit: 100 * 1024 * 1024,
        },
        async (req) => {
          const c = ctx(req);
          D.checkImport(c, req.body);
          const backup = opts.backupDir ? await D.safetyCopy(c, opts.backupDir, 'import') : null;
          return { ...D.importData(c, req.body), backup };
        },
      );
      // D-58: « Proposer avec l'IA ». Interface only (it spends the user's AI credits); the proposal is
      // returned, never applied: the user applies it through the usual planning endpoints.
      r.get('/ai/status', { schema: tag('IA') }, async (req) => {
        const s = D.getSettings(ctx(req));
        return D.aiStatus(s, process.env, D.getAiKey(ctx(req), s['ai.provider']));
      });
      // D-66: the API key is typed in Configuration › IA; it is written here and never read back.
      r.put('/ai/key', { schema: { ...tag('IA'), body: D.aiKeyBody } }, async (req) =>
        D.setAiKey(ctx(req), req.body.provider, req.body.key),
      );
      // D-66: connection test + model list, with the form's values (not yet saved).
      r.post('/ai/check', { schema: { ...tag('IA'), body: D.aiCheckBody } }, async (req) =>
        D.checkAi(req.body, process.env, D.getAiKey(ctx(req), req.body.provider), D.getSettings(ctx(req))),
      );
      r.post('/ai/propose', { schema: { ...tag('IA'), body: D.aiProposeBody } }, async (req) => {
        const c = ctx(req);
        const s = D.getSettings(c);
        const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
        return D.proposeWithAi(c, req.body.scope, req.body.period, llm);
      });
      // D-70: « Découper avec l'IA »: proposed tasks of a project (nothing created; POST /tasks/batch adds them).
      r.post('/ai/breakdown', { schema: { ...tag('IA'), body: D.aiBreakdownBody } }, async (req) => {
        const c = ctx(req);
        const s = D.getSettings(c);
        const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
        return D.breakdownWithAi(c, req.body, llm);
      });
      // D-75: « Proposer un chemin avec l'IA »: proposed projects of an objective (nothing created).
      r.post('/ai/path', { schema: { ...tag('IA'), body: D.aiPathBody } }, async (req) => {
        const c = ctx(req);
        const s = D.getSettings(c);
        const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
        return D.pathWithAi(c, req.body, llm);
      });
      // D-97: « Compléter avec l'IA » in the edit panels: alternative titles and field proposals (nothing saved).
      r.post('/ai/fill', { schema: { ...tag('IA'), body: D.aiFillBody } }, async (req) => {
        const c = ctx(req);
        const s = D.getSettings(c);
        const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
        return D.fillWithAi(c, req.body, llm);
      });
      // D-68: « Rédiger avec l'IA »: a description proposal, returned to the editor (nothing saved).
      r.post('/ai/describe', { schema: { ...tag('IA'), body: D.aiDescribeBody } }, async (req) => {
        const c = ctx(req);
        const s = D.getSettings(c);
        const llm = opts.llm ?? D.makeLlm(s, process.env, D.getAiKey(c, s['ai.provider']));
        return D.describeWithAi(c, req.body, llm);
      });
      // D-57: wipe objectives, projects and tasks (configuration kept). A SQLite backup is taken first.
      r.post('/purge', { schema: { ...tag('Réglages'), body: D.purgeBody } }, async (req) => {
        const c = ctx(req);
        const backup = opts.backupDir ? await D.safetyCopy(c, opts.backupDir, 'purge') : null;
        return { ...D.purgeData(c, { history: req.body.history }), backup };
      });
      // D-45: full JSON export (backup), interface only, without any secret.
      r.get('/export', { schema: tag('Réglages') }, async (req, reply) => {
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
      r.delete('/tokens/:id', { schema: { ...tag('Accès'), params: D.idParam } }, async (req) => {
        const c = ctx(req);
        D.tx(c, () => {
          A.revokeToken(db, req.params.id);
          D.audit(c, 'api_token', req.params.id, 'revoke', null, { revoked: true });
        });
        return { ok: true };
      });

      // ---------- Domains ----------
      r.get('/domains', { schema: tag('Domaines') }, async (req) => D.listDomains(ctx(req)));
      r.post('/domains', { schema: { ...tag('Domaines'), body: D.domainCreate } }, async (req) =>
        D.createDomain(ctx(req), req.body),
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
      // API-01: a meta-objective with its objectives.
      r.get('/meta-objectives/:id', { schema: { ...tag('Objectifs'), params: D.idParam } }, async (req) => {
        const c = ctx(req);
        return {
          ...D.getMetaObjective(c, req.params.id),
          objectives: D.listObjectives(c).filter((o) => o.metaObjectiveId === req.params.id),
        };
      });
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
      r.post(
        '/objectives/:id/duplicate',
        { schema: { ...tag('Objectifs'), params: D.idParam, body: D.objectiveDuplicateBody } },
        async (req) => D.duplicateObjective(ctx(req), req.params.id, req.body),
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
      r.post('/projects/batch', { schema: { ...tag('Projets'), body: D.projectBatchCreate } }, async (req) =>
        D.createProjects(ctx(req), req.body.projects),
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
        '/projects/:id/duplicate',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.projectDuplicateBody } },
        async (req) => D.duplicateProject(ctx(req), req.params.id, { title: req.body.title }),
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
      r.put(
        '/projects/:id/dependencies',
        { schema: { ...tag('Projets'), params: D.idParam, body: D.projectDependenciesBody } },
        async (req) => D.setProjectDependencies(ctx(req), req.params.id, req.body.dependsOn),
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
      // D-100: Cap, the « why » of the quarter and the month.
      r.get('/cap', { schema: { ...tag('Objectifs'), querystring: D.capQuery } }, async (req) =>
        D.getCap(ctx(req), req.query),
      );
      r.get('/calendar', { schema: { ...tag('Tâches'), querystring: D.calendarQuery } }, async (req) =>
        D.getCalendar(ctx(req), req.query.from, req.query.to),
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
      // D-115: plain French → title, deadline, recurrence, duration, domain (writes nothing).
      r.post('/tasks/parse', { schema: { ...tag('Tâches'), body: D.taskParseBody } }, async (req) =>
        D.parseTask(ctx(req), req.body),
      );
      // D-99: « Fait hors plan » (Ma semaine): a task created already done, traced as unplanned.
      r.post('/tasks/done', { schema: { ...tag('Tâches'), body: D.taskCreate } }, async (req) =>
        D.logDoneTask(ctx(req), req.body),
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
      // ---------- Vue Plan (memento-vue-plan/03) ----------
      r.get(
        '/plan-graph',
        { schema: { ...tag('Planification'), querystring: D.planGraphQuery } },
        async (req) => D.getPlanGraph(ctx(req), req.query),
      );
      r.get(
        '/plan-graph/reserve',
        { schema: { ...tag('Planification'), querystring: D.planGraphQuery } },
        async (req) => D.getPlanReserve(ctx(req), req.query),
      );
      r.post('/plan/apply', { schema: { ...tag('Planification'), body: D.planApplyBody } }, async (req) =>
        D.applyPlanChanges(ctx(req), req.body),
      );
      r.post('/plan/preview', { schema: { ...tag('Planification'), body: D.planApplyBody } }, async (req) =>
        D.previewPlanChanges(ctx(req), req.body),
      );
      r.post(
        '/plan/migrate-dependencies',
        { schema: { ...tag('Planification'), body: z.object({ dryRun: z.boolean().default(true) }) } },
        async (req) => D.migrateDependencies(ctx(req), { dryRun: req.body.dryRun }),
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
        { schema: { ...tag('Rapports'), querystring: z.object({ date: D.isoDate.optional() }) } },
        async (req) => D.getDailyRecap(ctx(req), req.query.date),
      );
      // D-78: holidays, also open to the AI token (« je suis en vacances du… au… »).
      r.get('/vacations', { schema: tag('Réglages') }, async (req) => D.listVacations(ctx(req)));
      r.post('/vacations', { schema: { ...tag('Réglages'), body: D.vacationBody } }, async (req) =>
        D.addVacation(ctx(req), req.body),
      );
      r.delete(
        '/vacations/:from',
        { schema: { ...tag('Réglages'), params: z.object({ from: D.isoDate }) } },
        async (req) => D.removeVacation(ctx(req), req.params.from),
      );
      r.get('/notify/status', { schema: tag('Réglages') }, async (req) =>
        D.notifyStatus(ctx(req), process.env),
      );
      // The bot token is written here and never read back (like the AI keys, D-66).
      r.put(
        '/notify/telegram-token',
        { schema: { ...tag('Réglages'), body: D.telegramTokenBody } },
        async (req) => D.setTelegramToken(ctx(req), req.body.token),
      );
      r.post('/notify/telegram-detect', { schema: tag('Réglages') }, async (req) =>
        D.detectTelegramChat(ctx(req), process.env),
      );
      // Web Push (user request 01/11/2026): this device subscribes from Configuration › Notifications.
      r.get('/notify/push/key', { schema: tag('Réglages') }, async (req) => D.pushPublicKey(ctx(req)));
      r.get('/notify/push/devices', { schema: tag('Réglages') }, async (req) => D.listPushDevices(ctx(req)));
      r.post(
        '/notify/push/subscribe',
        { schema: { ...tag('Réglages'), body: D.pushSubscriptionBody } },
        async (req) => D.addPushSubscription(ctx(req), req.body),
      );
      r.post(
        '/notify/push/unsubscribe',
        { schema: { ...tag('Réglages'), body: D.pushUnsubscribeBody } },
        async (req) => D.removePushSubscription(ctx(req), req.body.endpoint),
      );
      r.post('/notify/push/test', { schema: tag('Réglages') }, async (req) =>
        D.sendPush(ctx(req), {
          title: 'Mémento',
          body: 'Les notifications arrivent bien sur cet appareil.',
          url: '/semaine',
        }),
      );
      // Preview: the message as it would be sent now (AI included), without sending it.
      r.post(
        '/notify/daily-recap/preview',
        {
          schema: { ...tag('Réglages'), body: z.object({ date: D.isoDate.optional() }).default({}) },
        },
        async (req) =>
          D.buildDailyMessage(ctx(req), { env: process.env, llm: opts.llm, date: req.body.date }),
      );
      r.post(
        '/notify/daily-recap/send',
        {
          schema: { ...tag('Réglages'), body: z.object({ date: D.isoDate.optional() }).default({}) },
        },
        async (req) => {
          const out = await D.sendDailyRecap(ctx(req), {
            env: process.env,
            llm: opts.llm,
            date: req.body.date,
          });
          return { sent: out.sent, pushed: out.pushed, ai: out.ai, aiError: out.aiError };
        },
      );
      // D-117: the notices sent (bell): list, read one in full (marks it read), mark all read.
      r.get(
        '/notifications',
        {
          schema: {
            ...tag('Réglages'),
            querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
          },
        },
        async (req) => D.listNotifications(ctx(req), req.query.limit),
      );
      r.get('/notifications/:id', { schema: { ...tag('Réglages'), params: D.idParam } }, async (req) =>
        D.getNotification(ctx(req), req.params.id),
      );
      // M-16: opening a notice marks it read with a POST (a GET never writes).
      r.post('/notifications/:id/read', { schema: { ...tag('Réglages'), params: D.idParam } }, async (req) =>
        D.readNotification(ctx(req), req.params.id),
      );
      r.post('/notifications/read-all', { schema: tag('Réglages') }, async (req) =>
        D.readAllNotifications(ctx(req)),
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
        // C-04: the human review (F-25) is the user's: a token cannot clear what an AI did.
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
