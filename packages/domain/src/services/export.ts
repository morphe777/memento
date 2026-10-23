// Configuration › Données (decision D-45): full export of the data as JSON, as a backup / for other tools.
// Secrets are never exported: password hashes, sessions and API token hashes are left out.
import { schema } from '@memento/db';
import { type Ctx, ctxNow } from '../context.ts';

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
