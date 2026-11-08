// Data migrations run at API start. Each one runs once: a `migration.*` row of `setting` records it (as DM-109).
import { and, eq, schema } from '@memento/db';
import { audit, type Ctx, ctxNowIso, tx } from '../context.ts';
import { migrateDependencies } from './dependencies.ts';
import { fillMetaDomains } from './plan.ts';
import { refreshObjectiveProgress } from './referential.ts';

const { project, setting } = schema;

/** Runs `fn` once per database; returns whether it ran now. */
function once(ctx: Ctx, key: string, fn: () => void): boolean {
  return tx(ctx, () => {
    if (ctx.db.select().from(setting).where(eq(setting.key, key)).get()) return false;
    fn();
    ctx.db.insert(setting).values({ key, value: true }).run();
    return true;
  });
}

/**
 * D-140 (audit M-05): a project does not fail. The projects closed « done, success false » (by hand, or by the
 * end of a recurring month, D-86) become abandoned; their tasks are untouched (done tasks stay done); the
 * objectives they belong to get their progress recomputed. Frozen reports keep what they said.
 */
export function abandonFailedProjects(ctx: Ctx) {
  const rows = ctx.db
    .select()
    .from(project)
    .where(and(eq(project.status, 'done'), eq(project.success, false)))
    .all();
  const sys = { ...ctx, actor: 'system:migration' as const };
  for (const r of rows) {
    ctx.db
      .update(project)
      .set({ status: 'abandoned', success: null, updatedAt: ctxNowIso(ctx) })
      .where(eq(project.id, r.id))
      .run();
    audit(sys, 'project', r.id, 'update', { status: 'done', success: false }, { status: 'abandoned' });
  }
  for (const id of new Set(rows.map((r) => r.objectiveId))) refreshObjectiveProgress(ctx, id);
  return rows.length;
}

/** Called by the API at start (dossier §12, after the schema migrations and the seed). */
export function runDataMigrations(ctx: Ctx) {
  migrateDependencies(ctx); // DM-109, once by its own flag
  once(ctx, 'migration.dm114_done', () => fillMetaDomains(ctx)); // M-12: once, as D-87 says
  once(ctx, 'migration.d140_done', () => abandonFailedProjects(ctx));
}
