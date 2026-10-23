import { and, desc, eq, gte, inArray, isNull, like, schema, sql } from '@memento/db';
// "À revoir" (F-25): recent creations / changes from audit_log, filter by period and actor, mark as reviewed.
import { type Ctx, ctxNow, ctxNowIso } from '../context.ts';

const { auditLog, appUser } = schema;
const TITLE_TABLES = {
  project: schema.project,
  objective: schema.objective,
  task: schema.task,
  meta_objective: schema.metaObjective,
} as const;

export function resolveSince(ctx: Ctx, since: string | undefined, userId?: string): string | undefined {
  const now = ctxNow(ctx).getTime();
  if (!since || since === 'all') return undefined;
  if (since === '24h') return new Date(now - 86_400_000).toISOString();
  if (since === '7d') return new Date(now - 7 * 86_400_000).toISOString();
  if (since === 'last-visit') {
    const u = userId ? ctx.db.select().from(appUser).where(eq(appUser.id, userId)).get() : undefined;
    return u?.lastSeenAt ?? undefined;
  }
  return since;
}

export function listChanges(
  ctx: Ctx,
  f: { since?: string; actor?: 'all' | 'me' | 'ai'; includeReviewed?: boolean; limit?: number },
) {
  const rows = ctx.db
    .select()
    .from(auditLog)
    .where(
      and(
        f.since ? gte(auditLog.at, f.since) : undefined,
        f.actor === 'me'
          ? eq(auditLog.actor, 'me')
          : f.actor === 'ai'
            ? like(auditLog.actor, 'ai:%')
            : undefined,
        f.includeReviewed ? undefined : isNull(auditLog.reviewedAt),
        inArray(auditLog.entityType, [
          'project',
          'objective',
          'task',
          'meta_objective',
          'group',
          'domain',
          'resource',
        ]),
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(f.limit ?? 300)
    .all();
  const titles = new Map<string, string>();
  for (const [type, table] of Object.entries(TITLE_TABLES)) {
    const ids = rows.filter((r) => r.entityType === type).map((r) => r.entityId);
    if (!ids.length) continue;
    for (const t of ctx.db
      .select({ id: table.id, title: table.title })
      .from(table)
      .where(inArray(table.id, ids))
      .all())
      titles.set(t.id, t.title);
  }
  const projectOfTask = new Map(
    ctx.db
      .select({ id: schema.task.id, p: schema.task.projectId })
      .from(schema.task)
      .all()
      .map((t) => [t.id, t.p]),
  );
  return rows.map((r) => ({
    ...r,
    title:
      titles.get(r.entityId) ??
      (r.diff && typeof r.diff === 'object' && 'name' in r.diff
        ? String((r.diff as Record<string, unknown[]>).name?.[1] ?? '')
        : ''),
    projectId: r.entityType === 'task' ? (projectOfTask.get(r.entityId) ?? null) : null,
  }));
}

/** Marking as reviewed is bookkeeping, not a business mutation: it is not itself audited. */
export function markReviewed(ctx: Ctx, f: { ids?: string[]; all?: boolean }) {
  const at = ctxNowIso(ctx);
  if (f.all)
    return ctx.db.update(auditLog).set({ reviewedAt: at }).where(isNull(auditLog.reviewedAt)).run().changes;
  if (!f.ids?.length) return 0;
  return ctx.db
    .update(auditLog)
    .set({ reviewedAt: at })
    .where(and(inArray(auditLog.id, f.ids), isNull(auditLog.reviewedAt)))
    .run().changes;
}

/** Sidebar badge: unreviewed changes made by AI / robots (F-25). */
export const unreviewedCount = (ctx: Ctx) =>
  ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(auditLog)
    .where(and(isNull(auditLog.reviewedAt), like(auditLog.actor, 'ai:%')))
    .get()!.n;
