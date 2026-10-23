// Configuration › Données (decision D-45): full export of the data as JSON, as a backup / for other tools.
// Secrets are never exported: password hashes, sessions and API token hashes are left out.
import { schema } from '@memento/db';
import { audit, type Ctx, ctxNow, tx } from '../context.ts';
import { DomainError } from '../errors.ts';

export const EXPORT_VERSION = 1;

export function exportData(ctx: Ctx) {
  const s = schema;
  return {
    app: 'memento',
    exportVersion: EXPORT_VERSION,
    exportedAt: ctxNow(ctx).toISOString(),
    tables: {
      domain: ctx.db.select().from(s.domain).all(),
      group: ctx.db.select().from(s.group).all(),
      metaObjective: ctx.db.select().from(s.metaObjective).all(),
      objective: ctx.db.select().from(s.objective).all(),
      project: ctx.db.select().from(s.project).all(),
      projectGroup: ctx.db.select().from(s.projectGroup).all(),
      projectDependency: ctx.db.select().from(s.projectDependency).all(),
      task: ctx.db.select().from(s.task).all(),
      taskDependency: ctx.db.select().from(s.taskDependency).all(),
      resourceLink: ctx.db.select().from(s.resourceLink).all(),
      weekPlan: ctx.db.select().from(s.weekPlan).all(),
      weekPlanItem: ctx.db.select().from(s.weekPlanItem).all(),
      report: ctx.db.select().from(s.report).all(),
      setting: ctx.db.select().from(s.setting).all(),
      auditLog: ctx.db.select().from(s.auditLog).all(),
      apiToken: ctx.db
        .select({
          id: s.apiToken.id,
          name: s.apiToken.name,
          scopes: s.apiToken.scopes,
          createdAt: s.apiToken.createdAt,
          revokedAt: s.apiToken.revokedAt,
        })
        .from(s.apiToken)
        .all(),
      appUser: ctx.db
        .select({ id: s.appUser.id, login: s.appUser.login, createdAt: s.appUser.createdAt })
        .from(s.appUser)
        .all(),
    },
  };
}

// Insertion order respects foreign keys; deletion runs in reverse. Users, sessions, tokens and job runs are
// never touched by an import (D-50): secrets are not in the file, and the current login stays valid.
const IMPORT_ORDER = [
  ['domain', schema.domain],
  ['group', schema.group],
  ['metaObjective', schema.metaObjective],
  ['objective', schema.objective],
  ['project', schema.project],
  ['projectGroup', schema.projectGroup],
  ['projectDependency', schema.projectDependency],
  ['task', schema.task],
  ['taskDependency', schema.taskDependency],
  ['resourceLink', schema.resourceLink],
  ['weekPlan', schema.weekPlan],
  ['weekPlanItem', schema.weekPlanItem],
  ['report', schema.report],
  ['setting', schema.setting],
  ['auditLog', schema.auditLog],
] as const;

/**
 * D-50: restore a JSON export, replacing all business data in one transaction (all or nothing).
 * The API takes a SQLite backup of the current database just before calling this.
 */
export function importData(ctx: Ctx, data: unknown) {
  const d = data as { app?: unknown; exportVersion?: unknown; tables?: Record<string, unknown> };
  if (
    !d ||
    d.app !== 'memento' ||
    d.exportVersion !== EXPORT_VERSION ||
    typeof d.tables !== 'object' ||
    !d.tables
  )
    throw new DomainError(
      'INVALID_EXPORT',
      'Fichier non reconnu : ce n’est pas un export Mémento (version 1).',
    );
  for (const [key] of IMPORT_ORDER)
    if (!Array.isArray(d.tables[key]))
      throw new DomainError('INVALID_EXPORT', `Export incomplet : table « ${key} » absente.`);
  return tx(ctx, () => {
    for (const [, table] of [...IMPORT_ORDER].reverse()) ctx.db.delete(table).run();
    const counts: Record<string, number> = {};
    for (const [key, table] of IMPORT_ORDER) {
      const rows = d.tables![key] as Record<string, unknown>[];
      for (let i = 0; i < rows.length; i += 200)
        ctx.db
          .insert(table)
          .values(rows.slice(i, i + 200) as never)
          .run();
      counts[key] = rows.length;
    }
    audit(ctx, 'import', 'import', 'import', null, {
      exportedAt: (d as { exportedAt?: string }).exportedAt ?? null,
      counts,
    });
    return { ok: true as const, counts };
  });
}

// D-57: « Vider les données » — removes every meta-objective, objective, project and task (with their links),
// keeping the configuration: domains, groups, settings, account, sessions, tokens and job runs. With
// `history`, week plans, frozen reports and the journal go too (a clean start). Children first (foreign keys).
const PURGE_TABLES = [
  ['taskDependency', schema.taskDependency],
  ['weekPlanItem', schema.weekPlanItem],
  ['resourceLink', schema.resourceLink],
  ['task', schema.task],
  ['projectDependency', schema.projectDependency],
  ['projectGroup', schema.projectGroup],
  ['project', schema.project],
  ['objective', schema.objective],
  ['metaObjective', schema.metaObjective],
] as const;
const HISTORY_TABLES = [
  ['weekPlan', schema.weekPlan],
  ['report', schema.report],
  ['auditLog', schema.auditLog],
] as const;

export function purgeData(ctx: Ctx, opts: { history: boolean }) {
  return tx(ctx, () => {
    const counts: Record<string, number> = {};
    for (const [key, table] of [...PURGE_TABLES, ...(opts.history ? HISTORY_TABLES : [])])
      counts[key] = ctx.db.delete(table).run().changes;
    // Logged after the wipe, so the journal keeps a trace even when it was emptied.
    audit(ctx, 'purge', 'purge', 'purge', null, { history: opts.history, counts });
    return { ok: true as const, counts };
  });
}
